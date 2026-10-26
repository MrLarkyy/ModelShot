import { describe, expect, it, vi } from 'vitest';
import { EmbedError } from '../src/EmbedError';
import { MAX_EMBED_MODEL_BYTES, MODEL_FETCH_TIMEOUT_MS, fetchModel } from '../src/frame/fetchModel';
import { modelFileName } from '../src/frame/modelFileName';

const URL_HTTPS = 'https://models.example/a/cube.bbmodel';
const FRAME = 'https://embed.example';

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** A fetch that answers every call with `answer`, recording the calls. */
function fakeFetch(answer: (init: RequestInit | undefined, call: number) => Promise<Response>) {
  const calls: Call[] = [];
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
    return answer(init, calls.length);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** A body of `chunks` chunks of `size` bytes, recording whether it was cancelled and how many chunks were pulled. */
function countingBody(chunks: number, size: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) {
        controller.close();
        return;
      }
      state.pulled++;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

async function failure(promise: Promise<unknown>): Promise<EmbedError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EmbedError);
  return error as EmbedError;
}

describe('fetchModel', () => {
  it('downloads the model as a file named after the URL, without credentials or referrer', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response('{"meta":{}}')));
    const file = await fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME });
    expect(file.name).toBe('cube.bbmodel');
    expect(await file.text()).toBe('{"meta":{}}');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('refuses an http model from an https frame without any request', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(new Response('x')));
    const error = await failure(fetchModel('http://models.example/cube.bbmodel', { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('MODEL_INSECURE');
    expect(calls).toHaveLength(0);
  });

  it('loads an http model from an http frame', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(new Response('x')));
    const file = await fetchModel('http://models.example/cube.bbmodel', {
      fetch,
      frameOrigin: 'http://127.0.0.1:5000',
    });
    expect(file.size).toBe(1);
  });

  it('reports the status of a failed response', async () => {
    const { fetch } = fakeFetch(() =>
      Promise.resolve(new Response('missing', { status: 404, statusText: 'Not Found' })),
    );
    const error = await failure(fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('MODEL_HTTP_ERROR');
    expect(error.message).toContain('404 Not Found');
  });

  it('refuses a declared length over the limit before reading the body', async () => {
    const { stream, state } = countingBody(4, 16);
    const { fetch } = fakeFetch(() =>
      Promise.resolve(new Response(stream, { headers: { 'content-length': String(MAX_EMBED_MODEL_BYTES + 1) } })),
    );
    const error = await failure(fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('MODEL_TOO_LARGE');
    expect(error.message).toContain('64 MiB');
    expect(state.pulled).toBeLessThanOrEqual(1);
    await vi.waitFor(() => expect(state.cancelled).toBe(true));
  });

  it('cancels a body that streams past the limit without a declared length', async () => {
    const { stream, state } = countingBody(100, 16);
    const { fetch } = fakeFetch(() => Promise.resolve(new Response(stream)));
    const error = await failure(fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME, maxBytes: 64 }));
    expect(error.code).toBe('MODEL_TOO_LARGE');
    expect(state.pulled).toBeLessThan(10);
    await vi.waitFor(() => expect(state.cancelled).toBe(true));
  });

  it('accepts a body of exactly the limit', async () => {
    const { stream } = countingBody(4, 16);
    const { fetch } = fakeFetch(() => Promise.resolve(new Response(stream)));
    const file = await fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME, maxBytes: 64 });
    expect(file.size).toBe(64);
  });

  it('stops a server that never answers after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = fakeFetch(
        (init) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          ),
      );
      const pending = failure(fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME }));
      await vi.advanceTimersByTimeAsync(MODEL_FETCH_TIMEOUT_MS);
      const error = await pending;
      expect(error.code).toBe('MODEL_FETCH_TIMEOUT');
      expect(error.message).toContain('30 s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a body that stalls after the headers', async () => {
    vi.useFakeTimers();
    try {
      const { fetch } = fakeFetch((init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(8));
            init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return Promise.resolve(new Response(body));
      });
      const pending = failure(fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME, timeoutMs: 1000 }));
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).code).toBe('MODEL_FETCH_TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains a request without response with one HEAD probe', async () => {
    const { fetch, calls } = fakeFetch((_init, call) =>
      call === 1 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(null)),
    );
    const error = await failure(fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME }));
    expect(error.code).toBe('MODEL_CORS_BLOCKED');
    expect(calls.map((c) => [c.url, c.init?.method])).toEqual([
      [URL_HTTPS, 'GET'],
      [URL_HTTPS, 'HEAD'],
    ]);
  });

  it('rejects with the abort reason when the frame moves on', async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch(
      (init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
    );
    const pending = fetchModel(URL_HTTPS, { fetch, frameOrigin: FRAME, signal: controller.signal });
    controller.abort(new Error('superseded'));
    await expect(pending).rejects.toThrow('superseded');
  });
});

describe('modelFileName', () => {
  it.each([
    ['https://m.example/a/cube.bbmodel', 'cube.bbmodel'],
    ['https://m.example/a/my%20model.glb?x=1#y', 'my model.glb'],
    ['https://m.example/a/bad%E0%A4%A.obj', 'bad%E0%A4%A.obj'],
    ['https://m.example/a/x%2F..%2Fy.gltf', 'x_.._y.gltf'],
    ['https://m.example/', 'model'],
    [`https://m.example/${'n'.repeat(200)}.bbmodel`, `${'n'.repeat(120)}.bbmodel`],
  ])('names %s %j', (url, name) => {
    expect(modelFileName(url)).toBe(name);
  });
});
