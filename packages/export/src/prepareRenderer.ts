import type { SetSceneOptions } from '@modelshot/pathtracer';
import type { SceneDocument } from '@modelshot/scene';
import { ExportError } from './ExportError';
import type { FrameRenderer } from './FrameRenderer';
import { throwIfCancelled } from './throwIfCancelled';

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
