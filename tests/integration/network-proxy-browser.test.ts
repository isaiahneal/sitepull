import http from 'node:http';
import dgram from 'node:dgram';
import { mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { webkit } from 'playwright';
import { describe, expect, it } from 'vitest';

import { createNetworkPolicyProxy } from '../../packages/core/src/network-proxy.js';
import { installUntrustedPageNetworkGuards } from '../../packages/core/src/browser-network-policy.js';
import { runCapture } from '../../packages/core/src/run-capture.js';

function listen(server: http.Server): Promise<number> {
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

function closeServer(server: http.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createFirstTunnelThenRejectProxy(): {
  readonly server: http.Server;
  readonly connections: { count: number };
  close(): Promise<void>;
} {
  const connections = { count: 0 };
  const sockets = new Set<net.Socket>();
  const server = http.createServer();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('connect', (request, clientSocket, head) => {
    connections.count += 1;
    if (connections.count > 1) {
      clientSocket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }

    const target = new URL(`http://${request.url ?? ''}`);
    const upstream = net.createConnection({
      host: target.hostname,
      port: Number.parseInt(target.port, 10),
    });
    sockets.add(upstream);
    upstream.once('close', () => sockets.delete(upstream));
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
    connections,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}

describe('browser network-policy proxy', () => {
  it('surfaces a WebKit CONNECT proxy-auth failure without page retries or direct fallback', async () => {
    let proxyConnects = 0;
    let pageRetryEvents = 0;
    const upstreamProxy = http.createServer();
    upstreamProxy.on('connect', (_request, clientSocket) => {
      proxyConnects += 1;
      clientSocket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    });
    const upstreamProxyPort = await listen(upstreamProxy);
    const outputRoot = path.join(os.tmpdir(), `sitepull-webkit-proxy-${crypto.randomUUID()}`);
    await mkdir(outputRoot);

    try {
      let failure: unknown;
      try {
        await runCapture(
          {
            url: 'https://203.0.113.10/',
            outputDirectory: outputRoot,
            config: {
              engine: 'webkit',
              maxDepth: 0,
              maxPages: 1,
              crawlConcurrency: 1,
              pageTimeoutMs: 5_000,
              viewports: [{ name: 'desktop', width: 800, height: 600 }],
            },
          },
          {
            allowPrivateHosts: false,
            onEvent: (event) => {
              if (event.type === 'progress' && event.message.startsWith('Retrying ')) {
                pageRetryEvents += 1;
              }
            },
            proxyPool: {
              entries: [{ server: `http://127.0.0.1:${upstreamProxyPort}` }],
              selection: 'round-robin',
              jitter: { minMs: 0, maxMs: 0 },
            },
          },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: 'UPSTREAM_PROXY_AUTH_REQUIRED',
        retryable: false,
      });
      expect(proxyConnects).toBeGreaterThan(0);
      expect(pageRetryEvents).toBe(0);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
      await closeServer(upstreamProxy);
    }
  }, 30_000);

  it('preserves an HTTP navigation error after a same-host subresource proxy failure', async () => {
    let destinationRequests = 0;
    const destination = http.createServer((request, response) => {
      destinationRequests += 1;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Connection', 'close');
      response.statusCode = request.url === '/' ? 403 : 200;
      response.end(
        request.url === '/'
          ? '<!doctype html><html><head><script src="/blocked.js"></script></head><body>forbidden</body></html>'
          : 'globalThis.blockedScriptLoaded = true;',
      );
    });
    const destinationPort = await listen(destination);
    const upstreamProxy = createFirstTunnelThenRejectProxy();
    const upstreamProxyPort = await listen(upstreamProxy.server);
    const outputRoot = path.join(os.tmpdir(), `sitepull-webkit-proxy-mask-${crypto.randomUUID()}`);
    await mkdir(outputRoot);

    try {
      await expect(
        runCapture(
          {
            url: `http://127.0.0.1:${destinationPort}/`,
            outputDirectory: outputRoot,
            config: {
              engine: 'webkit',
              maxDepth: 0,
              maxPages: 1,
              crawlConcurrency: 1,
              pageTimeoutMs: 5_000,
              viewports: [{ name: 'desktop', width: 800, height: 600 }],
            },
          },
          {
            allowPrivateHosts: true,
            proxyPool: {
              entries: [{ server: `http://127.0.0.1:${upstreamProxyPort}` }],
              selection: 'round-robin',
              jitter: { minMs: 0, maxMs: 0 },
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'HTTP_FORBIDDEN', retryable: false });
      expect(upstreamProxy.connections.count).toBeGreaterThanOrEqual(2);
      expect(destinationRequests).toBe(1);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
      await upstreamProxy.close();
      await closeServer(destination);
    }
  }, 30_000);

  it('routes loopback navigation through the policy proxy instead of bypassing it', async () => {
    let destinationRequests = 0;
    const destination = http.createServer((_request, response) => {
      destinationRequests += 1;
      response.end('direct browser connection must not succeed');
    });
    const destinationPort = await listen(destination);
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: false,
      connectTimeoutMs: 2_000,
    });
    const browser = await webkit.launch({ headless: true });

    try {
      const context = await browser.newContext({
        proxy: { server: proxy.serverUrl },
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      const response = await page.goto(`http://127.0.0.1:${destinationPort}/private`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status()).toBe(403);
      await expect(page.textContent('body')).resolves.toContain(
        'Blocked by Sitepull network policy.',
      );
      expect(destinationRequests).toBe(0);
      await context.close();
    } finally {
      await browser.close();
      await proxy.close();
      await closeServer(destination);
    }
  });

  it('removes UDP-capable page transports before hostile WebKit scripts run', async () => {
    const destination = http.createServer((_request, response) => response.end('guarded'));
    const destinationPort = await listen(destination);
    const udp = dgram.createSocket('udp4');
    let udpPackets = 0;
    udp.on('message', () => {
      udpPackets += 1;
    });
    await new Promise<void>((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(0, '127.0.0.1', resolve);
    });
    const udpAddress = udp.address();
    if (typeof udpAddress === 'string') throw new Error('UDP test socket has no numeric port.');
    const proxy = await createNetworkPolicyProxy({
      allowPrivateHosts: true,
      connectTimeoutMs: 2_000,
    });
    const browser = await webkit.launch({ headless: true });

    try {
      const context = await browser.newContext({
        proxy: { server: proxy.serverUrl },
        serviceWorkers: 'block',
      });
      await installUntrustedPageNetworkGuards(context, 'webkit');
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${destinationPort}/guarded`);
      const availability = await page.evaluate(
        ({ port }) => {
          const PeerConnection = globalThis.RTCPeerConnection;
          if (typeof PeerConnection === 'function') {
            const peer = new PeerConnection({
              iceServers: [{ urls: `stun:127.0.0.1:${port}` }],
            });
            void peer.createOffer().then((offer) => peer.setLocalDescription(offer));
          }
          return {
            rtc: typeof globalThis.RTCPeerConnection,
            webTransport: typeof globalThis.WebTransport,
            worker: typeof globalThis.Worker,
            sharedWorker: typeof globalThis.SharedWorker,
          };
        },
        { port: udpAddress.port },
      );
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(availability).toEqual({
        rtc: 'undefined',
        webTransport: 'undefined',
        worker: 'undefined',
        sharedWorker: 'undefined',
      });
      expect(udpPackets).toBe(0);
      await context.close();
    } finally {
      await browser.close();
      await proxy.close();
      udp.close();
      await closeServer(destination);
    }
  });
});
