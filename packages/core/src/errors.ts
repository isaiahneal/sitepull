import {
  MAX_SITEPULL_ERROR_MESSAGE_LENGTH,
  SerializedSitepullErrorSchema,
  SitepullErrorCodeSchema,
  SitepullErrorStageSchema,
  type JsonValue,
  type SerializedSitepullError,
  type SitepullErrorCode,
  type SitepullErrorStage,
} from '@sitepull/contracts';

export {
  MAX_SITEPULL_ERROR_MESSAGE_LENGTH,
  SerializedSitepullErrorSchema,
  SitepullErrorCodeSchema,
  SitepullErrorStageSchema,
};
export type { SerializedSitepullError, SitepullErrorCode, SitepullErrorStage };

const TRUNCATED_ERROR_MESSAGE_MARKER = '\n… [truncated] …\n';

function boundedSerializedErrorMessage(message: string): string {
  if (message === '') return 'Sitepull failed unexpectedly.';
  if (message.length <= MAX_SITEPULL_ERROR_MESSAGE_LENGTH) return message;
  const retainedLength = MAX_SITEPULL_ERROR_MESSAGE_LENGTH - TRUNCATED_ERROR_MESSAGE_MARKER.length;
  const headLength = Math.ceil(retainedLength / 2);
  const tailLength = Math.floor(retainedLength / 2);
  return `${message.slice(0, headLength)}${TRUNCATED_ERROR_MESSAGE_MARKER}${message.slice(-tailLength)}`;
}

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
      message: boundedSerializedErrorMessage(this.message),
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
