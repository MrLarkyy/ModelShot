import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntakeError } from '../src/intake/IntakeError';
import type { ListMessage, ListReply, LoadMessage, LoadReply } from '../src/intake/LoadMessages';
import type { LoadRequest } from '../src/intake/groupFiles';
import { openModel, type LoadWorker } from '../src/intake/openModel';

const MODEL = new File(['{}'], 'a.gltf');
const REQUEST: LoadRequest = { kind: 'model', model: MODEL, resources: [new File(['b'], 'a.bin')] };
const LOADED = { ok: true, doc: {}, warnings: [], name: 'a.gltf', kind: 'model', key: 'k' } as unknown as LoadReply;

class FakeWorker implements LoadWorker {
  readonly terminate = vi.fn();
  readonly posted: (LoadMessage | ListMessage)[] = [];
  private message: ((event: MessageEvent<LoadReply | ListReply>) => void) | null = null;
  private fail: ((event: Event) => void) | null = null;

  postMessage(message: LoadMessage | ListMessage): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.message = listener as (event: MessageEvent<LoadReply | ListReply>) => void;
    else this.fail = listener as (event: Event) => void;
  }

  reply(data: unknown): void {
    this.message?.({ data } as MessageEvent<LoadReply | ListReply>);
  }

  crash(): void {
    this.fail?.(new Event('error'));
  }
}

