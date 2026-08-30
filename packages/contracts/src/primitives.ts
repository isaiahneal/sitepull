import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe('An RFC 3339 timestamp with an explicit UTC offset');

export const HttpUrlSchema = z
  .string()
  .min(1)
  .max(8_192)
  .url()
  .refine((value) => /^https?:\/\//iu.test(value), {
    message: 'Only HTTP and HTTPS URLs are supported',
  })
  .refine(
    (value) => {
      const parsed = new URL(value);
      return parsed.username === '' && parsed.password === '';
    },
    { message: 'URLs containing embedded credentials are not supported' },
  );

export interface NormalizedHttpUrlInput {
  readonly url: string;
  readonly protocolInferred: boolean;
}

/**
 * Turns a user-facing website input into an absolute HTTP(S) URL. Bare hosts
 * intentionally prefer HTTPS; callers can use `protocolInferred` to permit a
 * guarded HTTP retry without downgrading an explicitly secure URL.
 */
export function normalizeHttpUrlInput(input: string): NormalizedHttpUrlInput {
  const value = input.trim();
  if (value === '') throw new TypeError('Enter a website URL.');

  const explicitHttp = /^https?:\/\//iu.test(value);
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) && !explicitHttp) {
    throw new TypeError('Only HTTP and HTTPS URLs are supported.');
  }
  if (/^(?:data|file|ftp|javascript|mailto|tel|ws|wss):/iu.test(value)) {
    throw new TypeError('Only HTTP and HTTPS URLs are supported.');
  }

  const candidate = explicitHttp ? value : `https://${value}`;
  let candidateUrl: URL;
  try {
    candidateUrl = new URL(candidate);
  } catch {
    throw new TypeError('Enter a valid HTTP or HTTPS website URL.');
  }
  if (candidateUrl.username !== '' || candidateUrl.password !== '') {
    throw new TypeError('URLs containing embedded credentials are not supported.');
  }
  const parsed = HttpUrlSchema.safeParse(candidate);
  if (!parsed.success) throw new TypeError('Enter a valid HTTP or HTTPS website URL.');

  return {
    url: candidateUrl.href,
    protocolInferred: !explicitHttp,
  };
}

export const HostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => !value.includes('/') && !value.includes('\\'), {
    message: 'Expected a hostname, not a path',
  });

export const CaptureIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u, 'Invalid capture identifier');

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, 'Expected a lowercase SHA-256 digest');

export const FileSystemPathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => value.trim().length > 0, 'Paths cannot be blank')
  .refine((value) => !value.includes('\0'), 'Paths cannot contain NUL bytes');

function safelyDecodePath(value: string): string | null {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return decoded;
      }
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

function isSafeRelativePath(value: string): boolean {
  const decoded = safelyDecodePath(value);
  if (decoded === null) {
    return false;
  }

  return [value, decoded].every((candidate) => {
    if (
      candidate.startsWith('/') ||
      candidate.startsWith('\\') ||
      /^[a-zA-Z]:/u.test(candidate) ||
      candidate.includes('\\') ||
      candidate.includes('\0')
    ) {
      return false;
    }
    const segments = candidate.split('/');
    return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  });
}

/** A project-relative POSIX path safe to resolve below a capture root. */
export const SafeRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(isSafeRelativePath, 'Expected a safe capture-relative path');

export const RoutePathSchema = z
  .string()
  .min(1)
  .max(8_192)
  .regex(/^\/(?!\/)[^#\s]*$/u, 'Expected an absolute URL path without a fragment');

export const NonNegativeIntegerSchema = z.number().int().nonnegative();
export const PositiveIntegerSchema = z.number().int().positive();
export const ByteCountSchema = NonNegativeIntegerSchema;
export const ConfidenceSchema = z.number().finite().min(0).max(1);

export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type HttpUrl = z.infer<typeof HttpUrlSchema>;
export type Hostname = z.infer<typeof HostnameSchema>;
export type CaptureId = z.infer<typeof CaptureIdSchema>;
export type Sha256 = z.infer<typeof Sha256Schema>;
export type SafeRelativePath = z.infer<typeof SafeRelativePathSchema>;
export type RoutePath = z.infer<typeof RoutePathSchema>;
