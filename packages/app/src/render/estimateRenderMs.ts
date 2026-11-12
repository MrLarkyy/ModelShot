import { formatElapsed } from './renderInfo';

/** One finished render: what it drew and how long it took. */
export interface RenderTiming {
  readonly samples: number;
  /** Pixels traced, the supersampling included. */
  readonly pixels: number;
  readonly ms: number;
}

/** The time a render of `samples` over `pixels` takes at the speed of `last`, or null before any render finished. */
export function estimateRenderMs(
  last: RenderTiming | null,
  next: { readonly samples: number; readonly pixels: number },
): number | null {
  if (!last || !(last.samples > 0) || !(last.pixels > 0) || !(last.ms > 0)) return null;
  if (!(next.samples > 0) || !(next.pixels > 0)) return null;
  return last.ms * (next.samples / last.samples) * (next.pixels / last.pixels);
}

/** "About 0:12, estimated from your last render", or the reason there is none yet. */
export function estimateText(estimate: number | null): string {
  return estimate === null
    ? 'No estimate before the first render.'
    : `About ${formatElapsed(estimate)}, estimated from your last render.`;
}
