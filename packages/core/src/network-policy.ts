import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net, { type LookupFunction } from 'node:net';
import { Readable, type Duplex } from 'node:stream';
import tls from 'node:tls';

import { throwIfAborted } from './async.js';
import { SitepullError } from './errors.js';
import type { OutboundConnectionFactory } from './upstream-proxy.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_VALIDATED_RESOURCE_REDIRECTS = 10;
const MAX_RESOLVED_ADDRESSES = 32;

const PRIVATE_V4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [ip4('0.0.0.0'), ip4('0.255.255.255')],
  [ip4('10.0.0.0'), ip4('10.255.255.255')],
  [ip4('100.64.0.0'), ip4('100.127.255.255')],
  [ip4('127.0.0.0'), ip4('127.255.255.255')],
  [ip4('169.254.0.0'), ip4('169.254.255.255')],
  [ip4('172.16.0.0'), ip4('172.31.255.255')],
  [ip4('192.0.0.0'), ip4('192.0.0.255')],
  [ip4('192.168.0.0'), ip4('192.168.255.255')],
  [ip4('198.18.0.0'), ip4('198.19.255.255')],
  [ip4('224.0.0.0'), ip4('255.255.255.255')],
];

function ip4(address: string): number {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => value * 256 + octet, 0);
}

function isPrivateIpv4(address: string): boolean {
  const numeric = ip4(address);
  return PRIVATE_V4_RANGES.some(([start, end]) => numeric >= start && numeric <= end);
}

