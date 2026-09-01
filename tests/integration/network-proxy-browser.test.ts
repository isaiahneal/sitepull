import http from 'node:http';
import dgram from 'node:dgram';
import { mkdir, rm } from 'node:fs/promises';
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
