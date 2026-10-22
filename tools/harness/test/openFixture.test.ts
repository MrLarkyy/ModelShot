import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFixture } from '../src/expectGolden';

const info = {
  renderer: 'ANGLE (SwiftShader)',
  floatRenderTargets: true,
  width: 1,
  height: 1,
  samplesDone: 1,
  rgba: '',
};

type Handler = (payload: unknown) => void;
type PageEvent = [name: string, payload: unknown];

const pageError = (message: string): PageEvent => ['pageerror', new Error(message)];
const failedRequest = (url: string, errorText: string): PageEvent => [
  'requestfailed',
  { url: () => url, failure: () => ({ errorText }) },
];
const response = (url: string, status: number): PageEvent => ['response', { url: () => url, status: () => status }];
const consoleMessage = (type: string, text: string): PageEvent => ['console', { type: () => type, text: () => text }];

/** A page whose boot wait fails `bootFailures` times; `onGoto` events fire while the page loads. */
function stubPage(
  bootFailures: number,
  onGoto: PageEvent[] = [],
): { page: Page; calls: string[]; handlers: Map<string, Set<Handler>> } {
  const calls: string[] = [];
  const handlers = new Map<string, Set<Handler>>();
  let failures = bootFailures;
  const page = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, (handlers.get(name) ?? new Set()).add(handler));
      return page;
    },
    off: (name: string, handler: Handler) => {
      handlers.get(name)?.delete(handler);
      return page;
    },
    goto: () => {
      calls.push('goto');
      for (const [name, payload] of onGoto) for (const handler of handlers.get(name) ?? []) handler(payload);
      return Promise.resolve();
    },
    reload: () => Promise.resolve(void calls.push('reload')),
    waitForFunction: () => {
      calls.push('wait');
      return failures-- > 0 ? Promise.reject(new Error('timeout')) : Promise.resolve();
    },
    evaluate: () => Promise.resolve(info),
  };
  return { page: page as unknown as Page, calls, handlers };
}

const listening = (handlers: Map<string, Set<Handler>>): number =>
  [...handlers.values()].reduce((sum, set) => sum + set.size, 0);

describe('openFixture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('boots without a reload when the fixture is there', async () => {
    const { page, calls, handlers } = stubPage(0);
    await openFixture(page, '/pt.html');
    expect(calls).toEqual(['goto', 'wait']);
    expect(listening(handlers)).toBe(0);
  });

  it('reloads once when the fixture module never ran', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { page, calls } = stubPage(1);
    await openFixture(page, '/pt.html');
    expect(calls).toEqual(['goto', 'wait', 'reload', 'wait']);
  });

  it('prints a failed request at the first boot timeout, then reloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { page, calls } = stubPage(1, [failedRequest('/src/pt.ts', 'net::ERR_ABORTED')]);
    await openFixture(page, '/pt.html');
    expect(calls).toEqual(['goto', 'wait', 'reload', 'wait']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[fixture reload\] \/pt\.html did not boot/);
    expect(warn.mock.calls[0]?.[0]).toContain('failed requests: /src/pt.ts (net::ERR_ABORTED)');
  });

  it('a page error does not reload: it fails at once and names the error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { page, calls, handlers } = stubPage(1, [pageError('scene is not defined')]);
    await expect(openFixture(page, '/pt.html')).rejects.toThrow(
      /did not boot in 20000 ms after a page error; page errors: scene is not defined/,
    );
    expect(calls).toEqual(['goto', 'wait']);
    expect(warn).not.toHaveBeenCalled();
    expect(listening(handlers)).toBe(0);
  });

  it('a second failure names the failed requests, error responses and console errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { page, calls, handlers } = stubPage(2, [
      failedRequest('/src/pt.ts', 'net::ERR_ABORTED'),
      response('/src/scene.ts', 504),
      response('/pt.html', 200),
      consoleMessage('error', 'Failed to load module script'),
      consoleMessage('log', 'not an error'),
    ]);
    const failure = openFixture(page, '/pt.html');
    await expect(failure).rejects.toThrow('did not boot after a reload');
    await expect(failure).rejects.toThrow(
      'page errors: none; failed requests: /src/pt.ts (net::ERR_ABORTED); responses >= 400: 504 /src/scene.ts; ' +
        'console errors: Failed to load module script',
    );
    expect(calls).toEqual(['goto', 'wait', 'reload', 'wait']);
    expect(listening(handlers)).toBe(0);
  });
});
