import { SitepullError } from './errors.js';

const TRACKING_PARAMETER_NAMES = new Set([
  '_ga',
  '_gl',
  'dclid',
  'fbclid',
  'gclid',
  'gbraid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'twclid',
  'wbraid',
]);

const NON_HTML_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.css',
  '.dmg',
  '.doc',
  '.docx',
  '.epub',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.json',
  '.m4a',
  '.mjs',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.rar',
  '.svg',
  '.tar',
  '.tgz',
  '.tif',
  '.tiff',
  '.wav',
  '.webm',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
  '.xls',
  '.xlsx',
  '.xml',
  '.zip',
]);

export interface CanonicalizeUrlOptions {
  readonly baseUrl?: string | URL;
  readonly stripTrackingParameters?: boolean;
}

export type UrlSkipReason =
  | 'duplicate'
  | 'download'
  | 'external-origin'
  | 'invalid-url'
  | 'query-variant-limit'
  | 'url-limit'
  | 'unsupported-protocol';

export type DiscoveredUrlDecision =
  | { readonly accepted: true; readonly url: string }
  | { readonly accepted: false; readonly href: string; readonly reason: UrlSkipReason };

export interface OriginPolicy {
  readonly originUrl: string | URL;
  readonly includeSubdomains?: boolean;
}

export interface UrlFrontierOptions extends OriginPolicy {
  readonly maxQueryVariantsPerPath?: number;
  readonly maxUrls?: number;
}

function isTrackingParameter(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith('utm_') || TRACKING_PARAMETER_NAMES.has(normalized);
}

function parseUrl(input: string | URL, baseUrl?: string | URL): URL {
  try {
    return input instanceof URL ? new URL(input.href) : new URL(input, baseUrl);
  } catch (error) {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: `Invalid URL: ${String(input)}`,
      stage: 'validation',
      details: { input: String(input) },
      cause: error,
    });
  }
}

function requireHttpProtocol(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SitepullError({
      code: 'UNSUPPORTED_PROTOCOL',
      message: `Sitepull only supports HTTP and HTTPS URLs, not ${url.protocol}`,
      stage: 'validation',
      details: { protocol: url.protocol },
    });
  }
  if (url.username !== '' || url.password !== '') {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: 'URLs containing embedded credentials are not supported.',
      stage: 'validation',
    });
  }
}

/** Resolves and canonicalizes an HTTP(S) URL without guessing route equivalence. */
export function canonicalizeUrl(input: string | URL, options: CanonicalizeUrlOptions = {}): string {
  const url = parseUrl(input, options.baseUrl);
  requireHttpProtocol(url);
  url.hash = '';

  if (options.stripTrackingParameters ?? true) {
    for (const name of [...url.searchParams.keys()]) {
      if (isTrackingParameter(name)) {
        url.searchParams.delete(name);
      }
    }
  }

  url.searchParams.sort();
  return url.href;
}

function normalizedPort(url: URL): string {
  if (url.port !== '') {
    return url.port;
  }
  return url.protocol === 'https:' ? '443' : '80';
}

export function isAllowedByOrigin(candidate: string | URL, policy: OriginPolicy): boolean {
  const candidateUrl = parseUrl(candidate);
  const originUrl = parseUrl(policy.originUrl);
  requireHttpProtocol(candidateUrl);
  requireHttpProtocol(originUrl);

  if (
    candidateUrl.protocol !== originUrl.protocol ||
    normalizedPort(candidateUrl) !== normalizedPort(originUrl)
  ) {
    return false;
  }

  const candidateHost = candidateUrl.hostname.toLowerCase();
  const originHost = originUrl.hostname.toLowerCase();
  return (
    candidateHost === originHost ||
    ((policy.includeSubdomains ?? false) && candidateHost.endsWith(`.${originHost}`))
  );
}

function looksLikeDownload(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot === -1) {
    return false;
  }
  return NON_HTML_EXTENSIONS.has(pathname.slice(lastDot));
}

/** Evaluates a rendered link without throwing for ordinary skipped-link cases. */
export function evaluateDiscoveredUrl(
  href: string,
  sourceUrl: string | URL,
  policy: OriginPolicy,
): DiscoveredUrlDecision {
  let url: URL;
  try {
    url = parseUrl(href, sourceUrl);
  } catch {
    return { accepted: false, href, reason: 'invalid-url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { accepted: false, href, reason: 'unsupported-protocol' };
  }
  if (url.username !== '' || url.password !== '') {
    return { accepted: false, href, reason: 'invalid-url' };
  }
  if (looksLikeDownload(url)) {
    return { accepted: false, href, reason: 'download' };
  }

  const canonical = canonicalizeUrl(url);
  if (!isAllowedByOrigin(canonical, policy)) {
    return { accepted: false, href, reason: 'external-origin' };
  }
  return { accepted: true, url: canonical };
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

/** Tracks canonical routes and bounds otherwise unbounded query-string spaces. */
export class BoundedUrlFrontier {
  readonly #policy: OriginPolicy;
  readonly #maxQueryVariantsPerPath: number;
  readonly #maxUrls: number;
  readonly #seen = new Set<string>();
  readonly #queryVariants = new Map<string, Set<string>>();

  constructor(options: UrlFrontierOptions) {
    const maxQueryVariantsPerPath = options.maxQueryVariantsPerPath ?? 3;
    const maxUrls = options.maxUrls ?? 25;
    requireNonNegativeInteger(maxQueryVariantsPerPath, 'maxQueryVariantsPerPath');
    requireNonNegativeInteger(maxUrls, 'maxUrls');

    this.#policy = {
      originUrl: canonicalizeUrl(options.originUrl),
      includeSubdomains: options.includeSubdomains ?? false,
    };
    this.#maxQueryVariantsPerPath = maxQueryVariantsPerPath;
    this.#maxUrls = maxUrls;
  }

  get size(): number {
    return this.#seen.size;
  }

  consider(href: string, sourceUrl: string | URL = this.#policy.originUrl): DiscoveredUrlDecision {
    const decision = evaluateDiscoveredUrl(href, sourceUrl, this.#policy);
    if (!decision.accepted) {
      return decision;
    }
    if (this.#seen.has(decision.url)) {
      return { accepted: false, href, reason: 'duplicate' };
    }
    if (this.#seen.size >= this.#maxUrls) {
      return { accepted: false, href, reason: 'url-limit' };
    }

    const url = new URL(decision.url);
    if (url.search !== '') {
      const routeKey = `${url.origin}${url.pathname}`;
      const variants = this.#queryVariants.get(routeKey) ?? new Set<string>();
      if (!variants.has(url.search) && variants.size >= this.#maxQueryVariantsPerPath) {
        return { accepted: false, href, reason: 'query-variant-limit' };
      }
      variants.add(url.search);
      this.#queryVariants.set(routeKey, variants);
    }

    this.#seen.add(decision.url);
    return decision;
  }
}
