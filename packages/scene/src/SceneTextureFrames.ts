/** Seconds per frame of a `SceneTextureFrames` without `frameTime`: one Minecraft tick. */
export const DEFAULT_TEXTURE_FRAME_TIME = 0.05;

/**
 * A texture that is a vertical strip of `count` equal frames, frame 0 at the top. Each frame is `width` ×
 * `height / count` pixels of the texture (fractional when the source rounded the count). UVs of every face using the
 * texture are normalised so frame 0 spans v in [0, 1 / count]; frame k is the same UV plus k / count in v. A consumer
 * that ignores `frames` therefore draws frame 0, the still.
 */
export interface SceneTextureFrames {
  /** Integer, 2 ≤ `count` ≤ the texture's pixel `height` (a frame is at least one pixel tall). */
  readonly count: number;
  /** Seconds each played frame shows, finite and above 0; absent: `DEFAULT_TEXTURE_FRAME_TIME`. */
  readonly frameTime?: number;
  /** Frame indices in play order, each an integer in [0, `count`), non-empty; absent: 0 … count − 1, looping. */
  readonly order?: readonly number[];
  /** Cross-fade each played frame into the next; absent: false. */
  readonly interpolate?: boolean;
}
