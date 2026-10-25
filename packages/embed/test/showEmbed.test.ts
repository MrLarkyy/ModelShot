import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedError } from '../src/EmbedError';
import type { EmbedEnvironment, EmbedPage } from '../src/frame/showEmbed';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ViewerOptions {
  onBakeStarted?: () => void;
  onBakeSettled?: (lit: boolean) => void;
}

/** The viewer as showEmbed uses it; setDocument settles when the test says so. */
class FakeViewer {
  doc: unknown = null;
  /** Like the app's viewer without its light baker: the bake settles one microtask after it starts. */
  bakerMissing = false;
  readonly documents: { readonly doc: unknown; readonly result: Deferred<{ applied: boolean }> }[] = [];
  readonly setLook = vi.fn();
  readonly setView = vi.fn();
  readonly resetView = vi.fn();
  readonly changed = vi.fn();
  readonly orbit = { setState: vi.fn(), rotate: vi.fn() };

  constructor(readonly options: ViewerOptions) {}

  setDocument(doc: unknown): Promise<{ applied: boolean }> {
    const result = deferred<{ applied: boolean }>();
    this.documents.push({ doc, result });
    return result.promise.then((answer) => {
      if (answer.applied) {
        this.doc = doc;
        this.options.onBakeStarted?.();
        if (this.bakerMissing) queueMicrotask(() => this.options.onBakeSettled?.(false));
      }
      return answer;
    });
  }
}

interface Pending<T> {
  readonly name: string;
  readonly signal: AbortSignal;
  readonly answer: Deferred<T>;
}

/** A call that settles when the test says so, or rejects like the real one when its signal aborts. */
function pending<T>(calls: Pending<T>[], name: string, signal: AbortSignal): Promise<T> {
  const answer = deferred<T>();
  signal.addEventListener('abort', () => answer.reject(new DOMException('aborted', 'AbortError')));
  calls.push({ name, signal, answer });
  return answer.promise;
}

const fakes = vi.hoisted(() => ({
  viewers: [] as unknown[],
  fetches: [] as unknown[],
  reads: [] as unknown[],
  rotations: [] as { stop: () => void }[],
  bakerMissing: false,
}));

vi.mock('@modelshot/app/viewer', () => ({
  Viewer: {
    create: (_canvas: unknown, options: ViewerOptions) => {
      const viewer = new FakeViewer(options);
      viewer.bakerMissing = fakes.bakerMissing;
      fakes.viewers.push(viewer);
      return viewer;
    },
  },
}));

vi.mock('@modelshot/app/intake', () => ({
  checkIntake: () => null,
  groupFiles: (files: File[]) => ({ kind: 'model', model: files[0], resources: [] }),
  loadModel: (request: { model: File }, options: { signal: AbortSignal }) =>
    pending(fakes.reads as Pending<{ doc: unknown }>[], request.model.name, options.signal),
}));

vi.mock('../src/frame/fetchModel', () => ({
  fetchModel: (url: string, options: { signal: AbortSignal }) =>
    pending(fakes.fetches as Pending<File>[], url, options.signal),
}));

vi.mock('../src/frame/autorotate', () => ({
  startAutorotate: () => {
    const rotation = { stop: vi.fn() };
    fakes.rotations.push(rotation);
    return rotation.stop;
  },
}));

const { showEmbed } = await import('../src/frame/showEmbed');

const A = 'https://models.example/a.bbmodel';
const B = 'https://models.example/b.bbmodel';

function fragment(model: string, extra = ''): string {
  return `#v=1&model=${encodeURIComponent(model)}${extra}`;
}

interface Embed {
  readonly page: EmbedPage & { stage: { dataset: Record<string, string> } };
  readonly posts: () => string[];
  update(hash: string): void;
}

