import type { SceneDocument } from '@modelshot/scene';
import { checkExportOptions } from './checkExportOptions';
import { ExportError } from './ExportError';
import type { ExportResult, ExportRunOptions, StillExportOptions } from './ExportOptions';
import type { FrameRenderer } from './FrameRenderer';
import { ProgressReporter } from './ProgressReporter';
import { renderFrame, showScene, sizeRenderer, throwIfCancelled } from './renderFrame';

/**
 * Renders `doc` once with `renderer` and encodes a PNG: exactly the bytes of `readImage()`, with alpha for a
 * transparent request. The options are checked first (`checkExportOptions`: `ExportError` `INVALID_OPTION` or
 * `LIMIT_EXCEEDED` before any sample); `CANCELLED` on abort, `CONTEXT_LOST` when the context went. A renderer error
 * (`PathTracerError` of `setScene`) passes through. Everything runs in the page; the Blob is the caller's.
 */
export async function exportStill(
  renderer: FrameRenderer,
  doc: SceneDocument,
  options: StillExportOptions,
  run: ExportRunOptions = {},
): Promise<ExportResult> {
  const checked = checkExportOptions(doc, options);
  if (checked.kind !== 'still') {
    throw new ExportError('INVALID_OPTION', 'kind must be still for exportStill (exportClip renders clips)', 'kind');
  }
  const { signal, onProgress } = run;
  throwIfCancelled(signal);
  const progress = new ProgressReporter(1, checked.samples, onProgress);
  sizeRenderer(renderer, checked.width, checked.height);
  await showScene(renderer, doc, checked.scene, signal);
  renderer.setCamera(checked.camera);
  const image = await renderFrame(
    renderer,
    {
      seed: checked.seed,
      samples: checked.samples,
      supersample: checked.supersample,
      denoise: checked.denoise,
      transparent: checked.transparent,
    },
    signal,
    (samplesDone) => progress.render(0, samplesDone),
  );
  const { encodePng } = await import('./png/encodePng');
  const blob = await encodePng(image);
  throwIfCancelled(signal);
  progress.encoded(0);
  progress.finished();
  return {
    blob,
    format: 'png',
    mimeType: 'image/png',
    extension: 'png',
    width: checked.width,
    height: checked.height,
    frames: 1,
    warnings: [],
  };
}