function workers(): { created: FakeWorker[]; createWorker: () => FakeWorker } {
  const created: FakeWorker[] = [];
  return {
    created,
    createWorker: () => {
      const worker = new FakeWorker();
      created.push(worker);
      return worker;
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<IntakeError> {
  try {
    await promise;
  } catch (error) {
    return error as IntakeError;
  }
  throw new Error('expected a rejection');
}

/** The watchdog's clocks: timers and the monotonic `performance.now`; `Date` too, for a test to jump it. */
const CLOCKS: ('setTimeout' | 'clearTimeout' | 'Date' | 'performance')[] = [
  'setTimeout',
  'clearTimeout',
  'Date',
  'performance',
];

afterEach(() => {
  vi.useRealTimers();
});

describe('openModel', () => {
  it('lists the model and its library, then loads it in the same worker, and ends the worker', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker, arms: 'slim' });
    expect(created).toHaveLength(0);

    const listing = session.listReferences(MODEL, 'model', 512);
    created[0]!.reply({ ok: true, references: ['a.bin', 'a.mtl'] });
    expect(await listing).toEqual(['a.bin', 'a.mtl']);
    const library = new File(['newmtl a'], 'a.mtl');
    const libraryListing = session.listReferences(library, 'library', 512);
    created[0]!.reply({ ok: true, references: [] });
    expect(await libraryListing).toEqual([]);

    const loading = session.load(REQUEST);
    created[0]!.reply(LOADED);
    await expect(loading).resolves.toMatchObject({ name: 'a.gltf', key: 'k' });
    expect(created).toHaveLength(1);
    expect(created[0]!.posted).toEqual([
      { list: { file: MODEL, of: 'model', maxReferences: 512 } },
      { list: { file: library, of: 'library', maxReferences: 512 } },
      { request: REQUEST, arms: 'slim', listed: true },
    ]);
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    expect((await failure(session.listReferences(MODEL, 'model', 512))).name).toBe('InvalidStateError');
  });

  it('loads another file than the listed model in a fresh worker', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = session.listReferences(new File(['{}'], 'a.gltf'), 'model', 512);
    created[0]!.reply({ ok: true, references: [] });
    await listing;
    const loading = session.load(REQUEST);
    expect(created).toHaveLength(2);
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    expect(created[1]!.posted).toEqual([{ request: REQUEST, arms: 'classic' }]);
    created[1]!.reply(LOADED);
    await expect(loading).resolves.toMatchObject({ key: 'k' });
  });

  it('passes a list failure through and ends the worker', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = failure(session.listReferences(MODEL, 'model', 512));
    created[0]!.reply({ ok: false, code: 'LOAD_FAILED', message: 'could not read' });
    expect((await listing).code).toBe('LOAD_FAILED');
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    ['not a list', { ok: true, references: 'a.bin' }],
    ['no list', { ok: true }],
    ['a list with a non-string', { ok: true, references: ['a.bin', 7] }],
    ['a list longer than asked for', { ok: true, references: ['a', 'b', 'c', 'd'] }],
  ])('refuses %s as an answer with LOAD_FAILED and ends the worker', async (_what, reply) => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = failure(session.listReferences(MODEL, 'model', 2));
    created[0]!.reply(reply);
    expect((await listing).code).toBe('LOAD_FAILED');
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    expect((await failure(session.load(REQUEST))).code).toBe('LOAD_FAILED');
    expect(created).toHaveLength(1);
  });

  it('takes maxReferences + 1 references, the lister telling "too many"', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = session.listReferences(MODEL, 'model', 2);
    created[0]!.reply({ ok: true, references: ['a', 'b', 'c'] });
    expect(await listing).toEqual(['a', 'b', 'c']);
  });

  it('reports a worker that crashes while listing as LOAD_FAILED', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = failure(session.listReferences(MODEL, 'model', 512));
    created[0]!.crash();
    const error = await listing;
    expect([error.code, error.message]).toEqual(['LOAD_FAILED', 'The model reader stopped working.']);
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('stops the worker on abort during a list, rejecting with the reason, and starts no other', async () => {
    const { created, createWorker } = workers();
    const controller = new AbortController();
    const session = openModel({ createWorker, signal: controller.signal });
    const listing = failure(session.listReferences(MODEL, 'model', 512));
    controller.abort(new Error('superseded'));
    expect((await listing).message).toBe('superseded');
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    created[0]!.reply({ ok: true, references: [] });
    expect((await failure(session.load(REQUEST))).message).toBe('superseded');
    expect(created).toHaveLength(1);
  });

  it('stops the worker holding the read model when the signal aborts between list and load', async () => {
    const { created, createWorker } = workers();
    const controller = new AbortController();
    const session = openModel({ createWorker, signal: controller.signal });
    const listing = session.listReferences(MODEL, 'model', 512);
    created[0]!.reply({ ok: true, references: ['a.bin'] });
    await listing;
    expect(created[0]!.terminate).not.toHaveBeenCalled();
    controller.abort();
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('gives the list and the load one watchdog, not counting the time between them', async () => {
    vi.useFakeTimers({ toFake: CLOCKS });
    const { created, createWorker } = workers();
    const session = openModel({ createWorker, timeoutMs: 1000 });
    const listing = session.listReferences(MODEL, 'model', 512);
    await vi.advanceTimersByTimeAsync(600);
    created[0]!.reply({ ok: true, references: [] });
    await listing;
    // The frame downloads the files meanwhile: not the worker's time.
    await vi.advanceTimersByTimeAsync(10_000);
    const loading = failure(session.load(REQUEST));
    await vi.advanceTimersByTimeAsync(399);
    expect(created[0]!.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const error = await loading;
    expect(error.code).toBe('LOAD_TIMEOUT');
    expect(error.message).toContain('1 s');
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('keeps the watchdog total when the wall clock jumps during the list and before the load', async () => {
    vi.useFakeTimers({ toFake: CLOCKS });
    const { created, createWorker } = workers();
    const session = openModel({ createWorker, timeoutMs: 1000 });
    const listing = session.listReferences(MODEL, 'model', 512);
    await vi.advanceTimersByTimeAsync(300);
    vi.setSystemTime(0);
    await vi.advanceTimersByTimeAsync(300);
    created[0]!.reply({ ok: true, references: [] });
    await listing;
    vi.setSystemTime(Date.UTC(2100, 0, 1));
    const loading = failure(session.load(REQUEST));
    await vi.advanceTimersByTimeAsync(399);
    expect(created[0]!.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await loading).code).toBe('LOAD_TIMEOUT');
  });

  it('stops a list that never answers with LOAD_TIMEOUT', async () => {
    vi.useFakeTimers({ toFake: CLOCKS });
    const { created, createWorker } = workers();
    const session = openModel({ createWorker, timeoutMs: 500 });
    const listing = failure(session.listReferences(MODEL, 'model', 512));
    await vi.advanceTimersByTimeAsync(501);
    expect((await listing).code).toBe('LOAD_TIMEOUT');
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('ends the worker on close, rejecting a request in flight and any later one', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = failure(session.listReferences(MODEL, 'model', 512));
    session.close();
    expect((await listing).name).toBe('AbortError');
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    session.close();
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    expect((await failure(session.load(REQUEST))).name).toBe('AbortError');
    expect(created).toHaveLength(1);
  });

  it('starts no worker when closed before any request', () => {
    const { created, createWorker } = workers();
    openModel({ createWorker }).close();
    expect(created).toHaveLength(0);
  });

  it('takes one request at a time, the one in flight left as it was', async () => {
    const { created, createWorker } = workers();
    const session = openModel({ createWorker });
    const listing = session.listReferences(MODEL, 'model', 512);
    const other: LoadRequest = { kind: 'model', model: new File(['{}'], 'b.gltf'), resources: [] };
    await expect(session.load(other)).rejects.toThrow('one request at a time');
    await expect(session.listReferences(new File([''], 'b.gltf'), 'model', 512)).rejects.toThrow(
      'one request at a time',
    );
    expect(created[0]!.terminate).not.toHaveBeenCalled();
    created[0]!.reply({ ok: true, references: [] });
    expect(await listing).toEqual([]);
    const loading = session.load(REQUEST);
    expect(created).toHaveLength(1);
    created[0]!.reply(LOADED);
    await expect(loading).resolves.toMatchObject({ key: 'k' });
  });
});
