/** What `renderSettled` needs of a `RealtimeRenderer`. */
export interface SettlingRenderer {
  render(): void;
  advanceLighting(): boolean;
  readonly needsRender: boolean;
}

/** More calls than a still exact-key frame needs (its 4 sample passes), after any baked light is uploaded. */
export const MAX_SETTLE_RENDERS = 8;

/**
 * Finishes any pending baked-light upload (a full one takes many calls, and its completion restarts the sample
 * history), then renders until `renderer` has nothing left to draw, at most `MAX_SETTLE_RENDERS` times: the finished
 * frame a capture reads (a still exact-key frame shows the mean of all its samples only after several calls).
 */
export function renderSettled(renderer: SettlingRenderer): void {
  while (renderer.advanceLighting());
  renderer.render();
  for (let i = 1; i < MAX_SETTLE_RENDERS && renderer.needsRender; i++) renderer.render();
}
