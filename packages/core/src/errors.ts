import {
  SerializedSitepullErrorSchema,
  SitepullErrorCodeSchema,
  SitepullErrorStageSchema,
  type JsonValue,
  type SerializedSitepullError,
  type SitepullErrorCode,
  type SitepullErrorStage,
} from '@sitepull/contracts';

export { SerializedSitepullErrorSchema, SitepullErrorCodeSchema, SitepullErrorStageSchema };
export type { SerializedSitepullError, SitepullErrorCode, SitepullErrorStage };

export interface SitepullErrorOptions {
  readonly code: SitepullErrorCode;
  readonly message: string;
  readonly stage?: SitepullErrorStage;
  readonly retryable?: boolean;
  readonly details?: Readonly<Record<string, JsonValue>>;
  readonly cause?: unknown;
}

/** An actionable error safe to serialize across the CLI and Electron IPC boundary. */
export class SitepullError extends Error {
  readonly code: SitepullErrorCode;
  readonly stage: SitepullErrorStage | undefined;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, JsonValue>> | undefined;

  constructor(options: SitepullErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SitepullError';
    this.code = options.code;
    this.stage = options.stage;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  toJSON(): SerializedSitepullError {
    const serialized: SerializedSitepullError = {
      name: 'SitepullError',
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };

    if (this.stage !== undefined) {
      serialized.stage = this.stage;
    }
    if (this.details !== undefined) {
      serialized.details = { ...this.details };
    }
    return serialized;
  }
}

export function isSitepullError(error: unknown): error is SitepullError {
  return error instanceof SitepullError;
}

export function asSitepullError(
  error: unknown,
  fallback: Omit<SitepullErrorOptions, 'cause' | 'message'> & { readonly message?: string },
): SitepullError {
  if (isSitepullError(error)) {
    return error;
  }

  const message =
    fallback.message ??
    (error instanceof Error ? error.message : 'An unexpected Sitepull error occurred.');

  return new SitepullError({
    ...fallback,
    message,
    cause: error,
  });
}
