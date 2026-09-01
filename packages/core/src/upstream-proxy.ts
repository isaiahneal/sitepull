import { randomInt as cryptoRandomInt } from 'node:crypto';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';

import {
  ProxyPoolRequestSchema,
  type ProxyPoolRequest,
  type ProxySelectionMode,
} from '@sitepull/contracts';

import { throwIfAborted } from './async.js';
import { SitepullError } from './errors.js';
import {
  createPinnedLookup,
  resolveNetworkTarget,
  type NetworkAddressLookup,
  type ResolvedNetworkTarget,
} from './network-policy.js';

const MAX_CONNECT_RESPONSE_HEADER_BYTES = 32 * 1_024;

export type OutboundConnectionFactory = (
  target: ResolvedNetworkTarget,
  port: number,
  signal?: AbortSignal,
) => Promise<Duplex>;

export interface OutboundRouter {
  readonly open: OutboundConnectionFactory;
  close(): void;
}

type RandomInteger = (minimum: number, maximumExclusive: number) => number;
type JitterDelay = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export interface OutboundRouterOptions {
  readonly connectTimeoutMs: number;
  readonly proxyPool?: ProxyPoolRequest;
  readonly signal?: AbortSignal;
  /** Test seam; production resolves proxy endpoints with the system resolver. */
  readonly lookupProxyAddresses?: NetworkAddressLookup;
  /** Test seam; production uses cryptographically strong integer selection. */
  readonly randomInteger?: RandomInteger;
  /** Test seam; production jitter is an abortable timer. */
  readonly jitterDelay?: JitterDelay;
}

interface RuntimeProxyEndpoint {
  readonly server: string;
  readonly url: URL;
  readonly authorization: string | null;
}

interface RuntimeProxyPool {
  readonly entries: readonly RuntimeProxyEndpoint[];
  readonly selection: ProxySelectionMode;
  readonly jitter: { readonly minMs: number; readonly maxMs: number };
}

