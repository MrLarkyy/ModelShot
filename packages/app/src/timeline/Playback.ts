import { animationTime, type SceneAnimation } from '@modelshot/scene';

export interface PlaybackClock {
  request(callback: () => void): number;
  cancel(id: number): void;
  now(): number;
}

export const BROWSER_CLOCK: PlaybackClock = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

export interface PlaybackHost {
  /** Shows the clip at `time` seconds; resolves when the preview has taken it. */
  readonly frame: (clip: number, time: number, loop: boolean) => Promise<void>;
  /** The playhead or the play state changed. */
  readonly changed: () => void;
}

// A time-based play head: the position follows the clock, not the frame count, so a slow frame skips ahead instead of
// slowing the clip down. A frame is not sent while the previous one is still being taken.
export class Playback {
  private clip = 0;
  private position = 0;
  private looping = true;
  private running = false;
  private startedAt = 0;
  private startedFrom = 0;
  private handle = 0;
  private pending = false;
  private stale = false;
  private shown = false;

  constructor(
    private readonly host: PlaybackHost,
    private animations: readonly SceneAnimation[],
    private readonly clock: PlaybackClock = BROWSER_CLOCK,
  ) {}

  get playing(): boolean {
    return this.running;
  }

  /** A frame of a clip was sent since the clips were set: the preview shows a pose, also at 0 s. */
  get posed(): boolean {
    return this.shown;
  }

  get time(): number {
    return this.position;
  }

  get loop(): boolean {
    return this.looping;
  }

  get clipIndex(): number {
    return this.clip;
  }

  get length(): number {
    return this.animations[this.clip]?.length ?? 0;
  }

  setAnimations(animations: readonly SceneAnimation[]): void {
    this.pause();
    this.animations = animations;
    this.clip = 0;
    this.position = 0;
    this.shown = false;
  }

  selectClip(clip: number): void {
    if (clip < 0 || clip >= this.animations.length) return;
    this.clip = clip;
    this.seek(0);
  }

  setLoop(loop: boolean): void {
    this.looping = loop;
    this.host.changed();
  }

  play(): void {
    if (this.running || this.length <= 0) return;
    if (!this.looping && this.position >= this.length) this.position = 0;
    this.running = true;
    this.startedAt = this.clock.now();
    this.startedFrom = this.position;
    this.host.changed();
    this.schedule();
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.clock.cancel(this.handle);
    this.host.changed();
  }

  seek(time: number): void {
    const length = this.length;
    this.position = Math.min(length, Math.max(0, Number.isFinite(time) ? time : 0));
    if (this.running) {
      this.startedAt = this.clock.now();
      this.startedFrom = this.position;
    }
    this.send();
    this.host.changed();
  }

  private schedule(): void {
    this.handle = this.clock.request(() => this.tick());
  }

  private tick(): void {
    if (!this.running) return;
    const elapsed = (this.clock.now() - this.startedAt) / 1000;
    const raw = this.startedFrom + elapsed;
    const animation = this.animations[this.clip];
    const length = this.length;
    if (!animation) return;
    if (this.looping) {
      this.position = animationTime(animation, raw, 'loop') ?? 0;
    } else if (raw >= length) {
      this.position = length;
      this.running = false;
    } else {
      this.position = raw;
    }
    this.send();
    this.host.changed();
    if (this.running) this.schedule();
  }

  private send(): void {
    this.shown = true;
    if (this.pending) {
      // The latest position goes out as soon as the frame in flight is taken.
      this.stale = true;
      return;
    }
    this.pending = true;
    void this.host
      .frame(this.clip, this.position, this.looping)
      .catch(() => undefined)
      .finally(() => {
        this.pending = false;
        if (this.stale) {
          this.stale = false;
          this.send();
        }
      });
  }
}
