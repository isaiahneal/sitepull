import { createServer } from 'node:http';
import net from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  assertNetworkUrlAllowed,
  cancelResponseBody,
  fetchValidatedResource,
  hostnameResolvesPrivate,
  isPrivateAddress,
  readBoundedResponseBody,
  type NetworkAddressLookup,
  type ResourceFetch,
} from './network-policy.js';

function fakeFetch(responses: readonly Response[]): {
  readonly fetch: ResourceFetch;
  readonly calls: Array<{ url: string; init: RequestInit }>;
} {
  const queue = [...responses];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      const response = queue.shift();
      return response === undefined
        ? Promise.reject(new Error('Unexpected fake request.'))
        : Promise.resolve(response);
    },
  };
}

describe('validated streaming resource fetches', () => {
  it('pins the validated address into the production HTTP transport', async () => {
    let observedHost = '';
    const server = createServer((request, response) => {
      observedHost = request.headers.host ?? '';
      response.writeHead(200, {
        'Content-Length': '10',
        'Content-Type': 'application/json',
      });
      response.end('source map');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing test port.');
    let lookups = 0;
    const lookupAddresses: NetworkAddressLookup = () => {
      lookups += 1;
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
    };

    try {
      const result = await fetchValidatedResource(
        `http://rebind.invalid:${address.port}/source.js.map`,
        {
          allowPrivateHosts: true,
          timeoutMs: 1_000,
          lookupAddresses,
        },
      );
      await expect(readBoundedResponseBody(result.response, 100)).resolves.toEqual(
        Buffer.from('source map'),
      );
      expect(lookups).toBe(1);
      expect(observedHost).toBe(`rebind.invalid:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('uses manual redirects, validates each hop, and cancels redirect bodies', async () => {
    const redirect = new Response('redirect', {
      status: 302,
      headers: { location: 'https://1.1.1.1/final.map' },
    });
    const final = new Response('source map', { status: 200 });
    const request = fakeFetch([redirect, final]);

    const result = await fetchValidatedResource('https://8.8.8.8/source.js.map', {
      allowPrivateHosts: false,
      timeoutMs: 1_234,
      fetch: request.fetch,
    });

    expect(result).toEqual({ response: final, finalUrl: 'https://1.1.1.1/final.map' });
    expect(request.calls.map(({ url }) => url)).toEqual([
      'https://8.8.8.8/source.js.map',
      'https://1.1.1.1/final.map',
    ]);
    expect(
      request.calls.every(({ init }) => init.redirect === 'manual' && init.cache === 'no-store'),
    ).toBe(true);
    expect(redirect.bodyUsed).toBe(true);
    expect(final.bodyUsed).toBe(false);
    await cancelResponseBody(final);
  });

  it('routes every production redirect hop through the supplied connection factory', async () => {
    let observedUserAgent = '';
    const server = createServer((request, response) => {
      if (request.url === '/start.map') {
        response.writeHead(302, { Location: `http://second.invalid:${port}/final.map` });
        response.end();
        return;
      }
      observedUserAgent = request.headers['user-agent'] ?? '';
      response.end('routed source map');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing test port.');
    const port = address.port;
    const routedHosts: string[] = [];

    try {
      const result = await fetchValidatedResource(`http://first.invalid:${port}/start.map`, {
        allowPrivateHosts: true,
        timeoutMs: 1_000,
        lookupAddresses: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
        connectionFactory: (target, targetPort, signal) =>
          new Promise((resolve, reject) => {
            routedHosts.push(target.hostname);
            const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
            const abort = (): void => {
              socket.destroy();
              reject(
                signal?.reason instanceof Error
                  ? signal.reason
                  : new Error('The routed test connection was aborted.', {
                      cause: signal?.reason,
                    }),
              );
            };
            socket.once('connect', () => {
              signal?.removeEventListener('abort', abort);
              resolve(socket);
            });
            socket.once('error', reject);
            signal?.addEventListener('abort', abort, { once: true });
          }),
        headersForUrl: () => ({ 'user-agent': 'Sitepull-SourceMap-Test/1.0' }),
      });
      await expect(readBoundedResponseBody(result.response, 100)).resolves.toEqual(
        Buffer.from('routed source map'),
      );
      expect(result.finalUrl).toBe(`http://second.invalid:${port}/final.map`);
      expect(routedHosts).toEqual(['first.invalid', 'second.invalid']);
      expect(observedUserAgent).toBe('Sitepull-SourceMap-Test/1.0');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('blocks a redirect to loopback before requesting it and cancels the redirect body', async () => {
    const redirect = new Response('redirect', {
      status: 302,
      headers: { location: 'http://127.0.0.1/internal.map' },
    });
    const request = fakeFetch([redirect]);

    await expect(
      fetchValidatedResource('https://8.8.8.8/source.js.map', {
        allowPrivateHosts: false,
        timeoutMs: 1_234,
        fetch: request.fetch,
      }),
    ).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_BLOCKED', retryable: false });
    expect(request.calls).toHaveLength(1);
    expect(redirect.bodyUsed).toBe(true);
  });

  it('cancels the terminal redirect body when the explicit redirect limit is exceeded', async () => {
    const redirect = new Response('redirect', {
      status: 302,
      headers: { location: 'https://1.1.1.1/final.map' },
    });
    const request = fakeFetch([redirect]);

    await expect(
      fetchValidatedResource('https://8.8.8.8/source.js.map', {
        allowPrivateHosts: false,
        timeoutMs: 1_234,
        maxRedirects: 0,
        fetch: request.fetch,
      }),
    ).rejects.toMatchObject({ code: 'CRAWL_FAILED', retryable: false });
    expect(request.calls).toHaveLength(1);
    expect(redirect.bodyUsed).toBe(true);
  });

  it('materializes a response stream only up to the caller-provided byte ceiling', async () => {
    const accepted = new Response(Buffer.from('four'));
    const rejected = new Response(Buffer.from('five!'));

    await expect(readBoundedResponseBody(accepted, 4)).resolves.toEqual(Buffer.from('four'));
    await expect(readBoundedResponseBody(rejected, 4)).rejects.toMatchObject({
      code: 'RESOURCE_TOO_LARGE',
      details: { maxBytes: 4 },
    });
  });
});

describe('DNS verdict lifetime', () => {
  it('does not cache a public verdict across calls', async () => {
    let calls = 0;
    const lookupAddresses: NetworkAddressLookup = () => {
      calls += 1;
      return Promise.resolve([
        calls === 1 ? { address: '8.8.8.8', family: 4 } : { address: '127.0.0.1', family: 4 },
      ]);
    };

    await expect(hostnameResolvesPrivate('rebind.invalid', lookupAddresses)).resolves.toBe(false);
    await expect(hostnameResolvesPrivate('rebind.invalid', lookupAddresses)).resolves.toBe(true);
    expect(calls).toBe(2);
  });
});

describe('IPv6 network policy', () => {
  it.each(['::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])(
    'classifies %s as private or local',
    (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    },
  );

  it('does not classify an IPv4-mapped public address as private', () => {
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it.each(['http://[::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/'])(
    'blocks bracketed private target %s',
    async (url) => {
      await expect(assertNetworkUrlAllowed(url, false)).rejects.toMatchObject({
        code: 'PRIVATE_NETWORK_BLOCKED',
        retryable: false,
      });
    },
  );
});
