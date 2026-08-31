import http, { createServer as createHttpServer } from 'node:http';
import net, { createServer as createNetServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createNetworkPolicyProxy } from './network-proxy.js';
import type { NetworkAddressLookup } from './network-policy.js';

function listen(server: http.Server | net.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server | net.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function getThroughProxy(
  proxyUrl: string,
  targetUrl: string,
): Promise<{
  readonly status: number;
  readonly body: string;
}> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: proxy.hostname,
        port: proxy.port,
        path: targetUrl,
        headers: { host: new URL(targetUrl).host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.once('error', reject);
  });
}

describe('loopback network-policy proxy', () => {
  it('forwards HTTP with one validated DNS result pinned into the upstream socket', async () => {
    let destinationRequests = 0;
    let observedHost = '';
    const destination = createHttpServer((request, response) => {
      destinationRequests += 1;
      observedHost = request.headers.host ?? '';
      response.end('pinned-http');
    });
    const destinationPort = await listen(destination);
    let lookups = 0;
    const lookupAddresses: NetworkAddressLookup = () => {
      lookups += 1;
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
    };
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses,
    });

    try {
      await expect(
        getThroughProxy(proxy.serverUrl, `http://rebind.invalid:${destinationPort}/through-proxy`),
      ).resolves.toEqual({ status: 200, body: 'pinned-http' });
      expect(lookups).toBe(1);
      expect(destinationRequests).toBe(1);
      expect(observedHost).toBe(`rebind.invalid:${destinationPort}`);
    } finally {
      await proxy.close();
      await closeServer(destination);
    }
  });

  it('rejects a private resolution before opening the upstream HTTP socket', async () => {
    let destinationRequests = 0;
    const destination = createHttpServer((_request, response) => {
      destinationRequests += 1;
      response.end('must not be reached');
    });
    const destinationPort = await listen(destination);
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: false,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    });

    try {
      const result = await getThroughProxy(
        proxy.serverUrl,
        `http://rebind.invalid:${destinationPort}/blocked`,
      );
      expect(result.status).toBe(403);
      expect(destinationRequests).toBe(0);
    } finally {
      await proxy.close();
      await closeServer(destination);
    }
  });

  it('does not open an upstream socket when a delayed lookup resolves after close', async () => {
    let destinationRequests = 0;
    const destination = createHttpServer((_request, response) => {
      destinationRequests += 1;
      response.end('must not be reached after close');
    });
    const destinationPort = await listen(destination);
    let releaseLookup: (() => void) | undefined;
    let markLookupStarted: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: async () => {
        markLookupStarted?.();
        await new Promise<void>((resolve) => {
          releaseLookup = resolve;
        });
        return [{ address: '127.0.0.1', family: 4 }];
      },
    });

    const request = getThroughProxy(
      proxy.serverUrl,
      `http://rebind.invalid:${destinationPort}/late-resolution`,
    ).catch(() => null);
    await lookupStarted;
    await proxy.close();
    releaseLookup?.();
    await request;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(destinationRequests).toBe(0);
    await closeServer(destination);
  });

  it('pins CONNECT tunnels without a second target-host lookup', async () => {
    const destination = createNetServer((socket) => socket.pipe(socket));
    const destinationPort = await listen(destination);
    let lookups = 0;
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => {
        lookups += 1;
        return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
      },
    });
    const proxyAddress = new URL(proxy.serverUrl);

    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection({
          host: proxyAddress.hostname,
          port: Number.parseInt(proxyAddress.port, 10),
        });
        let received = '';
        let tunnelReady = false;
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('CONNECT test timed out.'));
        }, 2_000);
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.write(
            `CONNECT rebind.invalid:${destinationPort} HTTP/1.1\r\nHost: rebind.invalid:${destinationPort}\r\n\r\n`,
          );
        });
        socket.on('data', (chunk: Buffer) => {
          received += chunk.toString('latin1');
          if (!tunnelReady && received.includes('\r\n\r\n')) {
            tunnelReady = true;
            expect(received).toContain('200 Connection Established');
            received = '';
            socket.write('pinned-connect');
            return;
          }
          if (tunnelReady && received.includes('pinned-connect')) {
            clearTimeout(timer);
            socket.end();
            resolve(received);
          }
        });
      });

      expect(echoed).toContain('pinned-connect');
      expect(lookups).toBe(1);
    } finally {
      await proxy.close();
      await closeServer(destination);
    }
  });
});
