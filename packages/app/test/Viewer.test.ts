import { DEFAULT_LOOK } from '@modelshot/looks';
import type { CanvasCssSize, RealtimeRenderer, SetSceneResult } from '@modelshot/renderer-rt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewer, type ViewerOptions } from '../src/viewer/Viewer';
import { boxMesh, doc, node } from './editorDocs';

// The parts of the renderer the Viewer reaches outside a bake; a restore is fired by hand, a scene set when told.
class FakeRenderer {
  restored: () => void = () => undefined;
  finishScene: () => void = () => undefined;
  readonly needsRender = false;
  failed: (error: Error) => void = () => undefined;
  onError(listener: (error: Error) => void): () => void {
    this.failed = listener;
    return () => undefined;
  }
  onContextRestored(listener: () => void): () => void {
    this.restored = listener;
    return () => undefined;
  }
  setScene(): Promise<SetSceneResult> {
    return new Promise((resolve) => {
      this.finishScene = () => resolve({ applied: true, warnings: [] });
    });
  }
  resize(size: CanvasCssSize): { width: number; height: number } {
    return { width: size.cssWidth, height: size.cssHeight };
  }
  setCamera(): void {}
  setLook(): void {}
  setLighting(): boolean {
    return false;
  }
  render(): void {}
  dispose(): void {}
}

type Bake = () => Promise<{ applied: boolean; warnings: string[]; lighting: null }>;
const loaded = (bake: Bake): Promise<unknown> =>
  Promise.resolve({ LightBaker: { create: () => ({ bake, dispose: () => undefined }) } });
const notApplied: Bake = () => Promise.resolve({ applied: false, warnings: [], lighting: null });
let loadPathTracer: () => Promise<unknown> = () => loaded(notApplied);
vi.mock('../src/lazyPathTracer', () => ({ loadPathTracer: () => loadPathTracer() }));

const quiet = { addEventListener: () => undefined, removeEventListener: () => undefined, matches: false };
let laidOut = { width: 100, height: 100 };
const canvas = {
  clientHeight: 100,
  style: { setProperty: () => undefined },
  getAttribute: () => null,
  setAttribute: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  getBoundingClientRect: () => laidOut,
  ownerDocument: {
    defaultView: {
      devicePixelRatio: 1,
      matchMedia: () => quiet,
      ResizeObserver: class {
        observe(): void {}
        disconnect(): void {}
      },
    },
  },
};

function viewer(options: Partial<ViewerOptions> = {}) {
  const renderer = new FakeRenderer();
  const statuses: string[] = [];
  const create = Viewer as unknown as new (c: unknown, r: RealtimeRenderer, o: ViewerOptions) => Viewer;
  const shown = new create(canvas, renderer as unknown as RealtimeRenderer, {
    onStatus: (message) => statuses.push(message),
    onResize: () => undefined,
    onChange: () => undefined,
    ...options,
  });
  return { shown, renderer, statuses };
}

type Settled = [lit: boolean, detail: string | undefined];

async function show(shown: Viewer, renderer: FakeRenderer): Promise<void> {
  const done = shown.setDocument(doc([node(-1, { meshes: [0] })], [boxMesh(0)]), false);
  renderer.finishScene();
  await done;
}

