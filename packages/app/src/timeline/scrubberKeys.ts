import { SHIFT_FRAMES } from './scrubberKeyList';

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
