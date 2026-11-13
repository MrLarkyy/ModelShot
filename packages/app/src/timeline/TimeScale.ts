/** Frames per second of the keyframe-step grid: the scene format has no frame rate, 24 is Blockbench's default. */
export const FRAME_RATE = 24;

/** Half the width of the scrubber's thumb in px: its centre cannot leave the track by more than this. */
export const THUMB_INSET_PX = 6;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 16;

export interface Tick {
  readonly time: number;
  readonly x: number;
  readonly label: string;
}

const STEP_BASES = [1, 2, 5] as const;

export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : MIN_ZOOM;
}

// The playhead on a track of `width` px: the scrubber's thumb centre runs from `inset` to `width - inset`, so the
// playhead line, the diamonds and the ruler use the same mapping and meet the thumb at every time.
export class TimeScale {
  readonly zoom: number;
  readonly width: number;
  private readonly usable: number;

  /** `viewWidth` is the width at zoom 1; the track is `viewWidth * zoom` wide. */
  constructor(
    readonly length: number,
    viewWidth: number,
    zoom = 1,
    readonly inset = THUMB_INSET_PX,
  ) {
    this.zoom = clampZoom(zoom);
    this.width = Math.max(0, Number.isFinite(viewWidth) ? viewWidth : 0) * this.zoom;
    this.usable = Math.max(0, this.width - 2 * inset);
  }

  private get valid(): boolean {
    return this.length > 0 && Number.isFinite(this.length) && this.usable > 0;
  }

  timeToX(time: number): number {
    if (!this.valid || !Number.isFinite(time)) return this.inset;
    return this.inset + (Math.min(this.length, Math.max(0, time)) / this.length) * this.usable;
  }

  xToTime(x: number): number {
    if (!this.valid || !Number.isFinite(x)) return 0;
    return (Math.min(this.usable, Math.max(0, x - this.inset)) / this.usable) * this.length;
  }

  /** Seconds one px stands for: the gap under which two keyframes share a diamond. */
  get secondsPerPx(): number {
    return this.valid ? this.length / this.usable : 0;
  }

  /** The nearest frame time at or below `time`, stepped `frames` (negative: back); clamped into the clip. */
  stepFrames(time: number, frames: number): number {
    const position = (Number.isFinite(time) ? time : 0) * FRAME_RATE;
    const epsilon = 1e-6;
    const index = frames >= 0 ? Math.floor(position + epsilon) + frames : Math.ceil(position - epsilon) + frames;
    return Math.min(Math.max(0, this.length), Math.max(0, index / FRAME_RATE));
  }

  /** Ruler ticks on 1, 2, 5 × 10^k s steps, never closer than `minPx` px. */
  ticks(minPx = 64): Tick[] {
    if (!this.valid) return [];
    const perSecond = this.usable / this.length;
    const step = niceStep(minPx / perSecond);
    const out: Tick[] = [];
    for (let i = 0; i * step <= this.length + 1e-9 && out.length < 4096; i++) {
      const time = Math.round(i * step * 1e6) / 1e6;
      out.push({ time, x: this.timeToX(time), label: tickLabel(time, step) });
    }
    return out;
  }
}

function niceStep(minSeconds: number): number {
  for (let power = -2; power < 12; power++) {
    for (const base of STEP_BASES) {
      const step = base * 10 ** power;
      if (step >= minSeconds && step >= 0.05) return step;
    }
  }
  return 10 ** 12;
}

function tickLabel(time: number, step: number): string {
  return `${time.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}s`;
}
