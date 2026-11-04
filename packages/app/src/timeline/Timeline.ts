import type { SceneAnimation } from '@modelshot/scene';
import { el, uniqueId } from '../ui/dom';
import { describeTime } from './describeTime';
import { keyframeTimes } from './keyframeTimes';
import { BROWSER_CLOCK, Playback, type PlaybackClock } from './Playback';

export interface TimelineHost {
  /** Shows the clip at `time`; resolves when the preview has taken it. */
  readonly frame: (clip: number, time: number, loop: boolean) => Promise<void>;
  /** The user started or moved the playback: a render in progress no longer matches. */
  readonly interacted: () => void;
  /** Playback started or stopped. */
  readonly playingChanged?: (playing: boolean) => void;
}

const SCRUB_STEP = 0.01;
const DEFAULT_TRACK_PX = 600;

// The bottom panel: clip choice, play and pause, loop, a scrubber and the keyframe markers of the model's clips. Nothing
// plays by itself.
export class Timeline {
  private readonly clip: HTMLSelectElement;
  private readonly play: HTMLButtonElement;
  private readonly loop: HTMLInputElement;
  private readonly scrub: HTMLInputElement;
  private readonly readout: HTMLSpanElement;
  private readonly markers: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly empty: HTMLParagraphElement;
  private readonly playback: Playback;
  private animations: readonly SceneAnimation[] = [];
  private wasPlaying = false;

  constructor(
    root: HTMLElement,
    private readonly host: TimelineHost,
    clock: PlaybackClock = BROWSER_CLOCK,
  ) {
    this.playback = new Playback(
      { frame: (clip, time, loop) => host.frame(clip, time, loop), changed: () => this.sync() },
      [],
      clock,
    );
    const clipId = uniqueId('clip');
    const scrubId = uniqueId('scrub');
    this.clip = el('select', { id: clipId });
    this.clip.addEventListener('change', () => {
      this.host.interacted();
      this.playback.selectClip(Number(this.clip.value));
      this.drawMarkers();
    });
    this.play = el('button', { text: 'Play', attributes: { type: 'button' } });
    this.play.addEventListener('click', () => {
      this.host.interacted();
      if (this.playback.playing) this.playback.pause();
      else this.playback.play();
    });
    this.loop = el('input', { attributes: { type: 'checkbox' } });
    this.loop.checked = true;
    this.loop.addEventListener('change', () => this.playback.setLoop(this.loop.checked));
    this.scrub = el('input', {
      id: scrubId,
      attributes: { type: 'range', min: '0', max: '0', step: String(SCRUB_STEP), value: '0' },
    });
    this.scrub.addEventListener('input', () => {
      this.host.interacted();
      this.playback.pause();
      this.playback.seek(Number(this.scrub.value));
    });
    this.readout = el('span', { className: 'time-readout', attributes: { 'aria-hidden': 'true' } });
    this.markers = el('div', { className: 'markers', attributes: { 'aria-hidden': 'true' } });
    this.count = el('span', { className: 'hint keyframe-count' });
    this.empty = el('p', { className: 'hint', text: 'This model has no animations.' });
    root.replaceChildren(
      el('div', { className: 'timeline-controls' }, [
        el('label', { className: 'field', attributes: { for: clipId } }, [el('span', { text: 'Clip' })]),
        this.clip,
        this.play,
        el('label', { className: 'choice' }, [this.loop, el('span', { text: 'Loop' })]),
        el('label', { className: 'visually-hidden', attributes: { for: scrubId }, text: 'Playhead' }),
        this.scrub,
        this.readout,
      ]),
      this.markers,
      this.count,
      this.empty,
    );
    this.show([]);
  }

  get playing(): boolean {
    return this.playback.playing;
  }

  /** A clip pose is shown (a frame was sent since the model was set), also at 0 s. */
  get posed(): boolean {
    return this.playback.posed;
  }

  get time(): number {
    return this.playback.time;
  }

  get clipIndex(): number {
    return this.playback.clipIndex;
  }

  get looping(): boolean {
    return this.playback.loop;
  }

  toggle(): void {
    if (this.animations.length === 0) return;
    if (this.playback.playing) this.playback.pause();
    else this.playback.play();
  }

  /** Lists the clips of a model (none for a model without animation); playback stops at 0. */
  show(animations: readonly SceneAnimation[]): void {
    this.animations = animations;
    this.playback.setAnimations(animations);
    this.clip.replaceChildren(
      ...animations.map((animation, index) =>
        el('option', { text: animation.name || `Clip ${index + 1}`, attributes: { value: String(index) } }),
      ),
    );
    this.empty.hidden = animations.length > 0;
    this.drawMarkers();
    this.sync();
  }

  pause(): void {
    this.playback.pause();
  }

  seek(time: number): void {
    this.playback.pause();
    this.playback.seek(time);
  }

  private drawMarkers(): void {
    const animation = this.animations[this.playback.clipIndex];
    this.markers.replaceChildren();
    if (!animation || animation.length <= 0) {
      this.count.textContent = '';
      return;
    }
    const width = this.markers.clientWidth || DEFAULT_TRACK_PX;
    const { times, count } = keyframeTimes(animation, animation.length / width);
    const parts = times.map((time) => {
      const marker = el('span', { className: 'marker' });
      marker.style.left = `${(time / animation.length) * 100}%`;
      return marker;
    });
    this.markers.append(...parts);
    this.count.textContent = `${count} keyframe${count === 1 ? '' : 's'}`;
  }

  private sync(): void {
    const length = this.playback.length;
    const has = this.animations.length > 0;
    for (const control of [this.clip, this.play, this.loop, this.scrub]) control.disabled = !has;
    this.scrub.max = String(length);
    this.scrub.value = String(this.playback.time);
    this.scrub.setAttribute('aria-valuetext', describeTime(this.playback.time, length));
    this.readout.textContent = has ? describeTime(this.playback.time, length) : '';
    this.play.textContent = this.playback.playing ? 'Pause' : 'Play';
    if (this.wasPlaying !== this.playback.playing) {
      this.wasPlaying = this.playback.playing;
      this.host.playingChanged?.(this.wasPlaying);
    }
  }
}
