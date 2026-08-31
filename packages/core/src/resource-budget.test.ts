import { describe, expect, it } from 'vitest';

import { ResourceCaptureBudget } from './resource-budget.js';

describe('ResourceCaptureBudget', () => {
  it('passes the tighter combined byte ceiling into a streaming reader', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 8,
      maxCaptureBytes: 5,
      bodyConcurrency: 1,
    });
    let ceiling: number | undefined;

    const result = await budget.read({
      declaredBytes: null,
      read: (maxBytes) => {
        ceiling = maxBytes;
        return Promise.resolve(Buffer.alloc(maxBytes));
      },
    });

    expect(ceiling).toBe(5);
    expect(result.body).toHaveLength(5);
    expect(budget.committedBytes).toBe(5);
  });

  it('rejects declared and actual per-resource overages', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 4,
      maxCaptureBytes: 20,
      bodyConcurrency: 1,
    });
    let reads = 0;

    const declared = await budget.read({
      declaredBytes: 5,
      read: () => {
        reads += 1;
        return Promise.resolve(Buffer.alloc(5));
      },
    });
    const actual = await budget.read({
      declaredBytes: null,
      read: () => {
        reads += 1;
        return Promise.resolve(Buffer.alloc(5));
      },
    });

    expect(declared).toMatchObject({
      body: null,
      failureReason: expect.stringContaining('4 bytes'),
    });
    expect(actual).toMatchObject({ body: null, failureReason: expect.stringContaining('4 bytes') });
    expect(reads).toBe(1);
    expect(budget.committedBytes).toBe(0);
  });

  it('checks the actual body when Content-Length understates it', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 4,
      maxCaptureBytes: 20,
      bodyConcurrency: 1,
    });

    const result = await budget.read({
      declaredBytes: 2,
      read: () => Promise.resolve(Buffer.alloc(5)),
    });

    expect(result).toMatchObject({
      body: null,
      failureReason: expect.stringContaining('4 bytes'),
    });
    expect(budget.committedBytes).toBe(0);
  });

  it('gives concurrent underreported bodies disjoint aggregate ceilings', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 8,
      maxCaptureBytes: 10,
      bodyConcurrency: 2,
    });
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let firstCeiling = 0;
    let secondCeiling = 0;
    let firstStarted: (() => void) | undefined;
    let secondStarted: (() => void) | undefined;
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });

    const first = budget.read({
      declaredBytes: 1,
      read: (maxBytes) => {
        firstCeiling = maxBytes;
        firstStarted?.();
        return new Promise<Buffer>((resolve) => {
          releaseFirst = () => resolve(Buffer.alloc(maxBytes));
        });
      },
    });
    await firstReady;
    const second = budget.read({
      declaredBytes: 1,
      read: (maxBytes) => {
        secondCeiling = maxBytes;
        secondStarted?.();
        return new Promise<Buffer>((resolve) => {
          releaseSecond = () => resolve(Buffer.alloc(maxBytes));
        });
      },
    });
    await secondReady;

    expect([firstCeiling, secondCeiling]).toEqual([8, 2]);
    expect(firstCeiling + secondCeiling).toBe(10);
    releaseFirst?.();
    releaseSecond?.();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.body?.byteLength)).toEqual([8, 2]);
    expect(budget.committedBytes).toBe(10);
  });

  it('reserves aggregate capacity before concurrent reads', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 8,
      maxCaptureBytes: 10,
      bodyConcurrency: 2,
    });
    let releaseFirst: (() => void) | undefined;
    const firstRead = new Promise<Buffer>((resolve) => {
      releaseFirst = () => resolve(Buffer.alloc(8));
    });

    const first = budget.read({ declaredBytes: 8, read: () => firstRead });
    await Promise.resolve();
    let secondStarted = false;
    const second = budget.read({
      declaredBytes: 4,
      read: () => {
        secondStarted = true;
        return Promise.resolve(Buffer.alloc(4));
      },
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst?.();

    expect(await second).toMatchObject({
      body: null,
      failureReason: expect.stringContaining('10 bytes'),
    });
    expect((await first).body).toHaveLength(8);
    expect(budget.committedBytes).toBe(8);
  });

  it('waits for an oversized in-flight reservation before declaring the budget exhausted', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 8,
      maxCaptureBytes: 8,
      bodyConcurrency: 2,
    });
    let releaseFirst: (() => void) | undefined;
    let secondStarted = false;
    const first = budget.read({
      declaredBytes: null,
      read: () =>
        new Promise<Buffer>((resolve) => {
          releaseFirst = () => resolve(Buffer.alloc(1));
        }),
    });
    await Promise.resolve();

    const second = budget.read({
      declaredBytes: 2,
      read: () => {
        secondStarted = true;
        return Promise.resolve(Buffer.alloc(2));
      },
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    releaseFirst?.();
    expect((await first).body).toHaveLength(1);
    expect((await second).body).toHaveLength(2);
    expect(budget.committedBytes).toBe(3);
  });

  it('cancels a read waiting for aggregate capacity', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 8,
      maxCaptureBytes: 8,
      bodyConcurrency: 2,
    });
    let releaseFirst: (() => void) | undefined;
    const first = budget.read({
      declaredBytes: null,
      read: () =>
        new Promise<Buffer>((resolve) => {
          releaseFirst = () => resolve(Buffer.alloc(1));
        }),
    });
    await Promise.resolve();

    const controller = new AbortController();
    const waiting = budget.read({
      declaredBytes: 1,
      signal: controller.signal,
      read: () => Promise.resolve(Buffer.alloc(1)),
    });
    controller.abort(new Error('stop'));
    await expect(waiting).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });

    releaseFirst?.();
    await first;
    const next = await budget.read({
      declaredBytes: 1,
      read: () => Promise.resolve(Buffer.alloc(1)),
    });
    expect(next.body).toHaveLength(1);
  });

  it('backpressures body reads to the configured concurrency', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 10,
      maxCaptureBytes: 100,
      bodyConcurrency: 2,
    });
    let active = 0;
    let maximumActive = 0;
    const reads = Array.from({ length: 6 }, () =>
      budget.read({
        declaredBytes: 1,
        read: async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return Buffer.alloc(1);
        },
      }),
    );

    const results = await Promise.all(reads);
    expect(results.every((result) => result.body?.byteLength === 1)).toBe(true);
    expect(maximumActive).toBe(2);
    expect(budget.committedBytes).toBe(6);
  });

  it('cancels a queued read without consuming a permit', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 10,
      maxCaptureBytes: 100,
      bodyConcurrency: 1,
    });
    let releaseFirst: (() => void) | undefined;
    const first = budget.read({
      declaredBytes: 1,
      read: () =>
        new Promise<Buffer>((resolve) => {
          releaseFirst = () => resolve(Buffer.alloc(1));
        }),
    });
    await Promise.resolve();
    const controller = new AbortController();
    const queued = budget.read({
      declaredBytes: 1,
      signal: controller.signal,
      read: () => Promise.resolve(Buffer.alloc(1)),
    });
    controller.abort(new Error('stop'));
    await expect(queued).rejects.toMatchObject({ code: 'CAPTURE_CANCELLED' });
    releaseFirst?.();
    await first;

    const next = await budget.read({
      declaredBytes: 1,
      read: () => Promise.resolve(Buffer.alloc(1)),
    });
    expect(next.body).toHaveLength(1);
  });

  it('rolls failed-attempt bytes back without releasing committed attempts', async () => {
    const budget = new ResourceCaptureBudget({
      maxResourceBytes: 10,
      maxCaptureBytes: 10,
      bodyConcurrency: 1,
    });
    const failedAttempt = budget.createScope();
    const successfulAttempt = budget.createScope();

    expect(
      (
        await failedAttempt.read({
          declaredBytes: 6,
          read: () => Promise.resolve(Buffer.alloc(6)),
        })
      ).body,
    ).toHaveLength(6);
    failedAttempt.rollback();
    expect(budget.committedBytes).toBe(0);

    expect(
      (
        await successfulAttempt.read({
          declaredBytes: 8,
          read: () => Promise.resolve(Buffer.alloc(8)),
        })
      ).body,
    ).toHaveLength(8);
    successfulAttempt.commit();
    successfulAttempt.rollback();
    expect(budget.committedBytes).toBe(8);
  });
});
