import type { LookPreset } from '@modelshot/looks';
import type { CanvasCssSize } from '@modelshot/renderer-rt';
import type { PathTracer, PathTracerWarning } from '@modelshot/pathtracer';
import type { SceneCamera, SceneDocument } from '@modelshot/scene';
import { loadPathTracer } from '../lazyPathTracer';
import { RENDER_SEED, type RenderSettingsValues } from './RenderSettings';

const SLICE_MS = 8;
// A step of the denoiser's guide is cheap to submit and costly to run, so a slice by submit time alone would queue the
// whole guide into one frame: while guiding, a slice is one step of this many samples' worth of GPU work.
const GUIDE_SLICE_SAMPLES = 4;

export interface RenderSessionHost {
  readonly document: () => SceneDocument | null;
  readonly camera: () => SceneCamera;
  readonly look: () => LookPreset;
  readonly size: () => CanvasCssSize | null;
  readonly settings: () => RenderSettingsValues;
  readonly onProgress: (samplesDone: number, target: number) => void;
  readonly onDone: (warnings: readonly PathTracerWarning[]) => void;
  readonly onCancelled: () => void;
  readonly onError: (error: unknown) => void;
}

// One path tracer for Render and Export: one WebGL context and one BVH. Scene, camera, size and look are applied again
// before every start, so whichever ran last leaves nothing behind that the next one trusts.
interface Run {
  cancelled: boolean;
  pump: { readonly tracer: PathTracer; readonly resolve: () => void } | null;
}

export class RenderSession {
  private tracerPromise: Promise<PathTracer> | null = null;
  private active: Run | null = null;
  // The previous run's tracer work (creation, scene upload): a cancelled run abandons it but cannot stop it, so the
  // next run waits instead of overlapping on the one tracer.
  private settled: Promise<void> = Promise.resolve();
  private disposed = false;
  private currentTracer: PathTracer | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: RenderSessionHost,
  ) {}

  get busy(): boolean {
    return this.active !== null;
  }

  /** The shared tracer, created on first use. Rejects with `PathTracerError` where the GPU cannot trace. */
  tracer(): Promise<PathTracer> {
    const created = (this.tracerPromise ??= loadPathTracer().then(({ PathTracer }) => {
      const tracer = PathTracer.create(this.canvas, { look: this.host.look(), preserveDrawingBuffer: true });
      this.currentTracer = tracer;
      return tracer;
    }));
    created.catch(() => {
      if (this.tracerPromise === created) this.tracerPromise = null;
    });
    return created;
  }

  /** The tracer if it exists already, for the look to follow. */
  existingTracer(): PathTracer | null {
    return this.currentTracer;
  }

  async render(): Promise<void> {
    const doc = this.host.document();
    const size = this.host.size();
    if (this.active || !doc || !size || this.disposed) return;
    const run: Run = { cancelled: false, pump: null };
    this.active = run;
    const previous = this.settled;
    const prepared = (async () => {
      await previous;
      if (run.cancelled) return null;
      const tracer = await this.tracer();
      if (run.cancelled) return null;
      tracer.setLook(this.host.look());
      tracer.resize(size);
      return { tracer, scene: await tracer.setScene(doc) };
    })();
    this.settled = prepared.then(
      () => undefined,
      () => undefined,
    );
    try {
      const result = await prepared;
      if (run.cancelled || !result) return;
      const { tracer, scene } = result;
      if (!scene.applied) {
        this.active = null;
        this.host.onCancelled();
        return;
      }
      tracer.setCamera(this.host.camera());
      const settings = this.host.settings();
      tracer.start({
        seed: RENDER_SEED,
        samples: settings.samples,
        supersample: settings.supersample,
        denoise: settings.denoise,
      });
      await this.pump(run, tracer, scene.warnings);
    } catch (error) {
      if (run.cancelled) return;
      this.active = null;
      this.host.onError(error);
    }
  }

  // Stops in every phase at once: the next animation frame can be held back for long while the GPU drains the queued
  // steps, and scene preparation cannot be interrupted, so the run is abandoned instead.
  cancel(): void {
    const run = this.active;
    if (!run) return;
    run.cancelled = true;
    this.active = null;
    run.pump?.tracer.cancel();
    this.host.onCancelled();
    run.pump?.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    void this.tracerPromise?.then((tracer) => tracer.dispose()).catch(() => undefined);
  }

  private pump(run: Run, tracer: PathTracer, warnings: readonly PathTracerWarning[]): Promise<void> {
    return new Promise<void>((resolve) => {
      run.pump = { tracer, resolve };
      const slice = (): void => {
        if (run.cancelled) return;
        try {
          if (tracer.contextLost) throw new Error('The graphics context was lost during the render.');
          const started = performance.now();
          do {
            const guiding = tracer.guiding;
            const drawn = tracer.step(guiding ? GUIDE_SLICE_SAMPLES : 1);
            if (guiding || drawn === 0) break;
          } while (performance.now() - started < SLICE_MS);
          const { samplesDone, targetSamples } = tracer.progress;
          this.host.onProgress(samplesDone, targetSamples);
          if (samplesDone >= targetSamples || !tracer.running) {
            this.active = null;
            this.host.onDone(warnings);
            resolve();
            return;
          }
        } catch (error) {
          this.active = null;
          this.host.onError(error);
          resolve();
          return;
        }
        requestAnimationFrame(slice);
      };
      requestAnimationFrame(slice);
    });
  }
}
