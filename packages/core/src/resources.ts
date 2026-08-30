import { createHash } from 'node:crypto';
import path from 'node:path';

import { SitepullError } from './errors.js';
import { sanitizeFilename } from './paths.js';

export const RESOURCE_KINDS = [
  'html',
  'css',
  'javascript',
  'image',
  'svg',
  'font',
  'json',
  'manifest',
  'icon',
  'media',
  'document',
  'other',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceDescriptor {
  readonly url: string;
  readonly contentType?: string | null;
  readonly browserResourceType?: string | null;
}

export interface AssetPathInput extends ResourceDescriptor {
  readonly sha256: string;
}

const EXTENSION_KIND: Readonly<Record<string, ResourceKind>> = {
  '.avif': 'image',
  '.bmp': 'image',
  '.css': 'css',
  '.eot': 'font',
  '.gif': 'image',
  '.htm': 'html',
  '.html': 'html',
  '.ico': 'icon',
  '.jpeg': 'image',
  '.jpg': 'image',
  '.js': 'javascript',
  '.json': 'json',
  '.m4a': 'media',
  '.mjs': 'javascript',
  '.mov': 'media',
  '.mp3': 'media',
  '.mp4': 'media',
  '.otf': 'font',
  '.pdf': 'document',
  '.png': 'image',
  '.svg': 'svg',
  '.ttf': 'font',
  '.wasm': 'other',
  '.wav': 'media',
  '.webm': 'media',
  '.webmanifest': 'manifest',
  '.webp': 'image',
  '.woff': 'font',
  '.woff2': 'font',
  '.xml': 'other',
};

const DEFAULT_EXTENSION: Readonly<Partial<Record<ResourceKind, string>>> = {
  html: '.html',
  css: '.css',
  javascript: '.js',
  image: '.img',
  svg: '.svg',
  font: '.font',
  json: '.json',
  manifest: '.webmanifest',
  icon: '.ico',
  media: '.bin',
  document: '.bin',
  other: '.bin',
};

const RESOURCE_DIRECTORY: Readonly<Record<ResourceKind, string>> = {
  html: 'raw/responses',
  css: 'assets/css',
  javascript: 'raw/javascript',
  image: 'assets/images',
  svg: 'assets/svg',
  font: 'assets/fonts',
  json: 'raw/responses',
  manifest: 'assets/manifests',
  icon: 'assets/icons',
  media: 'assets/media',
  document: 'raw/responses',
  other: 'raw/responses',
};

function normalizedContentType(contentType: string | null | undefined): string {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function extensionForUrl(url: string): string {
  try {
    return path.posix.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return path.posix.extname(url.split(/[?#]/, 1)[0] ?? '').toLowerCase();
  }
}

function kindFromContentType(contentType: string): ResourceKind | undefined {
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return 'html';
  if (contentType === 'text/css') return 'css';
  if (
    contentType === 'text/javascript' ||
    contentType === 'application/javascript' ||
    contentType === 'application/ecmascript' ||
    contentType.endsWith('+javascript')
  ) {
    return 'javascript';
  }
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'image/x-icon' || contentType === 'image/vnd.microsoft.icon') return 'icon';
  if (contentType.startsWith('image/')) return 'image';
  if (
    contentType.startsWith('font/') ||
    contentType === 'application/font-woff' ||
    contentType === 'application/vnd.ms-fontobject'
  ) {
    return 'font';
  }
  if (contentType === 'application/manifest+json') return 'manifest';
  if (contentType === 'application/json' || contentType.endsWith('+json')) return 'json';
  if (contentType.startsWith('audio/') || contentType.startsWith('video/')) return 'media';
  if (contentType === 'application/pdf') return 'document';
  return undefined;
}

/** Classifies a delivered response, preferring authoritative MIME data over URL suffixes. */
export function classifyResource(resource: ResourceDescriptor): ResourceKind {
  const contentTypeKind = kindFromContentType(normalizedContentType(resource.contentType));
  if (contentTypeKind !== undefined) {
    return contentTypeKind;
  }

  const extensionKind = EXTENSION_KIND[extensionForUrl(resource.url)];
  if (extensionKind !== undefined) {
    return extensionKind;
  }

  switch (resource.browserResourceType?.toLowerCase()) {
    case 'document':
      return 'html';
    case 'stylesheet':
      return 'css';
    case 'script':
      return 'javascript';
    case 'image':
      return 'image';
    case 'font':
      return 'font';
    case 'media':
      return 'media';
    default:
      return 'other';
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function compatibleExtension(kind: ResourceKind, extension: string): boolean {
  return EXTENSION_KIND[extension] === kind;
}

function urlBasename(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch (error) {
    throw new SitepullError({
      code: 'INVALID_URL',
      message: `Cannot name a resource with an invalid URL: ${url}`,
      stage: 'capturing-assets',
      details: { url },
      cause: error,
    });
  }

  const encodedName = path.posix.basename(pathname);
  if (encodedName === '') {
    return 'resource';
  }
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

/**
 * Derives a readable, collision-resistant path. The short digest remains stable
 * across query-string spelling and prevents basename collisions.
 */
export function deterministicAssetPath(input: AssetPathInput): string {
  if (!/^[a-fA-F0-9]{64}$/.test(input.sha256)) {
    throw new TypeError('sha256 must be a 64-character hexadecimal digest.');
  }

  const kind = classifyResource(input);
  const originalName = urlBasename(input.url);
  const originalExtension = path.posix.extname(originalName).toLowerCase();
  const extension = compatibleExtension(kind, originalExtension)
    ? originalExtension
    : (DEFAULT_EXTENSION[kind] ?? '.bin');
  const originalStem =
    originalExtension === '' ? originalName : originalName.slice(0, -originalExtension.length);
  const stem = sanitizeFilename(originalStem, { fallback: kind, maxLength: 72 });
  const filename = `${stem}-${input.sha256.slice(0, 8).toLowerCase()}${extension}`;
  return path.posix.join(RESOURCE_DIRECTORY[kind], filename);
}

export function isTextResource(kind: ResourceKind): boolean {
  return (
    kind === 'html' ||
    kind === 'css' ||
    kind === 'javascript' ||
    kind === 'json' ||
    kind === 'manifest'
  );
}
