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
export class RenderSession {
  private tracerPromise: Promise<PathTracer> | null = null;
  private running = false;
  private cancelRequested = false;
  private disposed = false;
  private currentTracer: PathTracer | null = null;
  private pumping: { readonly tracer: PathTracer; readonly resolve: () => void } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: RenderSessionHost,
  ) {}

  get busy(): boolean {
    return this.running;
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
    if (this.running || !doc || !size || this.disposed) return;
    this.running = true;
    this.cancelRequested = false;
    try {
      const tracer = await this.tracer();
      tracer.setLook(this.host.look());
      tracer.resize(size);
      const scene = await tracer.setScene(doc);
      if (!scene.applied || this.cancelRequested) {
        this.finishCancelled();
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
      await this.pump(tracer, scene.warnings);
    } catch (error) {
      this.running = false;
      this.host.onError(error);
    }
  }

  cancel(): void {
    if (!this.running) return;
    this.cancelRequested = true;
    // Stopping at once: the next animation frame can be held back for long while the GPU drains the queued steps.
    const pumping = this.pumping;
    if (!pumping) return;
    this.pumping = null;
    pumping.tracer.cancel();
    this.finishCancelled();
    pumping.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelRequested = true;
    void this.tracerPromise?.then((tracer) => tracer.dispose()).catch(() => undefined);
  }

  private finishCancelled(): void {
    this.running = false;
    this.host.onCancelled();
  }

  private pump(tracer: PathTracer, warnings: readonly PathTracerWarning[]): Promise<void> {
    return new Promise<void>((resolve) => {
      const mine = { tracer, resolve };
      this.pumping = mine;
      const end = (): void => {
        if (this.pumping === mine) this.pumping = null;
      };
      const slice = (): void => {
        if (this.pumping !== mine) return;
        if (this.cancelRequested || this.disposed) {
          end();
          tracer.cancel();
          this.finishCancelled();
          resolve();
          return;
        }
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
            end();
            this.running = false;
            this.host.onDone(warnings);
            resolve();
            return;
          }
        } catch (error) {
          end();
          this.running = false;
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
