import type { RenderedImage, RenderRequest } from '@modelshot/pathtracer';
import { ExportError } from './ExportError';
import type { FrameRenderer } from './FrameRenderer';
import { throwIfCancelled } from './throwIfCancelled';
import { yieldToEventLoop } from './yieldToEventLoop';

function contextLost(): ExportError {
  return new ExportError('CONTEXT_LOST', 'the WebGL context was lost during the export; nothing was encoded from it');
}

/**
 * Renders `request` to its last sample, one sample per step (a guide step draws none), yielding to the event loop
 * between steps so the page stays responsive, and reads the image. `onSamples` gets the samples done after each step. An abort cancels the
 * renderer before its next step and rejects with `CANCELLED`; a context lost (or lost and restored after a sample was
 * drawn, which restarts the request) rejects with `CONTEXT_LOST`, so a blank frame is never taken for a finished one.
 * A denoised request first draws its guide over steps that report 0 samples while the renderer is `guiding`; a restore
 * inside the guide shows no sample count going back, so the frame goes on: the restore redraws the whole guide and the
 * bytes are the uninterrupted ones.
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
    if ((drawn === 0 && !renderer.guiding) || done >= request.samples) break;
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
