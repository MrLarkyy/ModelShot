import type { RendererWarningCode } from '@modelshot/renderer-rt';

export type PathTracerWarningCode = RendererWarningCode | 'DEGENERATE_TRIANGLES';

/**
 * Something the path tracer rendered around: a texture replaced by the placeholder (the realtime renderer's codes,
 * with `texture`), or triangles left out because a position, normal or UV is not finite or the triangle has no area
 * (`DEGENERATE_TRIANGLES`, with `count`).
 */
export interface PathTracerWarning {
  readonly code: PathTracerWarningCode;
  readonly message: string;
  /** Index into `SceneDocument.textures` for a texture warning. */
  readonly texture?: number;
  /** Triangles skipped, for `DEGENERATE_TRIANGLES`. */
  readonly count?: number;
}
