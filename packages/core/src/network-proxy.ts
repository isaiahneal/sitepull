import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';

import type { ProxyPoolRequest } from '@sitepull/contracts';

import { SitepullError } from './errors.js';
import { resolveNetworkTarget, type NetworkAddressLookup } from './network-policy.js';
import { createOutboundRouter, type OutboundConnectionFactory } from './upstream-proxy.js';

export interface NetworkPolicyProxyOptions {
  readonly allowPrivateHosts: boolean;
  readonly connectTimeoutMs: number;
  readonly lookupAddresses?: NetworkAddressLookup;
  readonly proxyPool?: ProxyPoolRequest;
  readonly signal?: AbortSignal;
  readonly onError?: (error: unknown, target: string | null) => void;
}

export interface NetworkPolicyProxy {
  readonly serverUrl: string;
  readonly openConnection: OutboundConnectionFactory;
  upstreamErrorFor(target: string, sinceMs: number): SitepullError | undefined;
  close(): Promise<void>;
}

interface TimedProxyError {
  readonly error: SitepullError;
  readonly occurredAtMs: number;
}

const MAX_TRACKED_PROXY_ERRORS = 128;

function isUpstreamProxyError(error: unknown): error is SitepullError {
  return (
    error instanceof SitepullError &&
    (error.code === 'UPSTREAM_PROXY_INVALID' ||
      error.code === 'UPSTREAM_PROXY_AUTH_REQUIRED' ||
      error.code === 'UPSTREAM_PROXY_TLS_FAILED' ||
      error.code === 'UPSTREAM_PROXY_CONNECT_FAILED')
  );
}

function targetKey(value: string): string | null {
  try {
    const absolute = /^https?:\/\//iu.test(value);
    const parsed = new URL(absolute ? value : `http://${value}`);
    const port =
      parsed.port === '' ? (absolute && parsed.protocol === 'http:' ? 80 : 443) : parsed.port;
    return `${parsed.hostname}:${port}`;
  } catch {
    return null;
  }
}

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

function downstreamHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const forwarded: http.OutgoingHttpHeaders = { ...headers };
  for (const name of Object.keys(forwarded)) {
    if (name.startsWith('x-sitepull-proxy')) delete forwarded[name];
  }
  return forwarded;
}

function requestOptions(
  request: IncomingMessage,
  target: URL,
  socket: Duplex,
): http.RequestOptions {
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => socket;
  return {
    protocol: 'http:',
    hostname: target.hostname,
    port:
      target.port === ''
        ? target.protocol === 'https:'
          ? 443
          : 80
        : Number.parseInt(target.port, 10),
    method: request.method ?? 'GET',
    path: `${target.pathname}${target.search}`,
    headers: upstreamHeaders(request, target),
    agent,
  };
}

function targetPort(target: URL): number {
  if (target.port !== '') return Number.parseInt(target.port, 10);
  return target.protocol === 'https:' ? 443 : 80;
}

async function originSocket(socket: Duplex, target: URL, signal: AbortSignal): Promise<Duplex> {
  if (target.protocol !== 'https:') return socket;
  if (signal.aborted) {
    socket.destroy();
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('The origin TLS handshake was aborted.', { cause: signal.reason });
  }

  const secureSocket = tls.connect({
    socket,
    rejectUnauthorized: true,
    ...(net.isIP(target.hostname) === 0 ? { servername: target.hostname } : {}),
  });
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      secureSocket.off('secureConnect', connected);
      secureSocket.off('error', failed);
      secureSocket.off('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const connected = (): void => {
      cleanup();
      resolve();
    };
    const failed = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const closed = (): void => {
      cleanup();
      reject(new Error('The origin TLS socket closed during its handshake.'));
    };
    const aborted = (): void => {
      cleanup();
      secureSocket.destroy();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('The origin TLS handshake was aborted.', { cause: signal.reason }),
      );
    };
    secureSocket.once('secureConnect', connected);
    secureSocket.once('error', failed);
    secureSocket.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
  });
  return secureSocket;
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
    ...(isUpstreamProxyError(error) ? { 'X-Sitepull-Proxy-Error': error.code } : {}),
  });
  response.end(
    status === 403 ? 'Blocked by Sitepull network policy.\n' : 'Sitepull proxy error.\n',
  );
}

