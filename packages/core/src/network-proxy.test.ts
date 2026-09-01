import http, { createServer as createHttpServer } from 'node:http';
import net, { createServer as createNetServer } from 'node:net';
import tls from 'node:tls';

import { describe, expect, it } from 'vitest';

import { SitepullError } from './errors.js';
import { createNetworkPolicyProxy } from './network-proxy.js';
import type { NetworkAddressLookup } from './network-policy.js';
import { createOutboundRouter } from './upstream-proxy.js';

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
  readonly proxyMarker: string | null;
  readonly proxyError: string | null;
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
          const proxyMarker = response.headers['x-sitepull-proxy'];
          const proxyError = response.headers['x-sitepull-proxy-error'];
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            proxyMarker: typeof proxyMarker === 'string' ? proxyMarker : null,
            proxyError: typeof proxyError === 'string' ? proxyError : null,
          });
        });
      },
    );
    request.once('error', reject);
  });
}

interface ConnectProxyFixture {
  readonly server: http.Server;
  readonly authorities: string[];
  readonly authorizations: Array<string | undefined>;
  readonly connections: { count: number };
  close(): Promise<void>;
}

function createConnectProxy(status = 200): ConnectProxyFixture {
  const authorities: string[] = [];
  const authorizations: Array<string | undefined> = [];
  const connections = { count: 0 };
  const sockets = new Set<net.Socket>();
  const server = createHttpServer();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('connect', (request, clientSocket, head) => {
    connections.count += 1;
    const authority = request.url ?? '';
    authorities.push(authority);
    authorizations.push(request.headers['proxy-authorization']);
    if (status !== 200) {
      clientSocket.end(
        `HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
      return;
    }

    const parsed = new URL(`http://${authority}`);
    const upstream = net.createConnection({
      host: parsed.hostname,
      port: Number.parseInt(parsed.port, 10),
    });
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.byteLength > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
    upstream.once('error', () => {
      if (!clientSocket.destroyed) {
        clientSocket.end(
          'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
        );
      }
    });
    clientSocket.once('error', () => upstream.destroy());
    clientSocket.once('close', () => upstream.destroy());
  });
  return {
    server,
    authorities,
    authorizations,
    connections,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
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
      ).resolves.toEqual({
        status: 200,
        body: 'pinned-http',
        proxyMarker: null,
        proxyError: null,
      });
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

  it('strips reserved policy markers supplied by an origin response', async () => {
    const destination = createHttpServer((_request, response) => {
      response.setHeader('X-Sitepull-Proxy', 'network-policy');
      response.setHeader('X-Sitepull-Proxy-Error', 'UPSTREAM_PROXY_AUTH_REQUIRED');
      response.setHeader('X-Sitepull-Proxy-Future', 'must-also-be-stripped');
      response.end('untrusted-origin');
    });
    const destinationPort = await listen(destination);
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    });

    try {
      await expect(
        getThroughProxy(proxy.serverUrl, `http://origin.invalid:${destinationPort}/spoof`),
      ).resolves.toEqual({
        status: 200,
        body: 'untrusted-origin',
        proxyMarker: null,
        proxyError: null,
      });
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

  it('uses Basic auth only on a numeric upstream CONNECT while retaining the origin Host', async () => {
    let observedHost = '';
    let observedProxyAuthorization: string | undefined;
    const destination = createHttpServer((request, response) => {
      observedHost = request.headers.host ?? '';
      observedProxyAuthorization = request.headers['proxy-authorization'];
      response.end('through-authenticated-proxy');
    });
    const destinationPort = await listen(destination);
    const upstreamProxy = createConnectProxy();
    const upstreamProxyPort = await listen(upstreamProxy.server);
    const credentials = { username: 'sitepull-user', password: 'correct horse battery staple' };
    const expectedAuthorization = `Basic ${Buffer.from(
      `${credentials.username}:${credentials.password}`,
      'utf8',
    ).toString('base64')}`;
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      proxyPool: {
        entries: [{ server: `http://127.0.0.1:${upstreamProxyPort}`, credentials }],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
    });

    try {
      await expect(
        getThroughProxy(proxy.serverUrl, `http://rebind.invalid:${destinationPort}/proxied`),
      ).resolves.toEqual({
        status: 200,
        body: 'through-authenticated-proxy',
        proxyMarker: null,
        proxyError: null,
      });
      expect(upstreamProxy.authorities).toEqual([`127.0.0.1:${destinationPort}`]);
      expect(upstreamProxy.authorizations).toEqual([expectedAuthorization]);
      expect(observedHost).toBe(`rebind.invalid:${destinationPort}`);
      expect(observedProxyAuthorization).toBeUndefined();
    } finally {
      await proxy.close();
      await upstreamProxy.close();
      await closeServer(destination);
    }
  });

  it('alternates upstream proxies per new outbound connection', async () => {
    const destination = createHttpServer((_request, response) => response.end('alternating'));
    const destinationPort = await listen(destination);
    const first = createConnectProxy();
    const second = createConnectProxy();
    const firstPort = await listen(first.server);
    const secondPort = await listen(second.server);
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      proxyPool: {
        entries: [
          { server: `http://127.0.0.1:${firstPort}` },
          { server: `http://127.0.0.1:${secondPort}` },
        ],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
    });

    try {
      await getThroughProxy(proxy.serverUrl, `http://alternating.invalid:${destinationPort}/one`);
      await getThroughProxy(proxy.serverUrl, `http://alternating.invalid:${destinationPort}/two`);
      expect(first.connections.count).toBe(1);
      expect(second.connections.count).toBe(1);
    } finally {
      await proxy.close();
      await first.close();
      await second.close();
      await closeServer(destination);
    }
  });

  it('fails closed on proxy rejection and never serializes credentials', async () => {
    let destinationRequests = 0;
    const destination = createHttpServer((_request, response) => {
      destinationRequests += 1;
      response.end('direct fallback must not happen');
    });
    const destinationPort = await listen(destination);
    const upstreamProxy = createConnectProxy(407);
    const upstreamProxyPort = await listen(upstreamProxy.server);
    const password = 'never-log-this-proxy-password';
    const authorization = `Basic ${Buffer.from(`alice:${password}`, 'utf8').toString('base64')}`;
    const observedErrors: unknown[] = [];
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      proxyPool: {
        entries: [
          {
            server: `http://127.0.0.1:${upstreamProxyPort}`,
            credentials: { username: 'alice', password },
          },
        ],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
      onError: (error) => observedErrors.push(error),
    });

    try {
      const attemptStartedAt = Date.now();
      const result = await getThroughProxy(
        proxy.serverUrl,
        `http://no-fallback.invalid:${destinationPort}/blocked`,
      );
      expect(result.status).toBe(502);
      expect(result.proxyMarker).toBe('network-policy');
      expect(result.proxyError).toBe('UPSTREAM_PROXY_AUTH_REQUIRED');
      expect(destinationRequests).toBe(0);
      expect(upstreamProxy.authorizations).toEqual([authorization]);
      const serialized = observedErrors
        .map((error) =>
          error instanceof SitepullError ? JSON.stringify(error.toJSON()) : String(error),
        )
        .join('\n');
      expect(serialized).toContain('UPSTREAM_PROXY_AUTH_REQUIRED');
      expect(serialized).not.toContain(password);
      expect(serialized).not.toContain(authorization);
      expect(
        proxy.upstreamErrorFor(
          `http://no-fallback.invalid:${destinationPort}/blocked`,
          attemptStartedAt,
        ),
      ).toMatchObject({ code: 'UPSTREAM_PROXY_AUTH_REQUIRED', retryable: false });
    } finally {
      await proxy.close();
      await upstreamProxy.close();
      await closeServer(destination);
    }
  });

  it('supports injected random selection and bounded jitter', async () => {
    const destination = createNetServer((socket) => socket.pipe(socket));
    const destinationPort = await listen(destination);
    const first = createConnectProxy();
    const second = createConnectProxy();
    const firstPort = await listen(first.server);
    const secondPort = await listen(second.server);
    const delays: number[] = [];
    const selectedIntegers = [1, 17];
    const router = createOutboundRouter({
      connectTimeoutMs: 1_000,
      proxyPool: {
        entries: [
          { server: `http://127.0.0.1:${firstPort}` },
          { server: `http://127.0.0.1:${secondPort}` },
        ],
        selection: 'random',
        jitter: { minMs: 10, maxMs: 20 },
      },
      randomInteger: (minimum, maximumExclusive) => {
        const selected = selectedIntegers.shift();
        if (selected === undefined) throw new Error('Random test sequence exhausted.');
        expect(selected).toBeGreaterThanOrEqual(minimum);
        expect(selected).toBeLessThan(maximumExclusive);
        return selected;
      },
      jitterDelay: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    try {
      const socket = await router.open(
        {
          hostname: 'random.invalid',
          addresses: [{ address: '127.0.0.1', family: 4 }],
        },
        destinationPort,
      );
      socket.destroy();
      expect(delays).toEqual([17]);
      expect(first.connections.count).toBe(0);
      expect(second.connections.count).toBe(1);
    } finally {
      router.close();
      await first.close();
      await second.close();
      await closeServer(destination);
    }
  });

  it('nests browser CONNECT tunnels through a numeric upstream CONNECT', async () => {
    const destination = createNetServer((socket) => socket.pipe(socket));
    const destinationPort = await listen(destination);
    const upstreamProxy = createConnectProxy();
    const upstreamProxyPort = await listen(upstreamProxy.server);
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 1_000,
      lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
      proxyPool: {
        entries: [{ server: `http://127.0.0.1:${upstreamProxyPort}` }],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
    });
    const localProxy = new URL(proxy.serverUrl);

    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection({
          host: localProxy.hostname,
          port: Number.parseInt(localProxy.port, 10),
        });
        let received = '';
        let tunnelReady = false;
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error('Nested CONNECT test timed out.'));
        }, 2_000);
        socket.once('error', reject);
        socket.once('connect', () => {
          socket.write(
            `CONNECT secure.invalid:${destinationPort} HTTP/1.1\r\nHost: secure.invalid:${destinationPort}\r\n\r\n`,
          );
        });
        socket.on('data', (chunk: Buffer) => {
          received += chunk.toString('latin1');
          if (!tunnelReady && received.includes('\r\n\r\n')) {
            tunnelReady = true;
            expect(received).toContain('200 Connection Established');
            received = '';
            socket.write('nested-connect');
            return;
          }
          if (tunnelReady && received.includes('nested-connect')) {
            clearTimeout(timer);
            socket.end();
            resolve(received);
          }
        });
      });

      expect(echoed).toContain('nested-connect');
      expect(upstreamProxy.authorities).toEqual([`127.0.0.1:${destinationPort}`]);
    } finally {
      await proxy.close();
      await upstreamProxy.close();
      await closeServer(destination);
    }
  });

  it('cancels during jitter before opening an upstream connection', async () => {
    const upstreamProxy = createConnectProxy();
    const upstreamProxyPort = await listen(upstreamProxy.server);
    const router = createOutboundRouter({
      connectTimeoutMs: 60_000,
      proxyPool: {
        entries: [{ server: `http://127.0.0.1:${upstreamProxyPort}` }],
        selection: 'round-robin',
        jitter: { minMs: 30_000, maxMs: 30_000 },
      },
    });
    const abort = new AbortController();

    try {
      const pending = router.open(
        {
          hostname: 'cancelled.invalid',
          addresses: [{ address: '127.0.0.1', family: 4 }],
        },
        443,
        abort.signal,
      );
      abort.abort(new Error('test cancellation'));
      await expect(pending).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });
      expect(upstreamProxy.connections.count).toBe(0);
    } finally {
      router.close();
      await upstreamProxy.close();
    }
  });

  it('returns promptly when cancellation wins a stalled proxy DNS lookup', async () => {
    let markLookupStarted: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const router = createOutboundRouter({
      connectTimeoutMs: 60_000,
      proxyPool: {
        entries: [{ server: 'http://stalled-proxy.invalid:8080' }],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
      lookupProxyAddresses: async () => {
        markLookupStarted?.();
        return new Promise<never>(() => undefined);
      },
    });
    const abort = new AbortController();

    try {
      const pending = router.open(
        {
          hostname: 'cancelled.invalid',
          addresses: [{ address: '203.0.113.10', family: 4 }],
        },
        443,
        abort.signal,
      );
      await lookupStarted;
      abort.abort(new Error('cancel stalled proxy DNS'));
      await expect(pending).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });
    } finally {
      router.close();
    }
  });

  it('requires a valid TLS handshake for HTTPS proxy endpoints', async () => {
    const invalidTlsProxy = tls.createServer();
    invalidTlsProxy.on('tlsClientError', () => undefined);
    const invalidTlsProxyPort = await listen(invalidTlsProxy);
    const router = createOutboundRouter({
      connectTimeoutMs: 1_000,
      proxyPool: {
        entries: [{ server: `https://127.0.0.1:${invalidTlsProxyPort}` }],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
    });

    try {
      await expect(
        router.open(
          {
            hostname: 'secure-proxy.invalid',
            addresses: [{ address: '203.0.113.10', family: 4 }],
          },
          443,
        ),
      ).rejects.toMatchObject({ code: 'UPSTREAM_PROXY_TLS_FAILED' });
    } finally {
      router.close();
      await closeServer(invalidTlsProxy);
    }
  });

  it('classifies HTTPS proxy TCP refusal as a connection failure', async () => {
    const releasedPortServer = createNetServer();
    const releasedPort = await listen(releasedPortServer);
    await closeServer(releasedPortServer);
    const router = createOutboundRouter({
      connectTimeoutMs: 1_000,
      proxyPool: {
        entries: [{ server: `https://127.0.0.1:${releasedPort}` }],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
    });

    try {
      await expect(
        router.open(
          {
            hostname: 'secure-proxy.invalid',
            addresses: [{ address: '203.0.113.10', family: 4 }],
          },
          443,
        ),
      ).rejects.toMatchObject({ code: 'UPSTREAM_PROXY_CONNECT_FAILED' });
    } finally {
      router.close();
    }
  });

  it('classifies a stalled HTTPS proxy handshake timeout as a connection failure', async () => {
    const acceptedSockets = new Set<net.Socket>();
    const stalledProxy = createNetServer((socket) => {
      acceptedSockets.add(socket);
      socket.once('close', () => acceptedSockets.delete(socket));
    });
    const stalledProxyPort = await listen(stalledProxy);
    const router = createOutboundRouter({
      connectTimeoutMs: 50,
      proxyPool: {
        entries: [{ server: `https://127.0.0.1:${stalledProxyPort}` }],
        selection: 'round-robin',
        jitter: { minMs: 0, maxMs: 0 },
      },
    });

    try {
      await expect(
        router.open(
          {
            hostname: 'secure-proxy.invalid',
            addresses: [{ address: '203.0.113.10', family: 4 }],
          },
          443,
        ),
      ).rejects.toMatchObject({ code: 'UPSTREAM_PROXY_CONNECT_FAILED' });
    } finally {
      router.close();
      for (const socket of acceptedSockets) socket.destroy();
      await closeServer(stalledProxy);
    }
  });
});