function start(hash: string): Embed {
  const page = {
    stage: { dataset: {} as Record<string, string>, append: vi.fn() },
    status: { textContent: '' },
    alert: { textContent: '', hidden: true },
  };
  const parent = { postMessage: vi.fn() };
  const env: EmbedEnvironment = {
    fetch: vi.fn(),
    origin: 'https://embed.example',
    parent,
    self: { postMessage: vi.fn() },
  };
  const handle = showEmbed(page as unknown as EmbedPage, hash, env);
  return {
    page: page as unknown as Embed['page'],
    posts: () => parent.postMessage.mock.calls.map(([message]) => (message as { type: string }).type),
    update: (next) => handle.update(next),
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const viewer = (): FakeViewer => fakes.viewers[0] as FakeViewer;
const fetches = (): Pending<File>[] => fakes.fetches as Pending<File>[];
const reads = (): Pending<{ doc: unknown }>[] => fakes.reads as Pending<{ doc: unknown }>[];

/** Lets the latest download, read and setDocument of `url` through. */
async function arrive(url: string, applied = true): Promise<void> {
  await settle();
  const name = url.slice(url.lastIndexOf('/') + 1);
  fetches()
    .filter((f) => f.name === url)
    .at(-1)
    ?.answer.resolve(new File(['{}'], name));
  await settle();
  reads()
    .filter((r) => r.name === name)
    .at(-1)
    ?.answer.resolve({ doc: `doc ${name}` });
  await settle();
  viewer().documents.at(-1)?.result.resolve({ applied });
  await settle();
}

beforeEach(() => {
  fakes.viewers.length = 0;
  fakes.fetches.length = 0;
  fakes.reads.length = 0;
  fakes.rotations.length = 0;
  fakes.bakerMissing = false;
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), addEventListener: vi.fn(), remove: vi.fn() }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('showEmbed', () => {
  it('posts load when the model is shown, and not again for a look or camera change', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    expect(embed.page.stage.dataset['state']).toBe('shown');
    expect(viewer().doc).toBe('doc a.bbmodel');
    embed.update(fragment(A, '&look=rim&yaw=90'));
    await settle();
    expect(viewer().setLook).toHaveBeenCalledTimes(2);
    expect(fetches()).toHaveLength(1);
    expect(embed.posts()).toEqual(['load']);
  });

  it('switching back during a download aborts it and posts load for the shown model', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    expect(embed.page.stage.dataset['state']).toBe('loading');
    embed.update(fragment(A));
    expect(fetches()[1]?.signal.aborted).toBe(true);
    expect(embed.page.stage.dataset['state']).toBe('shown');
    await settle();
    expect(viewer().documents).toHaveLength(1);
    expect(embed.posts()).toEqual(['load', 'load']);
  });

  it('aborts the read of a model the latest fragment no longer asks for', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    fetches()[1]?.answer.resolve(new File(['{}'], 'b.bbmodel'));
    await settle();
    expect(reads()[1]?.signal.aborted).toBe(false);
    embed.update(fragment(A));
    expect(reads()[1]?.signal.aborted).toBe(true);
    await settle();
    expect(viewer().documents).toHaveLength(1);
  });

  it('replaces a model set while a newer fragment came with the model that fragment asks for', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    fetches()[1]?.answer.resolve(new File(['{}'], 'b.bbmodel'));
    await settle();
    reads()[1]?.answer.resolve({ doc: 'doc b.bbmodel' });
    await settle();
    expect(viewer().documents).toHaveLength(2);

    // B is being set when the fragment asks for A again; A is in the viewer, so it is shown at once.
    embed.update(fragment(A));
    expect(embed.page.stage.dataset['state']).toBe('shown');
    viewer().documents[1]?.result.resolve({ applied: true });
    await settle();
    expect(viewer().doc).toBe('doc b.bbmodel');
    expect(embed.page.stage.dataset['state']).toBe('loading');
    expect(fetches().map((f) => f.name)).toEqual([A, B, A]);

    await arrive(A);
    expect(viewer().doc).toBe('doc a.bbmodel');
    expect(embed.page.stage.dataset['state']).toBe('shown');
    expect(embed.posts()).toEqual(['load', 'load', 'load']);
  });

  it('a model set by a superseded load that the latest fragment wants is shown without another download', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    fetches()[1]?.answer.resolve(new File(['{}'], 'b.bbmodel'));
    await settle();
    reads()[1]?.answer.resolve({ doc: 'doc b.bbmodel' });
    await settle();
    // B is being set; an invalid fragment, then B again (a new load of B).
    embed.update(fragment(B, '&yaw=abc'));
    embed.update(fragment(B));
    expect(fetches()).toHaveLength(3);
    viewer().documents[1]?.result.resolve({ applied: true });
    await settle();
    expect(fetches()[2]?.signal.aborted).toBe(true);
    expect(viewer().doc).toBe('doc b.bbmodel');
    expect(embed.page.stage.dataset['state']).toBe('shown');
    expect(embed.posts()).toEqual(['load', 'error', 'load']);
  });

  it('an invalid fragment during a load aborts it and reports only the error', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    embed.update(fragment(B, '&yaw=abc'));
    expect(fetches()[1]?.signal.aborted).toBe(true);
    expect(embed.page.stage.dataset['state']).toBe('failed');
    expect(embed.page.alert.textContent).toMatch(/^INVALID_PARAM: yaw /);
    await settle();
    expect(viewer().documents).toHaveLength(1);
    expect(embed.posts()).toEqual(['load', 'error']);
  });

  it('shows the model again after a failed one and posts load', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    fetches()[1]?.answer.reject(new EmbedError('MODEL_HTTP_ERROR', 'b answered 404.'));
    await settle();
    expect(embed.page.stage.dataset['state']).toBe('failed');
    embed.update(fragment(A));
    expect(embed.page.alert.hidden).toBe(true);
    expect(embed.page.stage.dataset['state']).toBe('shown');
    expect(embed.posts()).toEqual(['load', 'error', 'load']);
  });

  it('an invalid fragment stops autorotate, and the valid one starts it again', async () => {
    const embed = start(fragment(A, '&autorotate=1'));
    await arrive(A);
    viewer().options.onBakeSettled?.(true);
    expect(fakes.rotations).toHaveLength(1);
    embed.update(fragment(A, '&autorotate=1&pitch=95'));
    expect(fakes.rotations[0]?.stop).toHaveBeenCalledOnce();
    embed.update(fragment(A, '&autorotate=1'));
    expect(fakes.rotations).toHaveLength(2);
  });

  it('a bake that settles before the load continues leaves the light unbaked and starts autorotate', async () => {
    fakes.bakerMissing = true;
    const embed = start(fragment(A, '&autorotate=1'));
    await arrive(A);
    expect(embed.page.stage.dataset['light']).toBe('unbaked');
    expect(fakes.rotations).toHaveLength(1);

    embed.update(fragment(B, '&autorotate=1'));
    expect(fakes.rotations[0]?.stop).toHaveBeenCalledOnce();
    await arrive(B);
    expect(embed.page.stage.dataset['light']).toBe('unbaked');
    expect(fakes.rotations).toHaveLength(2);
  });

  it('a superseded model that lands after a newer fragment failed leaves it failed, with no new request', async () => {
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await settle();
    fetches()[1]?.answer.resolve(new File(['{}'], 'b.bbmodel'));
    await settle();
    reads()[1]?.answer.resolve({ doc: 'doc b.bbmodel' });
    await settle();

    const C = 'http://models.example/c.bbmodel';
    embed.update(fragment(C));
    await settle();
    fetches()[2]?.answer.reject(new EmbedError('MODEL_INSECURE', 'insecure'));
    await settle();
    expect(embed.page.stage.dataset['state']).toBe('failed');

    viewer().documents[1]?.result.resolve({ applied: true });
    await settle();
    expect(fetches()).toHaveLength(3);
    expect(embed.page.stage.dataset['state']).toBe('failed');
    expect(embed.page.alert.hidden).toBe(false);
    expect(embed.posts()).toEqual(['load', 'error']);
  });

  it('a bake that settles unlit replaces the loading status with the unbaked text', async () => {
    fakes.bakerMissing = true;
    const embed = start(fragment(A));
    await arrive(A);
    embed.update(fragment(B));
    await arrive(B);
    expect(embed.page.status.textContent).toBe('The preview shows unbaked light.');
  });
});
