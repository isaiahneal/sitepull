import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { SitepullError } from './errors.js';

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface SanitizeFilenameOptions {
  readonly fallback?: string;
  readonly maxLength?: number;
}

function strippedExtension(filename: string): { stem: string; extension: string } {
  const extension = path.posix.extname(filename);
  if (extension === '' || extension.length > 16) {
    return { stem: filename, extension: '' };
  }
  return { stem: filename.slice(0, -extension.length), extension };
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('');
}

function portableName(value: string): string {
  return stripControlCharacters(value.normalize('NFKD'))
    .replace(/\p{Mark}/gu, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s_-]+|[.\s_-]+$/g, '');
}

/** Produces a portable filename from hostile URL-derived input. */
export function sanitizeFilename(input: string, options: SanitizeFilenameOptions = {}): string {
  const maxLength = options.maxLength ?? 120;
  if (!Number.isSafeInteger(maxLength) || maxLength < 8) {
    throw new RangeError('maxLength must be a safe integer of at least 8.');
  }

  const requestedFallback = portableName(options.fallback ?? 'unnamed');
  const fallback = requestedFallback === '' ? 'unnamed' : requestedFallback;
  const normalized = portableName(input);

  const candidate =
    normalized === '' || normalized === '.' || normalized === '..' ? fallback : normalized;
  const safeCandidate = WINDOWS_RESERVED_NAME.test(candidate) ? `_${candidate}` : candidate;
  const { stem, extension } = strippedExtension(safeCandidate);
  const roomForStem = Math.max(1, maxLength - extension.length);
  const truncated = `${stem.slice(0, roomForStem)}${extension}`.replace(/[.\s_-]+$/g, '');
  return truncated === '' ? fallback.slice(0, maxLength) : truncated;
}

function safelyDecode(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function assertSafeRelativePath(relativePath: string): string {
  if (relativePath.includes('\0')) {
    throwPathTraversal(relativePath);
  }

  const decoded = safelyDecode(relativePath).replace(/\\/g, '/');
  if (
    decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    /^[A-Za-z]:\//.test(decoded) ||
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throwPathTraversal(relativePath);
  }
  return decoded;
}

function throwPathTraversal(relativePath: string): never {
  throw new SitepullError({
    code: 'PATH_TRAVERSAL',
    message: 'The requested path escapes the selected Sitepull output directory.',
    stage: 'building-project',
    details: { relativePath },
  });
}

/** Lexically confines a path to a root and rejects encoded/cross-platform traversal forms. */
export function resolvePathWithinRoot(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const safeRelativePath = assertSafeRelativePath(relativePath);
  const candidate = path.resolve(absoluteRoot, safeRelativePath);
  const relation = path.relative(absoluteRoot, candidate);
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throwPathTraversal(relativePath);
  }
  return candidate;
}

/** Also rejects any already-existing symlink component below the trusted root. */
export async function resolvePathWithoutSymlinks(
  root: string,
  relativePath: string,
): Promise<string> {
  const canonicalRoot = await realpath(root);
  const candidate = resolvePathWithinRoot(canonicalRoot, relativePath);
  const relation = path.relative(canonicalRoot, candidate);
  let cursor = canonicalRoot;

  for (const segment of relation.split(path.sep).filter((value) => value !== '')) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) {
        throwPathTraversal(relativePath);
      }
    } catch (error) {
      if (error instanceof SitepullError) {
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
  return candidate;
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function shortStableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Creates a readable, stable directory name for a canonical route. */
export function routeSlug(input: string | URL): string {
  const url =
    input instanceof URL ? new URL(input.href) : new URL(input, 'https://sitepull.invalid');
  const segments = url.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) =>
      sanitizeFilename(decodeRouteSegment(segment), { fallback: 'route', maxLength: 48 }),
    )
    .map((segment) => segment.toLowerCase());

  let slug = segments.length === 0 ? 'home' : segments.join('__');
  if (slug.length > 100) {
    slug = `${slug.slice(0, 91).replace(/[-_.]+$/g, '')}--${shortStableHash(url.pathname)}`;
  }
  if (url.search !== '') {
    slug = `${slug}--q-${shortStableHash(url.search)}`;
  }
  return slug;
}
