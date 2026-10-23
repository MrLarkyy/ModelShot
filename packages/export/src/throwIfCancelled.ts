import { ExportError } from './ExportError';
import type { FrameRenderer } from './FrameRenderer';

/** Throws `CANCELLED` (and stops the renderer) once `signal` aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined, renderer?: FrameRenderer): void {
  if (!signal?.aborted) return;
  renderer?.cancel();
  throw new ExportError('CANCELLED', 'the export was cancelled');
}
