import { mkdir, open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { CaptureStage, JsonValue, LogLevel } from '@sitepull/contracts';

export interface StructuredLogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly stage: CaptureStage | null;
  readonly message: string;
  readonly context?: Readonly<Record<string, JsonValue>>;
}

export interface SitepullLogger {
  log(record: Omit<StructuredLogRecord, 'timestamp'>): Promise<void>;
  close(): Promise<void>;
}

class JsonLinesLogger implements SitepullLogger {
  readonly #handle: FileHandle;
  #pending: Promise<void> = Promise.resolve();

  constructor(handle: FileHandle) {
    this.#handle = handle;
  }

  log(record: Omit<StructuredLogRecord, 'timestamp'>): Promise<void> {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`;
    this.#pending = this.#pending.then(async () => {
      await this.#handle.appendFile(line, 'utf8');
    });
    return this.#pending;
  }

  async close(): Promise<void> {
    await this.#pending;
    await this.#handle.close();
  }
}

export async function createJsonLinesLogger(logPath: string): Promise<SitepullLogger> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const handle = await open(logPath, 'a');
  return new JsonLinesLogger(handle);
}

export const nullLogger: SitepullLogger = {
  async log() {},
  async close() {},
};
