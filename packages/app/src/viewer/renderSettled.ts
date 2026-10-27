/** What `renderSettled` needs of a `RealtimeRenderer`. */
export interface SettlingRenderer {
  render(): void;
  readonly needsRender: boolean;
}

/** More calls than any frame needs: an exact-key frame settles in 4 (its sample history), baked light in a few. */
export const MAX_SETTLE_RENDERS = 8;

/**
 * Renders until `renderer` has nothing left to draw, at most `MAX_SETTLE_RENDERS` times: the finished frame a capture
 * reads (a still exact-key frame shows the mean of all its samples only after several calls).
 */
export function renderSettled(renderer: SettlingRenderer): void {
  renderer.render();
  for (let i = 1; i < MAX_SETTLE_RENDERS && renderer.needsRender; i++) renderer.render();
}
