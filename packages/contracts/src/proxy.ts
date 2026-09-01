import { z } from 'zod';

export const MAX_PROXY_POOL_ENTRIES = 32;
export const MAX_PROXY_JITTER_MS = 30_000;

export function normalizeProxyServer(input: string): string {
  const value = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Proxy servers must be valid HTTP(S) URLs.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Proxy servers must use http:// or https://.');
  }
  if (parsed.hostname === '') throw new Error('Proxy servers must include a hostname.');
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Proxy credentials must be supplied separately from the server URL.');
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('Proxy server URLs cannot include a path, query, or fragment.');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export const ProxyServerSchema = z
  .string()
  .min(1)
  .max(2_048)
  .transform((value, context) => {
    try {
      return normalizeProxyServer(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid proxy server URL.',
      });
      return z.NEVER;
    }
  });

function containsAsciiControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

const ProxySecretSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !containsAsciiControlCharacter(value), {
    message: 'Proxy credentials cannot contain control characters.',
  });

export const ProxyCredentialsSchema = z
  .object({
    username: ProxySecretSchema.max(256).refine((value) => !value.includes(':'), {
      message: 'Proxy usernames cannot contain a colon.',
    }),
    password: ProxySecretSchema,
  })
  .strict();

export const ProxySelectionModeSchema = z.enum(['round-robin', 'random']);

export const ProxyJitterSchema = z
  .object({
    minMs: z.number().int().min(0).max(MAX_PROXY_JITTER_MS),
    maxMs: z.number().int().min(0).max(MAX_PROXY_JITTER_MS),
  })
  .strict()
  .superRefine((jitter, context) => {
    if (jitter.minMs > jitter.maxMs) {
      context.addIssue({
        code: 'custom',
        message: 'Minimum proxy jitter cannot exceed maximum proxy jitter.',
        path: ['minMs'],
      });
    }
  });

export const DEFAULT_PROXY_JITTER = { minMs: 0, maxMs: 0 } as const;

export const ProxyEndpointRequestSchema = z
  .object({
    server: ProxyServerSchema,
    credentials: ProxyCredentialsSchema.optional(),
  })
  .strict();

export const ProxyEndpointRecipeSchema = z
  .object({
    server: ProxyServerSchema,
    authenticationRequired: z.boolean(),
  })
  .strict();

function uniqueServers(
  entries: readonly { readonly server: string }[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.server)) {
      context.addIssue({
        code: 'custom',
        message: 'Proxy pools cannot contain duplicate servers.',
        path: ['entries', index, 'server'],
      });
    }
    seen.add(entry.server);
  }
}

export const ProxyPoolRequestSchema = z
  .object({
    entries: z.array(ProxyEndpointRequestSchema).min(1).max(MAX_PROXY_POOL_ENTRIES),
    selection: ProxySelectionModeSchema.default('round-robin'),
    jitter: ProxyJitterSchema.default({ ...DEFAULT_PROXY_JITTER }),
  })
  .strict()
  .superRefine((pool, context) => uniqueServers(pool.entries, context));

export const ProxyPoolRecipeSchema = z
  .object({
    entries: z.array(ProxyEndpointRecipeSchema).min(1).max(MAX_PROXY_POOL_ENTRIES),
    selection: ProxySelectionModeSchema.default('round-robin'),
    jitter: ProxyJitterSchema.default({ ...DEFAULT_PROXY_JITTER }),
  })
  .strict()
  .superRefine((pool, context) => uniqueServers(pool.entries, context));

export function proxyPoolRecipeFromRequest(input: ProxyPoolRequest): ProxyPoolRecipe {
  const request = ProxyPoolRequestSchema.parse(input);
  return ProxyPoolRecipeSchema.parse({
    entries: request.entries.map((entry) => ({
      server: entry.server,
      authenticationRequired: entry.credentials !== undefined,
    })),
    selection: request.selection,
    jitter: request.jitter,
  });
}

export type ProxyCredentials = z.infer<typeof ProxyCredentialsSchema>;
export type ProxySelectionMode = z.infer<typeof ProxySelectionModeSchema>;
export type ProxyJitter = z.infer<typeof ProxyJitterSchema>;
export type ProxyEndpointRequest = z.infer<typeof ProxyEndpointRequestSchema>;
export type ProxyEndpointRecipe = z.infer<typeof ProxyEndpointRecipeSchema>;
export type ProxyPoolRequest = z.infer<typeof ProxyPoolRequestSchema>;
export type ProxyPoolRecipe = z.infer<typeof ProxyPoolRecipeSchema>;