function proxyError(options: {
  code:
    | 'UPSTREAM_PROXY_INVALID'
    | 'UPSTREAM_PROXY_AUTH_REQUIRED'
    | 'UPSTREAM_PROXY_TLS_FAILED'
    | 'UPSTREAM_PROXY_CONNECT_FAILED';
  message: string;
  endpoint?: RuntimeProxyEndpoint;
  status?: number;
  cause?: unknown;
}): SitepullError {
  return new SitepullError({
    code: options.code,
    message: options.message,
    stage: 'launching-browser',
    retryable: false,
    details: {
      ...(options.endpoint === undefined ? {} : { proxy: options.endpoint.server }),
      ...(options.status === undefined ? {} : { status: options.status }),
    },
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

function runtimePool(input: ProxyPoolRequest | undefined): RuntimeProxyPool | null {
  if (input === undefined) return null;

  let parsed: ProxyPoolRequest;
  try {
    parsed = ProxyPoolRequestSchema.parse(input);
  } catch (cause) {
    throw proxyError({
      code: 'UPSTREAM_PROXY_INVALID',
      message: 'The upstream proxy pool configuration is invalid.',
      cause,
    });
  }

  return {
    entries: parsed.entries.map((entry) => ({
      server: entry.server,
      url: new URL(entry.server),
      authorization:
        entry.credentials === undefined
          ? null
          : `Basic ${Buffer.from(
              `${entry.credentials.username}:${entry.credentials.password}`,
              'utf8',
            ).toString('base64')}`,
    })),
    selection: parsed.selection,
    jitter: parsed.jitter,
  };
}

function proxyPort(url: URL): number {
  if (url.port !== '') return Number.parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

function destinationAuthority(target: ResolvedNetworkTarget, port: number): string {
  const first = target.addresses[0];
  if (first === undefined) {
    throw new SitepullError({
      code: 'DNS_FAILED',
      message: `No validated address is available for ${target.hostname}.`,
      stage: 'validation',
      retryable: true,
      details: { hostname: target.hostname },
    });
  }
  return `${first.family === 6 ? `[${first.address}]` : first.address}:${port}`;
}

function abortedError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('The outbound connection was aborted.', { cause: signal.reason });
}

function raceWithAbort<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(abortedError(signal));
  return new Promise<Value>((resolve, reject) => {
    const aborted = (): void => {
      signal.removeEventListener('abort', aborted);
      reject(abortedError(signal));
    };
    signal.addEventListener('abort', aborted, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function defaultJitterDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortedError(signal));
  if (milliseconds === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(abortedError(signal));
    };
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener('abort', abort, { once: true });
  });
}

function waitForSocket(
  socket: Duplex,
  event: 'connect' | 'secureConnect',
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    socket.destroy();
    return Promise.reject(abortedError(signal));
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      socket.off(event, connected);
      socket.off('error', failed);
      socket.off('close', closed);
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
      reject(new Error('The upstream socket closed before the connection was ready.'));
    };
    const aborted = (): void => {
      cleanup();
      socket.destroy();
      reject(abortedError(signal));
    };

    socket.once(event, connected);
    socket.once('error', failed);
    socket.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

function connectResponse(
  socket: Duplex,
  endpoint: RuntimeProxyEndpoint,
  authority: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    socket.destroy();
    return Promise.reject(abortedError(signal));
  }

  return new Promise<void>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const cleanup = (): void => {
      socket.off('data', onData);
      socket.off('error', failed);
      socket.off('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const fail = (error: Error): void => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const failed = (error: Error): void => fail(error);
    const closed = (): void =>
      fail(new Error('The upstream proxy closed before completing CONNECT.'));
    const aborted = (): void => fail(abortedError(signal));
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk], buffered.byteLength + chunk.byteLength);
      if (buffered.byteLength > MAX_CONNECT_RESPONSE_HEADER_BYTES) {
        fail(
          proxyError({
            code: 'UPSTREAM_PROXY_CONNECT_FAILED',
            message: `The upstream proxy at ${endpoint.server} returned oversized CONNECT headers.`,
            endpoint,
          }),
        );
        return;
      }

      const headerEnd = buffered.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buffered.subarray(0, headerEnd).toString('latin1');
      const statusLine = header.split('\r\n', 1)[0] ?? '';
      const match = /^HTTP\/1\.[01] ([0-9]{3})(?:[ \t]|$)/u.exec(statusLine);
      if (match?.[1] === undefined) {
        fail(
          proxyError({
            code: 'UPSTREAM_PROXY_CONNECT_FAILED',
            message: `The upstream proxy at ${endpoint.server} returned a malformed CONNECT response.`,
            endpoint,
          }),
        );
        return;
      }

      const status = Number.parseInt(match[1], 10);
      if (status !== 200) {
        fail(
          proxyError({
            code: status === 407 ? 'UPSTREAM_PROXY_AUTH_REQUIRED' : 'UPSTREAM_PROXY_CONNECT_FAILED',
            message:
              status === 407
                ? `The upstream proxy at ${endpoint.server} rejected its credentials.`
                : `The upstream proxy at ${endpoint.server} rejected CONNECT with HTTP ${status}.`,
            endpoint,
            status,
          }),
        );
        return;
      }

      cleanup();
      socket.pause();
      const head = buffered.subarray(headerEnd + 4);
      if (head.byteLength > 0) socket.unshift(head);
      resolve();
    };

    socket.on('data', onData);
    socket.once('error', failed);
    socket.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
    const lines = [
      `CONNECT ${authority} HTTP/1.1`,
      `Host: ${authority}`,
      ...(endpoint.authorization === null
        ? []
        : [`Proxy-Authorization: ${endpoint.authorization}`]),
      '',
      '',
    ];
    socket.write(lines.join('\r\n'), 'latin1');
    socket.resume();
  });
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('Outbound destination port must be an integer from 1 to 65535.');
  }
}

