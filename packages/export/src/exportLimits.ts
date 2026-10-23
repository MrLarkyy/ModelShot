/** Largest width or height of an export. */
export const MAX_EXPORT_SIDE = 4096;
/** Most pixels of one frame. */
export const MAX_EXPORT_PIXELS = 4096 * 4096;
/** Most frames of a clip. */
export const MAX_CLIP_FRAMES = 1200;
/** Longest clip, in seconds of playback. */
export const MAX_CLIP_SECONDS = 60;
/** Highest frame rate of a clip (integer frames per second). */
export const MAX_CLIP_FPS = 60;
/** Most raw RGBA bytes of all frames of a clip together (width × height × 4 × frames), checked before any sample. */
export const MAX_CLIP_RAW_BYTES = 2 * 1024 ** 3;
/** Largest encoded file, checked while encoding. */
export const MAX_OUTPUT_BYTES = 512 * 1024 ** 2;
