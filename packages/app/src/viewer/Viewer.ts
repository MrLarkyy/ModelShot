import type { LightBaker } from '@modelshot/pathtracer';
import { DEFAULT_LOOK, type LookPreset } from '@modelshot/looks';
import {
  OrbitController,
  RealtimeRenderer,
  bindOrbitInput,
  observeCanvasSize,
  type CanvasCssSize,
  type SetSceneResult,
} from '@modelshot/renderer-rt';
import { sceneBounds, type SceneBounds, type SceneCamera, type SceneDocument } from '@modelshot/scene';
import { loadPathTracer } from '../lazyPathTracer';

export const DEFAULT_YAW_DEG = 210;
export const DEFAULT_PITCH_DEG = 20;
const BAKE_SAMPLES = 64;

export interface ViewerOptions {
  /** Short messages about the lighting bake and the context. */
  readonly onStatus: (message: string) => void;
  /** The canvas was resized (CSS size and pixel ratio); the render canvas follows. */
  readonly onResize: (size: CanvasCssSize) => void;
  /** The camera or scene shown changed, so a finished render no longer matches. */
  readonly onChange: () => void;
  readonly preserveDrawingBuffer?: boolean;
}

// The realtime preview of the app: renderer, orbit camera and input, light bake. No panel DOM, so the embed reuses it.
export class Viewer {
  readonly orbit = new OrbitController({ yawDeg: DEFAULT_YAW_DEG, pitchDeg: DEFAULT_PITCH_DEG });
  private doc: SceneDocument | null = null;
  private bounds: SceneBounds | null = null;
  private look: LookPreset = DEFAULT_LOOK;
  private baker: Promise<LightBaker | null> | null = null;
  private bakeGeneration = 0;
  private frame = 0;
  private lastTime = 0;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly renderer: RealtimeRenderer,
    private readonly options: ViewerOptions,
  ) {
    this.cleanups.push(
      bindOrbitInput(canvas, this.orbit, { onChange: () => this.changed() }),
      observeCanvasSize(canvas, (size) => {
        const { width, height } = this.renderer.resize(size);
        this.orbit.setAspect(width / height);
        this.options.onResize(size);
        this.requestRender();
      }),
      renderer.onContextRestored(() => {
        this.options.onStatus('The graphics context was restored.');
        this.requestRender();
      }),
    );
  }

  /** Throws `RendererError` `WEBGL2_UNAVAILABLE` where there is no WebGL2. */
  static create(canvas: HTMLCanvasElement, options: ViewerOptions): Viewer {
    const renderer = RealtimeRenderer.create(canvas, { preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
    return new Viewer(canvas, renderer, options);
  }

  get document(): SceneDocument | null {
    return this.doc;
  }

  get currentLook(): LookPreset {
    return this.look;
  }

  /**
   * Shows `doc`. `reframe` takes its bounds as the camera's reference and frames them from the default angles; without
   * it the camera stays (a visibility change). The renderer keeps the previous scene when this rejects.
   */
  async setDocument(doc: SceneDocument, reframe: boolean): Promise<SetSceneResult> {
    const result = await this.renderer.setScene(doc);
    if (!result.applied || this.disposed) return result;
    this.doc = doc;
    if (reframe) {
      this.bounds = sceneBounds(doc);
      this.orbit.reset(this.bounds);
    }
    this.changed();
    void this.bake();
    return result;
  }

  /** Frames the model again from the current angles. */
  frameModel(): void {
    this.orbit.frame();
    this.changed();
  }

  /** The default view of the model (the initial angles, framed to fit). */
  resetView(): void {
    this.orbit.reset(this.bounds);
    this.changed();
  }

  /** Draws with `look` and bakes the light under it. */
  setLook(look: LookPreset): void {
    this.look = look;
    this.renderer.setLook(look);
    this.changed();
    void this.bake();
  }

  /** Called after something moved the orbit controller from outside (a panel, a shortcut, restored state). */
  changed(): void {
    this.options.onChange();
    this.requestRender();
  }

  requestRender(): void {
    if (this.frame !== 0 || this.disposed) return;
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  /** The camera at the end of any easing: what a render or an export frames. */
  settledCamera(): SceneCamera {
    this.orbit.update(1e9);
    return this.orbit.camera();
  }

  /** Draws a frame now (tests read the canvas after it). */
  renderNow(): void {
    this.orbit.update(1e9);
    this.renderer.setCamera(this.orbit.camera());
    this.renderer.render();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.bakeGeneration++;
    for (const cleanup of this.cleanups) cleanup();
    void this.baker?.then((baker) => baker?.dispose());
    this.renderer.dispose();
  }

  private tick(time: number): void {
    this.frame = 0;
    if (this.disposed) return;
    const dt = this.lastTime === 0 ? 16 : Math.min(100, time - this.lastTime);
    this.lastTime = time;
    const moving = this.orbit.update(dt);
    this.renderer.setCamera(this.orbit.camera());
    this.renderer.render();
    if (moving) this.options.onChange();
    if (moving || this.renderer.needsRender) this.requestRender();
    else this.lastTime = 0;
  }

  private lightBaker(): Promise<LightBaker | null> {
    this.baker ??= loadPathTracer()
      .then(({ LightBaker }) => LightBaker.create())
      .catch((error: unknown) => {
        this.options.onStatus(
          `The preview shows unbaked light: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
    return this.baker;
  }

  private async bake(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const generation = ++this.bakeGeneration;
    const look = this.look;
    const baker = await this.lightBaker();
    if (!baker || generation !== this.bakeGeneration || this.disposed) return;
    this.options.onStatus('Lighting the preview…');
    try {
      const result = await baker.bake(doc, {
        samples: BAKE_SAMPLES,
        look,
        onProgress: (progress) => {
          if (generation === this.bakeGeneration && this.renderer.setLighting(progress.lighting)) this.requestRender();
        },
      });
      if (!result.applied || generation !== this.bakeGeneration) return;
      if (result.lighting && this.renderer.setLighting(result.lighting)) this.requestRender();
      this.options.onStatus('Preview lit.');
    } catch (error) {
      if (generation === this.bakeGeneration) {
        this.options.onStatus(
          `The preview shows unbaked light: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
