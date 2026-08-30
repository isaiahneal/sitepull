import { lookup } from 'node:dns/promises';
import net from 'node:net';

import { SitepullError } from './errors.js';

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
  const normalized = address.toLowerCase().split('%')[0] ?? address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff')
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : false;
}

const addressCache = new Map<string, Promise<boolean>>();

export async function hostnameResolvesPrivate(hostname: string): Promise<boolean> {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }
  const literalFamily = net.isIP(normalized);
  if (literalFamily !== 0) {
    return isPrivateAddress(normalized);
  }
  const cached = addressCache.get(normalized);
  if (cached !== undefined) {
    return cached;
  }
  const check = lookup(normalized, { all: true, verbatim: true })
    .then((results) => results.some(({ address }) => isPrivateAddress(address)))
    .catch(() => false);
  addressCache.set(normalized, check);
  return check;
}

export async function assertNetworkUrlAllowed(
  url: string,
  allowPrivateHosts: boolean,
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return;
  }
  if (!allowPrivateHosts && (await hostnameResolvesPrivate(parsed.hostname))) {
    throw new SitepullError({
      code: 'PRIVATE_NETWORK_BLOCKED',
      message: `Blocked a request to private or local network host ${parsed.hostname}.`,
      stage: 'validation',
      details: { url },
    });
  }
}
