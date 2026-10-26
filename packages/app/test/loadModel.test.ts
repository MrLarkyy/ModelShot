import { describe, expect, it, vi } from 'vitest';
import type { LoadMessage, LoadReply } from '../src/intake/LoadMessages';
import type { LoadRequest } from '../src/intake/groupFiles';
import type { IntakeError } from '../src/intake/IntakeError';
import { loadModel, type LoadWorker } from '../src/intake/loadModel';

const REQUEST: LoadRequest = { kind: 'model', model: new File(['{}'], 'a.bbmodel'), resources: [] };

class FakeWorker implements LoadWorker {
  readonly terminate = vi.fn();
  readonly posted: LoadMessage[] = [];
  private message: ((event: MessageEvent<LoadReply>) => void) | null = null;
  private fail: ((event: Event) => void) | null = null;

  postMessage(message: LoadMessage): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.message = listener as (event: MessageEvent<LoadReply>) => void;
    else this.fail = listener as (event: Event) => void;
  }

  reply(data: LoadReply): void {
    this.message?.({ data } as MessageEvent<LoadReply>);
  }

  crash(): void {
    this.fail?.(new Event('error'));
  }
}

async function failure(promise: Promise<unknown>): Promise<IntakeError> {
  try {
    await promise;
  } catch (error) {
    return error as IntakeError;
  }
  throw new Error('expected a rejection');
}

describe('loadModel', () => {
  it('resolves with the document and ends the worker', async () => {
    const worker = new FakeWorker();
    const loading = loadModel(REQUEST, { createWorker: () => worker, arms: 'slim' });
    expect(worker.posted).toEqual([{ request: REQUEST, arms: 'slim' }]);
    const loaded = {
      ok: true,
      doc: {},
      warnings: [],
      name: 'a.bbmodel',
      kind: 'model',
      key: 'k',
    } as unknown as LoadReply;
    worker.reply(loaded);
    await expect(loading).resolves.toMatchObject({ name: 'a.bbmodel', key: 'k' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('passes the loader code and message through', async () => {
    const worker = new FakeWorker();
    const loading = loadModel(REQUEST, { createWorker: () => worker });
    worker.reply({ ok: false, code: 'NOT_BBMODEL', message: 'Not a Blockbench model at $' });
    const error = await failure(loading);
    expect(error.code).toBe('NOT_BBMODEL');
    expect(error.message).toContain('Not a Blockbench model');
  });

  it('stops a worker that never answers with LOAD_TIMEOUT and terminates it', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const loading = failure(loadModel(REQUEST, { createWorker: () => worker, timeoutMs: 500 }));
      await vi.advanceTimersByTimeAsync(501);
      const error = await loading;
      expect(error.code).toBe('LOAD_TIMEOUT');
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a crashed worker as LOAD_FAILED', async () => {
    const worker = new FakeWorker();
    const loading = loadModel(REQUEST, { createWorker: () => worker });
    worker.crash();
    expect((await failure(loading)).code).toBe('LOAD_FAILED');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports a worker that cannot start as LOAD_FAILED', async () => {
    const error = await failure(
      loadModel(REQUEST, {
        createWorker: () => {
          throw new Error('no workers');
        },
      }),
    );
    expect(error.code).toBe('LOAD_FAILED');
  });

  it('ignores a late answer after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const loading = failure(loadModel(REQUEST, { createWorker: () => worker, timeoutMs: 10 }));
      await vi.advanceTimersByTimeAsync(11);
      worker.reply({ ok: false, code: 'X', message: 'late' });
      expect((await loading).code).toBe('LOAD_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the worker on abort and rejects with an AbortError, ignoring a late answer', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const loading = failure(loadModel(REQUEST, { createWorker: () => worker, signal: controller.signal }));
    controller.abort();
    const error = (await loading) as unknown as DOMException;
    expect(error.name).toBe('AbortError');
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.reply({ ok: false, code: 'X', message: 'late' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('starts no worker for a signal that is already aborted', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const error = (await failure(
      loadModel(REQUEST, { createWorker, signal: AbortSignal.abort() }),
    )) as unknown as DOMException;
    expect(error.name).toBe('AbortError');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('keeps a finished load when the signal aborts later', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const loading = loadModel(REQUEST, { createWorker: () => worker, signal: controller.signal });
    worker.reply({ ok: false, code: 'NOT_BBMODEL', message: 'no' });
    expect((await failure(loading)).code).toBe('NOT_BBMODEL');
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
