import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';

import { SitepullError } from './errors.js';
import {
  createPinnedLookup,
  resolveNetworkTarget,
  type NetworkAddressLookup,
  type ResolvedNetworkTarget,
} from './network-policy.js';

export interface NetworkPolicyProxyOptions {
  readonly allowPrivateHosts: boolean;
  readonly connectTimeoutMs: number;
  readonly lookupAddresses?: NetworkAddressLookup;
  readonly onError?: (error: unknown, target: string | null) => void;
}

export interface NetworkPolicyProxy {
  readonly serverUrl: string;
  close(): Promise<void>;
}

type PinnedRequestOptions = http.RequestOptions & {
  readonly autoSelectFamily: boolean;
  readonly servername?: string;
};

function proxyTarget(request: IncomingMessage): URL {
  const raw = request.url ?? '';
  let target: URL;
  try {
    target = /^https?:\/\//iu.test(raw)
      ? new URL(raw)
      : new URL(raw, `http://${request.headers.host ?? ''}`);
  } catch (cause) {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: 'The browser proxy received an invalid target URL.',
      stage: 'validation',
      details: { url: raw },
      cause,
    });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new SitepullError({
      code: 'UNSUPPORTED_PROTOCOL',
      message: `The browser proxy does not support ${target.protocol}`,
      stage: 'validation',
      details: { url: target.href },
    });
  }
  if (target.username !== '' || target.password !== '') {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: 'Proxy target URLs cannot contain embedded credentials.',
      stage: 'validation',
      details: { url: target.href },
    });
  }
  return target;
}

function upstreamHeaders(request: IncomingMessage, target: URL): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...request.headers, host: target.host };
  delete headers['proxy-authorization'];
  delete headers['proxy-connection'];
  return headers;
}

function requestOptions(
  request: IncomingMessage,
  target: URL,
  resolved: ResolvedNetworkTarget,
): PinnedRequestOptions {
  return {
    protocol: target.protocol,
    hostname: resolved.hostname,
    port: target.port === '' ? undefined : Number.parseInt(target.port, 10),
    method: request.method ?? 'GET',
    path: `${target.pathname}${target.search}`,
    headers: upstreamHeaders(request, target),
    lookup: createPinnedLookup(resolved.addresses),
    autoSelectFamily: resolved.addresses.length > 1,
    agent: false,
    ...(target.protocol === 'https:' && net.isIP(resolved.hostname) === 0
      ? { servername: resolved.hostname }
      : {}),
  };
}

function errorStatus(error: unknown): number {
  return error instanceof SitepullError && error.code === 'PRIVATE_NETWORK_BLOCKED' ? 403 : 502;
}

function failHttpResponse(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  const status = errorStatus(error);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    Connection: 'close',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Sitepull-Proxy': 'network-policy',
  });
  response.end(
    status === 403 ? 'Blocked by Sitepull network policy.\n' : 'Sitepull proxy error.\n',
  );
}

function failSocket(socket: Duplex, error: unknown): void {
  if (!socket.destroyed) {
    const status = errorStatus(error);
    socket.end(
      `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }
}

function authority(value: string | undefined): { hostname: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(`http://${value ?? ''}`);
  } catch (cause) {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: 'The browser proxy received an invalid CONNECT authority.',
      stage: 'validation',
      details: { authority: value ?? '' },
      cause,
    });
  }
  const port = parsed.port === '' ? 443 : Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: 'The browser proxy received an invalid CONNECT port.',
      stage: 'validation',
      details: { authority: value ?? '' },
    });
  }
  return { hostname: parsed.hostname, port };
}

