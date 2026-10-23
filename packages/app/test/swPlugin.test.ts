import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildVersion, precacheList } from '../src/offline/swPlugin';
import { serviceWorkerSource } from '../src/offline/sw.template';

const FILES = ['./', 'index.html', 'assets/index-abc.js', 'assets/loadWorker-def.js', 'favicon.svg'];

describe('the precache list', () => {
  it('holds every file of the build and the public files, the folder itself, and not the worker', () => {
    const list = precacheList(['index.html', 'assets/a.js', 'sw.js'], ['favicon.svg', 'social-preview.png']);
    expect(list).toEqual(['./', 'assets/a.js', 'favicon.svg', 'index.html']);
  });

  it('lists a file once', () => {
    expect(precacheList(['a.js', 'a.js'], ['a.js'])).toEqual(['./', 'a.js']);
  });
});

describe('the build version', () => {
  it('changes with any byte of any file and with a file name', () => {
    const base = buildVersion(['a.js', 'one']);
    expect(buildVersion(['a.js', 'one'])).toBe(base);
    expect(buildVersion(['a.js', 'two'])).not.toBe(base);
    expect(buildVersion(['b.js', 'one'])).not.toBe(base);
    expect(buildVersion(['a.js', new Uint8Array([1])])).not.toBe(buildVersion(['a.js', new Uint8Array([2])]));
  });
});

type Listener = (event: Record<string, unknown>) => void;

function runWorker(version = 'v1', files: readonly string[] = FILES) {
  const listeners = new Map<string, Listener>();
  const cacheStore = new Map<string, Map<string, string>>();
  const fetched: string[] = [];
  const cacheOf = (name: string) => {
    let entries = cacheStore.get(name);
    if (!entries) {
      entries = new Map();
      cacheStore.set(name, entries);
    }
    const store = entries;
    return {
      addAll: vi.fn((urls: string[]) => {
        for (const url of urls) store.set(url, `cached:${url}`);
        return Promise.resolve();
      }),
      match: vi.fn((request: { url: string }, options?: { ignoreSearch?: boolean }) => {
        const url = options?.ignoreSearch ? request.url.split('?')[0] : request.url;
        return Promise.resolve(store.get(url ?? ''));
      }),
    };
  };
  const scope = 'https://example.test/app/';
  const self = {
    registration: { scope },
    location: { origin: 'https://example.test' },
    clients: { claim: vi.fn(() => Promise.resolve()) },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  const caches = {
    open: (name: string) => Promise.resolve(cacheOf(name)),
    keys: () => Promise.resolve([...cacheStore.keys()]),
    delete: (name: string) => Promise.resolve(cacheStore.delete(name)),
  };
  const fetchStub = (request: { url: string }) => {
    fetched.push(request.url);
    return Promise.resolve(`network:${request.url}`);
  };
  runInNewContext(serviceWorkerSource({ version, files }), { self, caches, URL, fetch: fetchStub, Promise });

  const dispatch = async (type: string, event: Record<string, unknown>): Promise<unknown> => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({
      ...event,
      waitUntil: (p: Promise<unknown>) => (pending = p),
      respondWith: (p: Promise<unknown>) => (pending = p),
    });
    return pending;
  };
  const request = (url: string, method = 'GET', mode = 'cors') => ({ request: { url, method, mode } });
  return { dispatch, request, cacheStore, fetched, self };
}

describe('the service worker', () => {
  it('caches every listed file under the scope on install', async () => {
    const worker = runWorker('v1');
    await worker.dispatch('install', {});
    const cache = worker.cacheStore.get('modelshot-app-v1');
    expect([...(cache?.keys() ?? [])].sort()).toEqual(
      ['https://example.test/app/', ...FILES.slice(1).map((f) => `https://example.test/app/${f}`)].sort(),
    );
  });

  it('serves a cached file without the network and falls back to it for others', async () => {
    const worker = runWorker();
    await worker.dispatch('install', {});
    expect(await worker.dispatch('fetch', worker.request('https://example.test/app/assets/index-abc.js'))).toBe(
      'cached:https://example.test/app/assets/index-abc.js',
    );
    expect(await worker.dispatch('fetch', worker.request('https://example.test/app/other.js'))).toBe(
      'network:https://example.test/app/other.js',
    );
    expect(worker.fetched).toEqual(['https://example.test/app/other.js']);
  });

  it('opens the page for a navigation with a query', async () => {
    const worker = runWorker();
    await worker.dispatch('install', {});
    const answer = await worker.dispatch(
      'fetch',
      worker.request('https://example.test/app/?open=handoff', 'GET', 'navigate'),
    );
    expect(answer).toBe('cached:https://example.test/app/');
  });

  it('leaves other origins, other folders and non-GET requests to the browser', async () => {
    const worker = runWorker();
    await worker.dispatch('install', {});
    expect(await worker.dispatch('fetch', worker.request('https://other.test/app/a.js'))).toBeUndefined();
    expect(await worker.dispatch('fetch', worker.request('https://example.test/site.js'))).toBeUndefined();
    expect(await worker.dispatch('fetch', worker.request('https://example.test/app/a', 'POST'))).toBeUndefined();
    expect(worker.fetched).toEqual([]);
  });

  it('deletes the caches of older versions on activate and keeps its own', async () => {
    const worker = runWorker('v2');
    worker.cacheStore.set('modelshot-app-v1', new Map());
    worker.cacheStore.set('someone-elses-cache', new Map());
    await worker.dispatch('install', {});
    await worker.dispatch('activate', {});
    expect([...worker.cacheStore.keys()].sort()).toEqual(['modelshot-app-v2', 'someone-elses-cache']);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it('contains no address but the ones it builds from its scope', () => {
    expect(serviceWorkerSource({ version: 'v', files: FILES })).not.toMatch(/https?:\/\//);
  });

  it('encodes the version and file names as data, not code', () => {
    const source = serviceWorkerSource({ version: '"; evil(); "', files: ['a"; evil(); "'] });
    const calls: string[] = [];
    const sandbox = {
      self: { addEventListener: () => undefined, registration: { scope: 'https://x.test/' } },
      caches: {},
      URL,
      fetch: () => undefined,
      evil: () => calls.push('evil'),
    };
    runInNewContext(source, sandbox);
    expect(calls).toEqual([]);
  });
});
