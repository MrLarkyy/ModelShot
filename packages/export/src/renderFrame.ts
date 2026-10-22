import type { RenderedImage, RenderRequest, SetSceneOptions } from '@modelshot/pathtracer';
import type { SceneDocument } from '@modelshot/scene';
import { ExportError } from './ExportError';
import type { FrameRenderer } from './FrameRenderer';
import { yieldToEventLoop } from './yieldToEventLoop';

/** Throws `CANCELLED` (and stops the renderer) once `signal` aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined, renderer?: FrameRenderer): void {
  if (!signal?.aborted) return;
  renderer?.cancel();
  throw new ExportError('CANCELLED', 'the export was cancelled');
}

function contextLost(): ExportError {
  return new ExportError('CONTEXT_LOST', 'the WebGL context was lost during the export; nothing was encoded from it');
}

/**
 * Renders `request` to its last sample, one sample per step, yielding to the event loop between steps so the page
 * stays responsive, and reads the image. `onSamples` gets the samples done after each step. An abort cancels the
 * renderer before its next step and rejects with `CANCELLED`; a context lost (or lost and restored, which restarts the
 * request) rejects with `CONTEXT_LOST`, so a blank frame is never taken for a finished one.
 */
export async function renderFrame(
  renderer: FrameRenderer,
  request: RenderRequest,
  signal: AbortSignal | undefined,
  onSamples: (samplesDone: number) => void,
): Promise<RenderedImage> {
  throwIfCancelled(signal, renderer);
  if (renderer.contextLost) throw contextLost();
  renderer.start(request);
  let done = 0;
  for (;;) {
    throwIfCancelled(signal, renderer);
    if (renderer.contextLost) throw contextLost();
    const drawn = renderer.step(1);
    if (renderer.samplesDone < done) throw contextLost();
    done = renderer.samplesDone;
    onSamples(done);
    if (drawn === 0 || done >= request.samples) break;
    await yieldToEventLoop();
  }
  if (renderer.contextLost) throw contextLost();
  if (done < request.samples) {
    throw new ExportError(
      'CANCELLED',
      `the renderer stopped after ${done} of ${request.samples} samples (cancelled or restarted from outside)`,
    );
  }
  const image = renderer.readImage();
  if (!image || renderer.contextLost) throw contextLost();
  return image;
}

/** Sizes the renderer to exactly `width` × `height` device pixels; a GPU that cannot throws `LIMIT_EXCEEDED`. */
export function sizeRenderer(renderer: FrameRenderer, width: number, height: number): void {
  const size = renderer.resize({ cssWidth: width, cssHeight: height, devicePixelRatio: 1 });
  if (size.width !== width || size.height !== height) {
    throw new ExportError(
      'LIMIT_EXCEEDED',
      `this GPU renders ${size.width} × ${size.height} at most for ${width} × ${height}`,
      'width',
    );
  }
}

/** `setScene` of `doc`; superseded by another call meanwhile, or aborted, it rejects with `CANCELLED`. */
export async function showScene(
  renderer: FrameRenderer,
  doc: SceneDocument,
  options: SetSceneOptions,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfCancelled(signal, renderer);
  const result = await renderer.setScene(doc, options);
  throwIfCancelled(signal, renderer);
  if (!result.applied) throw new ExportError('CANCELLED', "another scene replaced the export's in the renderer");
}
