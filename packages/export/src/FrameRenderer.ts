import type { RenderedImage, RenderRequest, SetSceneOptions } from '@modelshot/pathtracer';
import type { SceneCamera, SceneDocument } from '@modelshot/scene';

/**
 * What an export drives: `PathTracer` of @modelshot/pathtracer has this shape. Give an export a tracer of its own (its
 * canvas need not be shown): the export resizes it, replaces its scene, camera and request, and leaves them so.
 */
export interface FrameRenderer {
  readonly width: number;
  readonly height: number;
  readonly samplesDone: number;
  /** `step()` may return 0 although the request is unfinished: a denoiser guide is still being drawn. */
  readonly guiding: boolean;
  /** Width of the traced image: `width` times the supersampling scale the current request runs at. */
  readonly accumulationWidth: number;
  readonly contextLost: boolean;
  setScene(doc: SceneDocument, options?: SetSceneOptions): Promise<{ readonly applied: boolean }>;
  setCamera(camera: SceneCamera): void;
  resize(size: { cssWidth: number; cssHeight: number; devicePixelRatio: number }): { width: number; height: number };
  start(request: RenderRequest): void;
  step(maxSamples?: number): number;
  cancel(): void;
  readImage(): RenderedImage | null;
}
