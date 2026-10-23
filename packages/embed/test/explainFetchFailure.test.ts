import { describe, expect, it, vi } from 'vitest';
import { explainFetchFailure, PROBE_TIMEOUT_MS } from '../src/frame/explainFetchFailure';

const URL_MODEL = 'https://models.example/a/cube.bbmodel';
const FRAME = 'https://embed.example';

describe('explainFetchFailure', () => {
  it('names both origins and the header when the server answers the probe', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null))) as unknown as typeof globalThis.fetch;
    const error = await explainFetchFailure(URL_MODEL, { fetch, frameOrigin: FRAME });
    expect(error.code).toBe('MODEL_CORS_BLOCKED');
    expect(error.message).toContain('https://models.example');
    expect(error.message).toContain(FRAME);
    expect(error.message).toContain('Access-Control-Allow-Origin');
    expect(fetch).toHaveBeenCalledWith(
      URL_MODEL,
      expect.objectContaining({ method: 'HEAD', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer' }),
    );
  });

  it('says unreachable when the probe fails too', async () => {
    const fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof globalThis.fetch;
    const error = await explainFetchFailure(URL_MODEL, { fetch, frameOrigin: FRAME });
    expect(error.code).toBe('MODEL_UNREACHABLE');
    expect(error.message).toContain('https://models.example');
    // A browser that blocks the probe's opaque answer under nosniff lands here for a server without the header.
    expect(error.message).toContain(`Access-Control-Allow-Origin: * (or ${FRAME})`);
  });

  it('says unreachable when the probe hangs past its timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetch = ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        )) as typeof globalThis.fetch;
      const pending = explainFetchFailure(URL_MODEL, { fetch, frameOrigin: FRAME });
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
      expect((await pending).code).toBe('MODEL_UNREACHABLE');
    } finally {
      vi.useRealTimers();
    }
  });
});
