import { FRAME_RATE } from './TimeScale';

export type ScrubberCommand =
  | { readonly kind: 'frames'; readonly frames: number }
  | { readonly kind: 'keyframe'; readonly direction: 1 | -1 }
  | { readonly kind: 'start' }
  | { readonly kind: 'end' };

export interface ScrubberKeyLike {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

/** Frames one Shift+arrow moves. */
export const SHIFT_FRAMES = 10;

/** The keys of the focused scrubber, for the help dialog: one row each. */
export const SCRUBBER_KEYS: readonly { readonly keys: string; readonly label: string }[] = [
  { keys: '← / →', label: `One frame (1/${FRAME_RATE} s) back or forward` },
  { keys: 'Shift+← / →', label: `${SHIFT_FRAMES} frames back or forward` },
  { keys: 'PageUp / PageDown', label: 'Previous or next keyframe' },
  { keys: 'Home / End', label: 'Start or end of the clip' },
];

/** What a key press on the focused scrubber does, or null for a key it leaves alone. */
export function scrubberCommand(event: ScrubberKeyLike): ScrubberCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const step = event.shiftKey === true ? SHIFT_FRAMES : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { kind: 'frames', frames: -step };
    case 'ArrowRight':
      return { kind: 'frames', frames: step };
    case 'PageUp':
      return { kind: 'keyframe', direction: -1 };
    case 'PageDown':
      return { kind: 'keyframe', direction: 1 };
    case 'Home':
      return { kind: 'start' };
    case 'End':
      return { kind: 'end' };
    default:
      return null;
  }
}