function failSocket(socket: Duplex, error: unknown): void {
  if (!socket.destroyed) {
    const status = errorStatus(error);
    const proxyErrorHeader = isUpstreamProxyError(error)
      ? `X-Sitepull-Proxy-Error: ${error.code}\r\n`
      : '';
    socket.end(
      `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\n${proxyErrorHeader}Connection: close\r\nContent-Length: 0\r\n\r\n`,
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

  const outboundRouter = createOutboundRouter({
    connectTimeoutMs: options.connectTimeoutMs,
    ...(options.proxyPool === undefined ? {} : { proxyPool: options.proxyPool }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  let closed = false;
  const upstreamErrors = new Map<string, TimedProxyError>();
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
  const trackRequest = (request: http.ClientRequest): void => {
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
      if (socket.connecting) socket.once('connect', clearTimer);
      else clearTimer();
      socket.once('close', clearTimer);
    });
  };
  const ensureOpen = (): void => {
    if (closed) throw new Error('Sitepull network proxy is closed.');
  };
  const report = (error: unknown, target: string | null): void => {
    if (target !== null && isUpstreamProxyError(error)) {
      const key = targetKey(target);
      if (key !== null) {
        if (!upstreamErrors.has(key) && upstreamErrors.size >= MAX_TRACKED_PROXY_ERRORS) {
          const oldest = upstreamErrors.keys().next().value;
          if (oldest !== undefined) upstreamErrors.delete(oldest);
        }
        upstreamErrors.set(key, { error, occurredAtMs: Date.now() });
      }
    }
    try {
      options.onError?.(error, target);
    } catch {
      // Diagnostics cannot change proxy enforcement.
    }
  };

  const server = http.createServer((request, response) => {
    const clientAbort = new AbortController();
    request.once('aborted', () => clientAbort.abort(new Error('Browser request aborted.')));
    response.once('close', () => {
      if (!response.writableEnded) clientAbort.abort(new Error('Browser response closed.'));
    });
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
        const rawSocket = await outboundRouter.open(
          resolved,
          targetPort(target),
          clientAbort.signal,
        );
        ensureOpen();
        const socket = await originSocket(rawSocket, target, clientAbort.signal);
        trackSocket(socket);
        const upstream = http.request(requestOptions(request, target, socket), (message) => {
          response.writeHead(
            message.statusCode ?? 502,
            message.statusMessage,
            downstreamHeaders(message.headers),
          );
          message.pipe(response);
        });
        trackRequest(upstream);
        socket.resume();
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
    const clientAbort = new AbortController();
    clientSocket.once('error', (error) => clientAbort.abort(error));
    clientSocket.once('close', () => clientAbort.abort(new Error('Browser tunnel closed.')));
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
        const upstream = await outboundRouter.open(resolved, target.port, clientAbort.signal);
        ensureOpen();
        trackSocket(upstream);
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.byteLength > 0) upstream.write(head);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
        upstream.once('error', (error) => {
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
    const clientAbort = new AbortController();
    clientSocket.once('error', (error) => clientAbort.abort(error));
    clientSocket.once('close', () => clientAbort.abort(new Error('Browser upgrade closed.')));
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
        const upstream = await outboundRouter.open(resolved, port, clientAbort.signal);
        ensureOpen();
        trackSocket(upstream);
        upstream.write(rawUpgradeRequest(request, target));
        if (head.byteLength > 0) upstream.write(head);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
        upstream.once('error', (error) => {
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
    openConnection: outboundRouter.open,
    upstreamErrorFor: (target, sinceMs) => {
      const key = targetKey(target);
      if (key === null) return undefined;
      const recorded = upstreamErrors.get(key);
      return recorded !== undefined && recorded.occurredAtMs >= sinceMs
        ? recorded.error
        : undefined;
    },
    close: () => {
      closePromise ??= new Promise<void>((resolve, reject) => {
        closed = true;
        outboundRouter.close();
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
