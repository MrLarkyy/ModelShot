import type { SceneDocument } from '@modelshot/scene';
import { checkExportOptions } from './checkExportOptions';
import type { ClipEncoder } from './ClipEncoder';
import { createClipEncoder } from './createClipEncoder';
import { ExportError } from './ExportError';
import type { ClipExportOptions, ClipFormat, ExportResult, ExportRunOptions, ExportWarning } from './ExportOptions';
import type { FrameRenderer } from './FrameRenderer';
import { framePose } from './framePose';
import { planFrames } from './planFrames';
import { showScene, sizeRenderer } from './prepareRenderer';
import { ProgressReporter } from './ProgressReporter';
import { renderFrame } from './renderFrame';
import { selectFormat } from './selectFormat';
import { supersampleWarning } from './supersampleWarning';
import { throwIfCancelled } from './throwIfCancelled';

const FILE_TYPES: Readonly<Record<ClipFormat, { mimeType: string; extension: string }>> = {
  apng: { mimeType: 'image/apng', extension: 'png' },
  gif: { mimeType: 'image/gif', extension: 'gif' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
  webm: { mimeType: 'video/webm', extension: 'webm' },
  mp4: { mimeType: 'video/mp4', extension: 'mp4' },
};

/**
 * Renders a turntable or an animation of `doc` with `renderer` and encodes it frame by frame (only compressed output
 * is kept). The options are checked before anything else (`checkExportOptions`); the format is probed and falls back
 * along its chain (`selectFormat`: mp4 → webm → apng, webm → apng, webp → apng) with a `FORMAT_FALLBACK` warning;
 * video is opaque, so a transparent request renders opaque there with `ALPHA_DROPPED`. Frames come from `planFrames`
 * and share one seed; an animation's poses all stand on one shadow catcher (the union of their bounds) and share the
 * textures and materials of `doc`, so a path tracer keeps the images it holds and only the pose's geometry is built. A supersample
 * the GPU cannot trace adds `SUPERSAMPLE_LOWERED`. Rejects with `ExportError` `CANCELLED` on abort (the tracer stops within one step),
 * `CONTEXT_LOST`, `ENCODER_FAILED`, `LIMIT_EXCEEDED` (the encoded file over `MAX_OUTPUT_BYTES`) or
 * `UNSUPPORTED_FORMAT`; a renderer error (`PathTracerError` of `setScene`) passes through. Nothing leaves the page.
 */
export async function exportClip(
  renderer: FrameRenderer,
  doc: SceneDocument,
  options: ClipExportOptions,
  run: ExportRunOptions = {},
): Promise<ExportResult> {
  const checked = checkExportOptions(doc, options);
  if (checked.kind === 'still') {
    throw new ExportError('INVALID_OPTION', 'kind must be turntable or animation for exportClip', 'kind');
  }
  const { signal, onProgress } = run;
  throwIfCancelled(signal);
  const { width, height, fps } = checked;
  const { probeFormats } = await import('./probeFormats');
  const probed = await probeFormats(checked.format, width, height, fps);
  throwIfCancelled(signal);
  const selection = selectFormat(checked.format, probed.availability);
  const format = selection.format;
  const warnings: ExportWarning[] = [...selection.warnings];
  const video = format === 'webm' || format === 'mp4';
  if (checked.transparent && video) {
    warnings.push({
      code: 'ALPHA_DROPPED',
      message: `${format === 'mp4' ? 'MP4' : 'WebM'} video has no alpha here, so the clip was rendered opaque, over the backdrop.`,
    });
  }
  const { frames, catcherBounds } = await planFrames(doc, checked, signal);
  sizeRenderer(renderer, width, height);
  const sceneOptions = catcherBounds ? { ...checked.scene, catcherBounds } : checked.scene;
  const progress = new ProgressReporter(frames.length, checked.samples, onProgress);
  const request = {
    seed: checked.seed,
    samples: checked.samples,
    supersample: checked.supersample,
    denoise: checked.denoise,
    transparent: checked.transparent && !video,
  };
  let encoder: ClipEncoder | null = null;
  try {
    encoder = await createClipEncoder(
      format,
      { width, height, fps, frames: frames.length },
      video ? probed.video[format] : undefined,
    );
    for (const frame of frames) {
      // Each pose is built right before it is shown; a still document is shown once.
      if (checked.kind === 'animation') {
        await showScene(renderer, framePose(doc, checked, frame.time), sceneOptions, signal);
      } else if (frame.index === 0) {
        await showScene(renderer, doc, sceneOptions, signal);
      }
      renderer.setCamera(frame.camera);
      const image = await renderFrame(renderer, request, signal, (samplesDone) =>
        progress.render(frame.index, samplesDone),
      );
      if (frame.index === 0) {
        const lowered = supersampleWarning(renderer, checked.supersample);
        if (lowered) warnings.push(lowered);
      }
      await encoder.addFrame(image);
      throwIfCancelled(signal, renderer);
      progress.encoded(frame.index);
    }
    const blob = await encoder.finish();
    throwIfCancelled(signal);
    progress.finished();
    return { blob, format, ...FILE_TYPES[format], width, height, frames: frames.length, warnings };
  } catch (error) {
    encoder?.close();
    throw error;
  }
}