function isPrivateIpv6(address: string): boolean {
  const unscoped = address.toLowerCase().split('%')[0] ?? address.toLowerCase();
  let normalized = unscoped;
  try {
    const hostname = new URL(`http://[${unscoped}]/`).hostname;
    normalized = hostname.slice(1, -1);
  } catch {
    // net.isIP already validated direct callers; retain the input as a safe fallback.
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(normalized);
  if (mapped?.[1] !== undefined && mapped[2] !== undefined) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    const ipv4 = `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
    return isPrivateIpv4(ipv4);
  }
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff')
  );
}

function normalizeHostname(hostname: string): string {
  const lowered =
    hostname.toLowerCase().replace(/\.$/u, '').split('%')[0] ?? hostname.toLowerCase();
  return lowered.startsWith('[') && lowered.endsWith(']') ? lowered.slice(1, -1) : lowered;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  return family === 4
    ? isPrivateIpv4(normalized)
    : family === 6
      ? isPrivateIpv6(normalized)
      : false;
}

export type NetworkAddressLookup = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemAddressLookup: NetworkAddressLookup = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export interface ResolvedNetworkTarget {
  readonly hostname: string;
  readonly addresses: readonly LookupAddress[];
}

async function lookupNetworkAddresses(
  hostname: string,
  lookupAddresses: NetworkAddressLookup,
): Promise<readonly LookupAddress[]> {
  const normalized = normalizeHostname(hostname);
  const literalFamily = net.isIP(normalized);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: normalized, family: literalFamily }];
  }

  let resolved: readonly LookupAddress[];
  try {
    resolved = await lookupAddresses(normalized);
  } catch (cause) {
    throw new SitepullError({
      code: 'DNS_FAILED',
      message: `Could not resolve host ${normalized}.`,
      stage: 'validation',
      retryable: true,
      details: { hostname: normalized },
      cause,
    });
  }

  const seen = new Set<string>();
  const addresses: LookupAddress[] = [];
  for (const candidate of resolved) {
    const family = net.isIP(candidate.address);
    if ((family !== 4 && family !== 6) || seen.has(candidate.address)) continue;
    seen.add(candidate.address);
    addresses.push({ address: candidate.address, family });
  }
  if (addresses.length === 0) {
    throw new SitepullError({
      code: 'DNS_FAILED',
      message: `Could not resolve host ${normalized}.`,
      stage: 'validation',
      retryable: true,
      details: { hostname: normalized },
    });
  }
  return addresses.slice(0, MAX_RESOLVED_ADDRESSES);
}

/** Resolves once, rejects mixed/private results, and returns addresses suitable for pinning. */
export async function resolveNetworkTarget(
  hostname: string,
  allowPrivateHosts: boolean,
  lookupAddresses: NetworkAddressLookup = systemAddressLookup,
): Promise<ResolvedNetworkTarget> {
  const normalized = normalizeHostname(hostname);
  const addresses = await lookupNetworkAddresses(normalized, lookupAddresses);
  const blocked = addresses.find(({ address }) => isPrivateAddress(address));
  if (!allowPrivateHosts && blocked !== undefined) {
    throw new SitepullError({
      code: 'PRIVATE_NETWORK_BLOCKED',
      message: `Blocked a request to private or local network host ${normalized}.`,
      stage: 'validation',
      details: { hostname: normalized, address: blocked.address },
    });
  }
  return { hostname: normalized, addresses };
}

/** No public verdict is cached; every call observes the current address set. */
export async function hostnameResolvesPrivate(
  hostname: string,
  lookupAddresses: NetworkAddressLookup = systemAddressLookup,
): Promise<boolean> {
  try {
    const addresses = await lookupNetworkAddresses(hostname, lookupAddresses);
    return addresses.some(({ address }) => isPrivateAddress(address));
  } catch {
    return false;
  }
}

export async function assertNetworkUrlAllowed(
  url: string,
  allowPrivateHosts: boolean,
  lookupAddresses: NetworkAddressLookup = systemAddressLookup,
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  await resolveNetworkTarget(parsed.hostname, allowPrivateHosts, lookupAddresses);
}

function dnsNotFound(hostname: string): NodeJS.ErrnoException {
  const error = new Error(
    `No pinned address is available for ${hostname}.`,
  ) as NodeJS.ErrnoException;
  error.code = 'ENOTFOUND';
  Object.assign(error, { hostname });
  return error;
}

/** A Node lookup callback that can return only the already-validated address set. */
export function createPinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  const pinned = addresses.map(({ address, family }) => ({ address, family }));
  return (hostname, options, callback) => {
    const requestedFamily = options.family === 4 || options.family === 6 ? options.family : 0;
    let candidates =
      requestedFamily === 0
        ? [...pinned]
        : pinned.filter(({ family }) => family === requestedFamily);
    if (options.order === 'ipv4first') {
      candidates = candidates.sort((left, right) => left.family - right.family);
    } else if (options.order === 'ipv6first') {
      candidates = candidates.sort((left, right) => right.family - left.family);
    }
    const first = candidates[0];
    if (first === undefined) {
      callback(dnsNotFound(hostname), '', 0);
      return;
    }
    if (options.all === true) callback(null, candidates);
    else callback(null, first.address, first.family);
  };
}

function absoluteHttpUrl(value: string, base?: string): string {
  let parsed: URL;
  try {
    parsed = base === undefined ? new URL(value) : new URL(value, base);
  } catch (cause) {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: `A resource redirect returned an invalid URL: ${value}`,
      stage: 'validation',
      details: { url: value, ...(base === undefined ? {} : { base }) },
      cause,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SitepullError({
      code: 'UNSUPPORTED_PROTOCOL',
      message: `A resource redirect used unsupported protocol ${parsed.protocol}`,
      stage: 'validation',
      details: { url: parsed.href },
    });
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: 'Resource URLs cannot contain embedded credentials.',
      stage: 'validation',
      details: { url: parsed.href },
    });
  }
  return parsed.href;
}

export type ResourceFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ValidatedResourceRequestOptions {
  readonly allowPrivateHosts: boolean;
  readonly timeoutMs: number;
  readonly maxRedirects?: number;
  readonly signal?: AbortSignal;
  /** Test seam only; production uses the pinned Node transport. */
  readonly fetch?: ResourceFetch;
  readonly lookupAddresses?: NetworkAddressLookup;
  readonly headersForUrl?: (url: string) => HeadersInit | Promise<HeadersInit>;
  /** Routes already-validated destinations through the active outbound policy. */
  readonly connectionFactory?: OutboundConnectionFactory;
}

export interface ValidatedResourceResponse {
  readonly response: Response;
  readonly finalUrl: string;
}

export async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function responseHeaders(rawHeaders: readonly string[]): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  return headers;
}

async function secureResourceSocket(
  socket: Duplex,
  hostname: string,
  signal: AbortSignal,
): Promise<Duplex> {
  if (signal.aborted) {
    socket.destroy();
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('The resource TLS handshake was aborted.', { cause: signal.reason });
  }

  const secureSocket = tls.connect({
    socket,
    rejectUnauthorized: true,
    ...(net.isIP(hostname) === 0 ? { servername: hostname } : {}),
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
      reject(new Error('The resource TLS socket closed during its handshake.'));
    };
    const aborted = (): void => {
      cleanup();
      secureSocket.destroy();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('The resource TLS handshake was aborted.', { cause: signal.reason }),
      );
    };
    secureSocket.once('secureConnect', connected);
    secureSocket.once('error', failed);
    secureSocket.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
  });
  return secureSocket;
}

async function fetchPinnedResponse(
  url: string,
  target: ResolvedNetworkTarget,
  headersInit: HeadersInit | undefined,
  signal: AbortSignal,
  connectionFactory?: OutboundConnectionFactory,
): Promise<Response> {
  const parsed = new URL(url);
  const headers = new Headers(headersInit);
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');
  if (!headers.has('host')) headers.set('host', parsed.host);

  let connectedSocket: Duplex | undefined;
  let connectedAgent: http.Agent | undefined;
  if (connectionFactory !== undefined) {
    const port =
      parsed.port === ''
        ? parsed.protocol === 'https:'
          ? 443
          : 80
        : Number.parseInt(parsed.port, 10);
    const rawSocket = await connectionFactory(target, port, signal);
    if (parsed.protocol === 'https:') {
      connectedSocket = await secureResourceSocket(rawSocket, target.hostname, signal);
    } else {
      connectedSocket = rawSocket;
    }
    connectedAgent = new http.Agent({ keepAlive: false });
    connectedAgent.createConnection = () => connectedSocket;
  }

  const transport = parsed.protocol === 'https:' ? https : http;
  const lookup = createPinnedLookup(target.addresses);
  const requestOptions: http.RequestOptions & {
    readonly autoSelectFamily?: boolean;
    readonly servername?: string;
  } = {
    protocol: connectedSocket === undefined ? parsed.protocol : 'http:',
    hostname: target.hostname,
    port: parsed.port === '' ? undefined : Number.parseInt(parsed.port, 10),
    method: 'GET',
    path: `${parsed.pathname}${parsed.search}`,
    headers: Object.fromEntries(headers.entries()),
    ...(connectedSocket === undefined
      ? { lookup, autoSelectFamily: target.addresses.length > 1, agent: false }
      : { agent: connectedAgent }),
    signal,
    ...(connectedSocket === undefined &&
    parsed.protocol === 'https:' &&
    net.isIP(target.hostname) === 0
      ? { servername: target.hostname }
      : {}),
  };

  return new Promise<Response>((resolve, reject) => {
    const requestTransport = connectedSocket === undefined ? transport : http;
    const request = requestTransport.request(requestOptions, (message) => {
      const status = message.statusCode ?? 500;
      const hasBody = status !== 101 && status !== 204 && status !== 205 && status !== 304;
      try {
        resolve(
          new Response(
            hasBody ? (Readable.toWeb(message) as ReadableStream<Uint8Array<ArrayBuffer>>) : null,
            {
              status,
              headers: responseHeaders(message.rawHeaders),
              ...(message.statusMessage === undefined ? {} : { statusText: message.statusMessage }),
            },
          ),
        );
      } catch (error) {
        message.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.once('error', reject);
    connectedSocket?.resume();
    request.end();
  });
}

/**
 * Opens a streaming resource response without automatic redirects. Each hop is
 * freshly resolved, checked, and the resulting address set is pinned into the
 * socket lookup. Redirect bodies are cancelled before the next hop.
 */
export async function fetchValidatedResource(
  url: string,
  options: ValidatedResourceRequestOptions,
): Promise<ValidatedResourceResponse> {
  const maxRedirects = options.maxRedirects ?? MAX_VALIDATED_RESOURCE_REDIRECTS;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
    throw new RangeError('maxRedirects must be an integer from 0 to 20.');
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new RangeError('timeoutMs must be a positive safe integer.');
  }

  let currentUrl = absoluteHttpUrl(url);
  const visited = new Set<string>();
  let followed = 0;

  while (true) {
    throwIfAborted(options.signal);
    if (visited.has(currentUrl)) {
      throw new SitepullError({
        code: 'CRAWL_FAILED',
        message: `A resource redirect loop was detected at ${currentUrl}.`,
        stage: 'capturing-assets',
        details: { url: currentUrl, redirects: followed },
      });
    }
    visited.add(currentUrl);
    const parsed = new URL(currentUrl);
    const target = await resolveNetworkTarget(
      parsed.hostname,
      options.allowPrivateHosts,
      options.lookupAddresses ?? systemAddressLookup,
    );

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal =
      options.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([options.signal, timeoutSignal]);
    const requestHeaders = await options.headersForUrl?.(currentUrl);
    const response =
      options.fetch === undefined
        ? await fetchPinnedResponse(
            currentUrl,
            target,
            requestHeaders,
            signal,
            options.connectionFactory,
          )
        : await options.fetch(currentUrl, {
            cache: 'no-store',
            redirect: 'manual',
            signal,
            ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
          });
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || location === null || location === '') {
      return { response, finalUrl: currentUrl };
    }

    try {
      if (followed >= maxRedirects) {
        throw new SitepullError({
          code: 'CRAWL_FAILED',
          message: `A resource exceeded the ${maxRedirects}-redirect limit.`,
          stage: 'capturing-assets',
          details: { url, lastUrl: currentUrl, maxRedirects },
        });
      }
      currentUrl = absoluteHttpUrl(location, currentUrl);
      followed += 1;
    } finally {
      await cancelResponseBody(response);
    }
  }
}

/** Materializes a web response stream while enforcing a hard byte ceiling. */
export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('maxBytes must be a nonnegative safe integer.');
  }
  if (response.body === null) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      if (total + chunk.value.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SitepullError({
          code: 'RESOURCE_TOO_LARGE',
          message: `Response body exceeds the ${maxBytes}-byte materialization limit.`,
          stage: 'capturing-assets',
          details: { maxBytes },
        });
      }
      const buffer = Buffer.from(
        chunk.value.buffer,
        chunk.value.byteOffset,
        chunk.value.byteLength,
      );
      chunks.push(buffer);
      total += buffer.byteLength;
    }
    throwIfAborted(signal);
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}