beforeEach(() => {
  laidOut = { width: 100, height: 100 };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Viewer', () => {
  it('a renderer error reported outside a call reaches onStatus once', () => {
    const { renderer, statuses } = viewer();
    renderer.failed(new Error('linear: program link failed'));
    expect(statuses).toEqual(['The preview could not use the graphics driver: linear: program link failed']);
  });

  it('a renderer error goes to onError when given, not to onStatus', () => {
    const onError = vi.fn();
    const { renderer, statuses } = viewer({ onError });
    renderer.failed(new Error('restore failed'));
    expect(onError).toHaveBeenCalledWith('The preview could not use the graphics driver: restore failed');
    expect(statuses).toEqual([]);
  });

  it('syncSize takes the laid-out size ahead of the observer, so a camera framed next fits the view as it is', () => {
    const sizes: CanvasCssSize[] = [];
    const { shown } = viewer({ onResize: (size) => sizes.push(size) });
    expect(shown.syncSize()).toBe(true);
    shown.orbit.reset();
    expect(shown.orbit.state().distance).toBeCloseTo(1, 9);
    // The view turns portrait: the camera keeps its place, which is no longer the fit of the narrower view.
    laidOut = { width: 100, height: 200 };
    expect(shown.syncSize()).toBe(true);
    expect(sizes.at(-1)).toEqual({ cssWidth: 100, cssHeight: 200, devicePixelRatio: 1 });
    expect(shown.orbit.state().distance).toBeLessThan(0.99);
    shown.orbit.reset();
    expect(shown.orbit.state().distance).toBeCloseTo(1, 9);
  });

  it('syncSize reports nothing for an unchanged size or a canvas without a box', () => {
    const sizes: CanvasCssSize[] = [];
    const { shown } = viewer({ onResize: (size) => sizes.push(size) });
    expect(shown.syncSize()).toBe(true);
    expect(shown.syncSize()).toBe(false);
    laidOut = { width: 0, height: 0 };
    expect(shown.syncSize()).toBe(false);
    expect(sizes).toHaveLength(1);
  });

  it('a restored graphics context draws again and bakes nothing: the renderer kept the baked light', () => {
    const onBakeStarted = vi.fn();
    const { renderer, statuses } = viewer({ onBakeStarted });
    renderer.restored();
    expect(statuses).toEqual(['The graphics context was restored.']);
    expect(onBakeStarted).not.toHaveBeenCalled();
  });

  it('tells a restored graphics context to onContextRestored instead of onStatus, and still draws', () => {
    const frames = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', frames);
    const onContextRestored = vi.fn();
    const { renderer, statuses } = viewer({ onContextRestored });
    expect(frames).not.toHaveBeenCalled();
    renderer.restored();
    expect(onContextRestored).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([]);
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it('a look change with keepBake leaves the baked light alone; without it the look bakes again', async () => {
    const onBakeStarted = vi.fn();
    const { shown, renderer } = viewer({ onBakeStarted });
    await show(shown, renderer);
    await vi.waitFor(() => expect(onBakeStarted).toHaveBeenCalled());
    onBakeStarted.mockClear();
    shown.setLook(DEFAULT_LOOK, { keepBake: true });
    expect(onBakeStarted).not.toHaveBeenCalled();
    shown.setLook(DEFAULT_LOOK);
    await vi.waitFor(() => expect(onBakeStarted).toHaveBeenCalledTimes(1));
  });

  it('hands the reason of a bake that threw to onBakeSettled', async () => {
    loadPathTracer = () => loaded(() => Promise.reject(new Error('the bake worker stopped')));
    const settled: Settled[] = [];
    const { shown, renderer, statuses } = viewer({ onBakeSettled: (lit, detail) => settled.push([lit, detail]) });
    await show(shown, renderer);
    await vi.waitFor(() => expect(settled).toEqual([[false, 'the bake worker stopped']]));
    expect(statuses).toContain('The preview shows unbaked light: the bake worker stopped');
  });

  it('gives every bake the reason the path tracer did not load, and says it to onStatus once', async () => {
    const load = vi.fn(() => Promise.reject(new Error('the chunk did not load')));
    loadPathTracer = load;
    const settled: Settled[] = [];
    const { shown, renderer, statuses } = viewer({ onBakeSettled: (lit, detail) => settled.push([lit, detail]) });
    await show(shown, renderer);
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    shown.relight();
    await vi.waitFor(() => expect(settled).toHaveLength(2));
    expect(settled).toEqual([
      [false, 'the chunk did not load'],
      [false, 'the chunk did not load'],
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['The preview shows unbaked light: the chunk did not load']);
  });

  it('settles a bake that did not apply as unbaked without a reason', async () => {
    loadPathTracer = () => loaded(notApplied);
    const settled: Settled[] = [];
    const { shown, renderer } = viewer({ onBakeSettled: (lit, detail) => settled.push([lit, detail]) });
    await show(shown, renderer);
    await vi.waitFor(() => expect(settled).toEqual([[false, undefined]]));
  });

  it('says a document is being set until the renderer has it', async () => {
    const { shown, renderer } = viewer();
    const done = shown.setDocument(doc([node(-1, { meshes: [0] })], [boxMesh(0)]), false, { bake: false });
    expect(shown.settingDocument).toBe(true);
    renderer.finishScene();
    await done;
    expect(shown.settingDocument).toBe(false);
  });
});
