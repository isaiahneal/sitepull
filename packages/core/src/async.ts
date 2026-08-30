import { SitepullError } from './errors.js';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new SitepullError({
      code: 'CAPTURE_CANCELLED',
      message: 'The Sitepull capture was cancelled.',
      stage: 'crawling-pages',
      cause: signal.reason,
    });
  }
}

export async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(
        new SitepullError({
          code: 'CAPTURE_CANCELLED',
          message: 'The Sitepull capture was cancelled.',
          stage: 'crawling-pages',
          cause: signal?.reason,
        }),
      );
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapper: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      if (input !== undefined) {
        results[index] = await mapper(input, index);
      }
    }
  });
  await Promise.all(workers);
  return results;
}
