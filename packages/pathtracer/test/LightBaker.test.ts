import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BakeReply, BakeRequest } from '../src/bake/bakeMessages';
import { progressSamples } from '../src/bake/bakeMessages';
import { LightBaker } from '../src/LightBaker';
import { PathTracerError } from '../src/PathTracerError';
import { sceneOf, triangleMesh } from './testScenes';

class FakeWorker {
  static last: FakeWorker | null = null;
  readonly posted: BakeRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: BakeRequest): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: BakeReply): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data });
  }

  fail(): void {
    for (const listener of this.listeners.get('error') ?? []) listener({ message: 'boom', preventDefault: () => {} });
  }
}

const doc = sceneOf([triangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0])]);
const lighting = { layoutKey: 'k', width: 1, height: 1, data: new Uint16Array(4), samples: 1, catcher: null };

function baker(): { baker: LightBaker; worker: FakeWorker } {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  const created = LightBaker.create({ testHooks: true });
  return { baker: created, worker: FakeWorker.last! };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LightBaker', () => {
  it('needs module workers and OffscreenCanvas: no main-thread fallback', () => {
    vi.stubGlobal('Worker', undefined);
    let error: unknown;
    try {
      LightBaker.create();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PathTracerError);
    expect((error as PathTracerError).code).toBe('WORKER_UNAVAILABLE');
  });

  it('rejects options out of range with a RangeError and a malformed scene with INVALID_SCENE', async () => {
    const { baker: b, worker } = baker();
    for (const options of [{ samples: 0 }, { samples: 1025 }, { samples: 1.5 }, { seed: -1 }, { tileSize: 8 }]) {
      await expect(b.bake(doc, options), JSON.stringify(options)).rejects.toThrow(RangeError);
    }
    const broken = { ...doc, meshes: [{ ...doc.meshes[0]!, indices: new Uint32Array([0, 1, 7]) }] };
    await expect(b.bake(broken)).rejects.toMatchObject({ code: 'INVALID_SCENE' });
    expect(worker.posted).toEqual([]);
  });

  it('posts texture bytes only when the textures array changed', () => {
    const { baker: b, worker } = baker();
    void b.bake(doc);
    void b.bake({ ...doc, nodes: [] });
    void b.bake({ ...doc, textures: [] });
    const bakes = worker.posted.filter((m) => m.type === 'bake');
    expect(bakes.map((m) => m.texturesIncluded)).toEqual([true, false, true]);
    expect(bakes.map((m) => m.texturesVersion)).toEqual([1, 1, 2]);
    expect(bakes.map((m) => [m.samples, m.seed, m.tileSize, m.shadowCatcher])).toEqual([
      [64, 1, 64, true],
      [64, 1, 64, true],
      [64, 1, 64, true],
    ]);
  });

  it('applies only the latest bake and reports its progress', async () => {
    const { baker: b, worker } = baker();
    const progress: number[] = [];
    const first = b.bake(doc, { onProgress: (p) => progress.push(p.samplesDone) });
    const second = b.bake(doc, { samples: 16, onProgress: (p) => progress.push(-p.samplesDone) });
    worker.reply({ type: 'progress', id: 1, lighting: { ...lighting, samples: 4 } });
    worker.reply({ type: 'done', id: 1, lighting, warnings: [] });
    worker.reply({ type: 'progress', id: 2, lighting: { ...lighting, samples: 4 } });
    worker.reply({ type: 'done', id: 2, lighting, warnings: [] });
    expect(await first).toEqual({ applied: false, warnings: [], lighting: null });
    expect(await second).toMatchObject({ applied: true, lighting });
    expect(progress).toEqual([-4]);
  });

  it('turns worker errors into PathTracerError', async () => {
    const { baker: b, worker } = baker();
    const pending = b.bake(doc);
    worker.reply({
      type: 'error',
      id: 1,
      name: 'PathTracerError',
      code: 'SCENE_TOO_LARGE',
      message: 'big',
      path: 'meshes',
    });
    await expect(pending).rejects.toMatchObject({ code: 'SCENE_TOO_LARGE', path: 'meshes' });
    const failing = b.bake(doc);
    worker.fail();
    await expect(failing).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' });
    expect(worker.terminated).toBe(true);
  });

  it('dispose supersedes a pending bake and terminates the worker once it released everything', async () => {
    const { baker: b, worker } = baker();
    const pending = b.bake(doc);
    b.dispose();
    expect(worker.posted.at(-1)).toEqual({ type: 'dispose' });
    expect(b.terminated).toBe(false);
    worker.reply({ type: 'stopped', id: 1 });
    worker.reply({ type: 'disposed' });
    expect(await pending).toEqual({ applied: false, warnings: [], lighting: null });
    expect(worker.terminated).toBe(true);
    expect(b.terminated).toBe(true);
    expect(await b.bake(doc)).toMatchObject({ applied: false });
  });

  it('reports after every fourfold of samples and at the end', () => {
    expect(progressSamples(1)).toEqual([1]);
    expect(progressSamples(16)).toEqual([4, 16]);
    expect(progressSamples(64)).toEqual([4, 16, 64]);
    expect(progressSamples(100)).toEqual([4, 16, 64, 100]);
  });
});