function rawUpgradeRequest(request: IncomingMessage, target: URL): Buffer {
  const headers = upstreamHeaders(request, target);
  const lines = [`${request.method ?? 'GET'} ${target.pathname}${target.search} HTTP/1.1`];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`);
    } else {
      lines.push(`${name}: ${String(value)}`);
    }
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
}

/**
 * Starts a loopback-only forward proxy. DNS is resolved by Sitepull exactly once
 * per upstream socket and the validated address set is injected into Node's
 * connection lookup, preventing the browser from resolving the target again.
 */
export async function createNetworkPolicyProxy(
  options: NetworkPolicyProxyOptions,
): Promise<NetworkPolicyProxy> {
  if (!Number.isSafeInteger(options.connectTimeoutMs) || options.connectTimeoutMs < 1) {
    throw new RangeError('connectTimeoutMs must be a positive safe integer.');
  }

  let closed = false;
  const sockets = new Set<Duplex>();
  const requests = new Set<http.ClientRequest>();
  const trackSocket = (socket: Duplex): void => {
    if (closed) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const trackRequest = (request: http.ClientRequest, protocol: string): void => {
    requests.add(request);
    request.once('close', () => requests.delete(request));
    const timer = setTimeout(() => {
      request.destroy(new Error('Sitepull proxy upstream connection timed out.'));
    }, options.connectTimeoutMs);
    timer.unref();
    const clearTimer = (): void => clearTimeout(timer);
    request.once('error', clearTimer);
    request.once('response', clearTimer);
    request.once('socket', (socket) => {
      if (closed) {
        clearTimer();
        request.destroy();
        socket.destroy();
        return;
      }
      trackSocket(socket);
      if (protocol === 'https:') socket.once('secureConnect', clearTimer);
      else if (socket.connecting) socket.once('connect', clearTimer);
      else clearTimer();
      socket.once('close', clearTimer);
    });
  };
  const ensureOpen = (): void => {
    if (closed) throw new Error('Sitepull network proxy is closed.');
  };
  const report = (error: unknown, target: string | null): void => {
    try {
      options.onError?.(error, target);
    } catch {
      // Diagnostics cannot change proxy enforcement.
    }
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      let target: URL | undefined;
      try {
        target = proxyTarget(request);
        const resolved = await resolveNetworkTarget(
          target.hostname,
          options.allowPrivateHosts,
          options.lookupAddresses,
        );
        ensureOpen();
        const transport = target.protocol === 'https:' ? https : http;
        const upstream = transport.request(requestOptions(request, target, resolved), (message) => {
          response.writeHead(message.statusCode ?? 502, message.statusMessage, message.headers);
          message.pipe(response);
        });
        trackRequest(upstream, target.protocol);
        upstream.once('error', (error) => {
          if (closed) return;
          report(error, target?.href ?? null);
          failHttpResponse(response, error);
        });
        request.once('aborted', () => upstream.destroy());
        response.once('close', () => {
          if (!response.writableEnded) upstream.destroy();
        });
        request.pipe(upstream);
      } catch (error) {
        if (closed) return;
        report(error, target?.href ?? null);
        failHttpResponse(response, error);
      }
    })();
  });

  server.on('connect', (request, clientSocket, head) => {
    void (async () => {
      let target: { hostname: string; port: number } | undefined;
      try {
        target = authority(request.url);
        const resolved = await resolveNetworkTarget(
          target.hostname,
          options.allowPrivateHosts,
          options.lookupAddresses,
        );
        ensureOpen();
        const upstream = net.createConnection({
          host: resolved.hostname,
          port: target.port,
          lookup: createPinnedLookup(resolved.addresses),
          autoSelectFamily: resolved.addresses.length > 1,
        });
        trackSocket(upstream);
        const timer = setTimeout(() => {
          upstream.destroy(new Error('Sitepull proxy CONNECT timed out.'));
        }, options.connectTimeoutMs);
        timer.unref();
        upstream.once('connect', () => {
          clearTimeout(timer);
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.byteLength > 0) upstream.write(head);
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        });
        upstream.once('error', (error) => {
          clearTimeout(timer);
          if (closed) return;
          report(error, target === undefined ? null : `${target.hostname}:${target.port}`);
          failSocket(clientSocket, error);
        });
        clientSocket.once('error', () => upstream.destroy());
        clientSocket.once('close', () => upstream.destroy());
      } catch (error) {
        if (closed) return;
        report(error, target === undefined ? null : `${target.hostname}:${target.port}`);
        failSocket(clientSocket, error);
      }
    })();
  });

  server.on('upgrade', (request, clientSocket, head) => {
    void (async () => {
      let target: URL | undefined;
      try {
        const raw = request.url ?? '';
        target = /^w?s?:\/\//iu.test(raw)
          ? new URL(raw)
          : new URL(raw, `ws://${request.headers.host ?? ''}`);
        if (target.protocol !== 'ws:' && target.protocol !== 'http:') {
          throw new SitepullError({
            code: 'UNSUPPORTED_PROTOCOL',
            message: `The browser proxy cannot directly upgrade ${target.protocol}`,
            stage: 'validation',
            details: { url: target.href },
          });
        }
        const resolved = await resolveNetworkTarget(
          target.hostname,
          options.allowPrivateHosts,
          options.lookupAddresses,
        );
        ensureOpen();
        const port = target.port === '' ? 80 : Number.parseInt(target.port, 10);
        const upstream = net.createConnection({
          host: resolved.hostname,
          port,
          lookup: createPinnedLookup(resolved.addresses),
          autoSelectFamily: resolved.addresses.length > 1,
        });
        trackSocket(upstream);
        const timer = setTimeout(() => {
          upstream.destroy(new Error('Sitepull proxy upgrade connection timed out.'));
        }, options.connectTimeoutMs);
        timer.unref();
        upstream.once('connect', () => {
          clearTimeout(timer);
          upstream.write(rawUpgradeRequest(request, target as URL));
          if (head.byteLength > 0) upstream.write(head);
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        });
        upstream.once('error', (error) => {
          clearTimeout(timer);
          if (closed) return;
          report(error, target?.href ?? null);
          failSocket(clientSocket, error);
        });
        clientSocket.once('error', () => upstream.destroy());
        clientSocket.once('close', () => upstream.destroy());
      } catch (error) {
        if (closed) return;
        report(error, target?.href ?? null);
        failSocket(clientSocket, error);
      }
    })();
  });

  server.on('connection', trackSocket);
  server.keepAliveTimeout = 5_000;
  server.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  server.unref();
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Sitepull network proxy did not expose a TCP port.');
  }

  let closePromise: Promise<void> | undefined;
  return {
    serverUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      closePromise ??= new Promise<void>((resolve, reject) => {
        closed = true;
        for (const request of requests) request.destroy();
        for (const socket of sockets) socket.destroy();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return closePromise;
    },
  };
}
