import type { ExportWarning } from './ExportOptions';
import type { FrameRenderer } from './FrameRenderer';

/**
 * A `SUPERSAMPLE_LOWERED` warning when the renderer traces the request at a smaller scale than `requested` (the path
 * tracer lowers it to fit the GPU's target size and `MAX_SUPERSAMPLED_PIXELS`), else `null`. Read after `start`.
 */
export function supersampleWarning(renderer: FrameRenderer, requested: number): ExportWarning | null {
  const used = Math.round(renderer.accumulationWidth / renderer.width);
  if (used >= requested) return null;
  return {
    code: 'SUPERSAMPLE_LOWERED',
    message: `Supersampling ${requested} × ${requested} does not fit this GPU at ${renderer.width} × ${renderer.height}, so the export was traced at ${used} × ${used}.`,
  };
}