export function createOutboundRouter(options: OutboundRouterOptions): OutboundRouter {
  if (!Number.isSafeInteger(options.connectTimeoutMs) || options.connectTimeoutMs < 1) {
    throw new RangeError('connectTimeoutMs must be a positive safe integer.');
  }

  const pool = runtimePool(options.proxyPool);
  const lifetime = new AbortController();
  const sockets = new Set<Duplex>();
  const randomInteger = options.randomInteger ?? cryptoRandomInt;
  const delay = options.jitterDelay ?? defaultJitterDelay;
  let closed = false;
  let selectionCursor = 0;

  const track = (socket: Duplex): void => {
    if (closed) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => sockets.delete(socket));
  };

  const selectEndpoint = (): RuntimeProxyEndpoint => {
    if (pool === null) throw new Error('No upstream proxy pool is configured.');
    const index =
      pool.selection === 'round-robin'
        ? selectionCursor % pool.entries.length
        : randomInteger(0, pool.entries.length);
    selectionCursor += 1;
    const endpoint = pool.entries[index];
    if (endpoint === undefined) {
      throw proxyError({
        code: 'UPSTREAM_PROXY_INVALID',
        message: 'The upstream proxy selector returned an invalid pool entry.',
      });
    }
    return endpoint;
  };

  const selectJitter = (): number => {
    if (pool === null || pool.jitter.minMs === pool.jitter.maxMs) {
      return pool?.jitter.minMs ?? 0;
    }
    return randomInteger(pool.jitter.minMs, pool.jitter.maxMs + 1);
  };

  const connectDirect = async (
    target: ResolvedNetworkTarget,
    port: number,
    signal: AbortSignal,
  ): Promise<Duplex> => {
    const socket = net.createConnection({
      host: target.hostname,
      port,
      lookup: createPinnedLookup(target.addresses),
      autoSelectFamily: target.addresses.length > 1,
    });
    track(socket);
    await waitForSocket(socket, 'connect', signal);
    return socket;
  };

  const connectProxySocket = async (
    endpoint: RuntimeProxyEndpoint,
    signal: AbortSignal,
  ): Promise<Duplex> => {
    let resolved: ResolvedNetworkTarget;
    try {
      resolved = await raceWithAbort(
        resolveNetworkTarget(endpoint.url.hostname, true, options.lookupProxyAddresses),
        signal,
      );
    } catch (cause) {
      throw proxyError({
        code: 'UPSTREAM_PROXY_CONNECT_FAILED',
        message: `Could not resolve the upstream proxy at ${endpoint.server}.`,
        endpoint,
        cause,
      });
    }
    if (signal.aborted) throw abortedError(signal);

    if (endpoint.url.protocol === 'https:') {
      const socket = tls.connect({
        host: resolved.hostname,
        port: proxyPort(endpoint.url),
        lookup: createPinnedLookup(resolved.addresses),
        rejectUnauthorized: true,
        ALPNProtocols: ['http/1.1'],
        ...(net.isIP(resolved.hostname) === 0 ? { servername: resolved.hostname } : {}),
      });
      track(socket);
      let tcpConnected = false;
      socket.once('connect', () => {
        tcpConnected = true;
      });
      try {
        await waitForSocket(socket, 'secureConnect', signal);
      } catch (cause) {
        if (signal.aborted) throw abortedError(signal);
        throw proxyError({
          code: tcpConnected ? 'UPSTREAM_PROXY_TLS_FAILED' : 'UPSTREAM_PROXY_CONNECT_FAILED',
          message: tcpConnected
            ? `TLS negotiation or certificate validation failed for the upstream proxy at ${endpoint.server}.`
            : `Could not connect to the upstream proxy at ${endpoint.server}.`,
          endpoint,
          cause,
        });
      }
      return socket;
    }

    const socket = net.createConnection({
      host: resolved.hostname,
      port: proxyPort(endpoint.url),
      lookup: createPinnedLookup(resolved.addresses),
      autoSelectFamily: resolved.addresses.length > 1,
    });
    track(socket);
    await waitForSocket(socket, 'connect', signal);
    return socket;
  };

  const open: OutboundConnectionFactory = async (target, port, requestSignal) => {
    validatePort(port);
    if (closed) {
      throw new SitepullError({
        code: 'CAPTURE_CANCELLED',
        message: 'The Sitepull network proxy is closed.',
        stage: 'crawling-pages',
      });
    }
    throwIfAborted(requestSignal);

    const timeoutSignal = AbortSignal.timeout(options.connectTimeoutMs);
    const signal = AbortSignal.any([
      lifetime.signal,
      timeoutSignal,
      ...(options.signal === undefined ? [] : [options.signal]),
      ...(requestSignal === undefined ? [] : [requestSignal]),
    ]);

    if (pool === null) return connectDirect(target, port, signal);

    const endpoint = selectEndpoint();
    const jitter = selectJitter();
    try {
      await delay(jitter, signal);
      const socket = await connectProxySocket(endpoint, signal);
      await connectResponse(socket, endpoint, destinationAuthority(target, port), signal);
      return socket;
    } catch (cause) {
      if (requestSignal?.aborted === true) throwIfAborted(requestSignal);
      if (options.signal?.aborted === true) throwIfAborted(options.signal);
      if (cause instanceof SitepullError) throw cause;
      throw proxyError({
        code: 'UPSTREAM_PROXY_CONNECT_FAILED',
        message: timeoutSignal.aborted
          ? `The upstream proxy at ${endpoint.server} timed out.`
          : `Could not connect through the upstream proxy at ${endpoint.server}.`,
        endpoint,
        cause,
      });
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener('abort', close);
    lifetime.abort(new Error('The Sitepull outbound router was closed.'));
    for (const socket of sockets) socket.destroy();
  };
  if (options.signal?.aborted === true) close();
  else options.signal?.addEventListener('abort', close, { once: true });

  return { open, close };
}
