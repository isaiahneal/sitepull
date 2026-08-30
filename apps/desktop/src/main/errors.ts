import {
  IpcFailureSchema,
  SitepullErrorSchema,
  type IpcFailure,
  type JsonValue,
  type SitepullError,
  type SitepullErrorCode,
  type SitepullErrorStage,
} from '@sitepull/contracts';

interface DesktopErrorOptions {
  readonly code: SitepullErrorCode;
  readonly message: string;
  readonly stage?: SitepullErrorStage;
  readonly retryable?: boolean;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export class DesktopError extends Error {
  readonly serialized: SitepullError;

  constructor(options: DesktopErrorOptions) {
    super(options.message);
    this.name = 'DesktopError';
    this.serialized = SitepullErrorSchema.parse({
      name: 'SitepullError',
      code: options.code,
      message: options.message,
      retryable: options.retryable ?? false,
      ...(options.stage === undefined ? {} : { stage: options.stage }),
      ...(options.details === undefined ? {} : { details: options.details }),
    });
  }
}

function serializedFromUnknown(error: unknown): SitepullError | null {
  if (error instanceof DesktopError) return error.serialized;
  if (typeof error !== 'object' || error === null || !('toJSON' in error)) return null;

  try {
    const toJSON = Reflect.get(error, 'toJSON');
    if (typeof toJSON !== 'function') return null;
    const parsed = SitepullErrorSchema.safeParse(Reflect.apply(toJSON, error, []));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function toIpcFailure(error: unknown, fallbackMessage: string): IpcFailure {
  const serialized = serializedFromUnknown(error);
  if (serialized !== null) return IpcFailureSchema.parse({ ok: false, error: serialized });

  const detail = error instanceof Error ? error.message.slice(0, 10_000) : undefined;
  const fallback = SitepullErrorSchema.parse({
    name: 'SitepullError',
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
    stage: 'validation',
    retryable: false,
    ...(detail === undefined ? {} : { details: { cause: detail } }),
  });
  return IpcFailureSchema.parse({ ok: false, error: fallback });
}
