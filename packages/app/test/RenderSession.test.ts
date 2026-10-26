import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneCamera, SceneDocument } from '@modelshot/scene';
import type { LookPreset } from '@modelshot/looks';
import { RenderSession, type RenderSessionHost } from '../src/render/RenderSession';

class FakeTracer {
  samplesDone = 0;
  targetSamples = 0;
  readonly contextLost = false;
  readonly stepCalls: number[] = [];
  private guideLeft = 0;

  constructor(private readonly guideSteps: number) {}

  get guiding(): boolean {
    return this.targetSamples > 0 && this.samplesDone < this.targetSamples && this.samplesDone === 0;
  }

  get running(): boolean {
    return this.samplesDone < this.targetSamples;
  }

  get progress(): { samplesDone: number; targetSamples: number } {
    return { samplesDone: this.samplesDone, targetSamples: this.targetSamples };
  }

  setLook(): void {}
  resize(): void {}
  setCamera(): void {}
  cancel(): void {}
  setScene(): Promise<{ applied: boolean; warnings: never[] }> {
    return Promise.resolve({ applied: true, warnings: [] });
  }

  start(request: { samples: number }): void {
    this.targetSamples = request.samples;
    this.samplesDone = 0;
    this.guideLeft = this.guideSteps;
  }

  step(max: number): number {
    this.stepCalls.push(max);
    if (this.guideLeft > 0) {
      this.guideLeft--;
      return 0;
    }
    const drawn = Math.min(max, this.targetSamples - this.samplesDone);
    this.samplesDone += drawn;
    return drawn;
  }
}

let tracer = new FakeTracer(0);
vi.mock('../src/lazyPathTracer', () => ({
  loadPathTracer: () => Promise.resolve({ PathTracer: { create: () => tracer } }),
}));

const doc = {} as SceneDocument;
const host = (events: string[]): RenderSessionHost => ({
  document: () => doc,
  camera: () => ({}) as SceneCamera,
  look: () => ({}) as LookPreset,
  size: () => ({ cssWidth: 8, cssHeight: 8, devicePixelRatio: 1 }),
  settings: () => ({ samples: 3, supersample: 2, denoise: true }),
  onProgress: (done, target) => events.push(`progress ${done}/${target}`),
  onDone: () => events.push('done'),
  onCancelled: () => events.push('cancelled'),
  onError: (error) => events.push(`error ${String(error)}`),
});

afterEach(() => vi.unstubAllGlobals());

describe('RenderSession', () => {
  it('draws a denoised request through its guide phase, one bounded step per animation frame', async () => {
    tracer = new FakeTracer(3);
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    const events: string[] = [];
    const session = new RenderSession({} as HTMLCanvasElement, host(events));
    const rendered = session.render();
    let slices = 0;
    while (!events.includes('done')) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const next = frames.shift();
      if (!next) continue;
      slices++;
      next();
      expect(slices).toBeLessThan(20);
    }
    await rendered;
    // Three guide steps and the one that draws the samples, one slice each: the guide never lands in one frame.
    expect(slices).toBe(4);
    expect(tracer.stepCalls).toEqual([4, 4, 4, 4]);
    expect(events.at(-2)).toBe('progress 3/3');
    expect(events.at(-1)).toBe('done');
  });

  it('goes back to one-sample steps once the first sample is drawn', async () => {
    tracer = new FakeTracer(0);
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    const events: string[] = [];
    const session = new RenderSession({} as HTMLCanvasElement, {
      ...host(events),
      settings: () => ({ samples: 6, supersample: 1, denoise: false }),
    });
    const rendered = session.render();
    while (!events.includes('done')) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      frames.shift()?.();
    }
    await rendered;
    // The fake's `guiding` holds until the first sample: that one step takes the guide budget, then single samples.
    expect(tracer.stepCalls[0]).toBe(4);
    expect(tracer.stepCalls.slice(1).every((k) => k === 1)).toBe(true);
  });
});
