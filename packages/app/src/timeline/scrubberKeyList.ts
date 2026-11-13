import type { ListedKeys } from '../shortcuts/listedKeys';

/** Frames per second of the keyframe-step grid: the scene format has no frame rate, 24 is Blockbench's default. */
export const FRAME_RATE = 24;

/** Frames one Shift+arrow moves. */
export const SHIFT_FRAMES = 10;

/** The keys of the focused scrubber, for the help dialog: one row each. Free of imports, so the dialog stays light. */
export const SCRUBBER_KEYS: readonly ListedKeys[] = [
  { keys: '← / →', label: `One frame (1/${FRAME_RATE} s) back or forward` },
  { keys: 'Shift+← / Shift+→', label: `${SHIFT_FRAMES} frames back or forward` },
  { keys: 'PageUp / PageDown', label: 'Previous or next keyframe' },
  { keys: 'Home / End', label: 'Start or end of the clip' },
];
