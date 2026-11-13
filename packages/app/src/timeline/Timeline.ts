import type { SceneAnimation, SceneDocument } from '@modelshot/scene';
import { applyShortcutHint } from '../shortcuts/shortcutHint';
import { el, uniqueId } from '../ui/dom';
import { icon } from '../ui/icon';
import { iconButton } from '../ui/iconButton';
import { describeTime, readoutText } from './describeTime';
import { validTimes } from './keyframeTimes';
import { laneRows, type LaneRows } from './laneRows';
import { setTimelineLoading } from './setTimelineLoading';
import { BROWSER_CLOCK, Playback, type PlaybackClock } from './Playback';
import { scrubberCommand } from './scrubberKeys';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, TimeScale } from './TimeScale';

export interface TimelineHost {
  /** Shows the clip at `time`; resolves when the preview has taken it. */
  readonly frame: (clip: number, time: number, loop: boolean) => Promise<void>;
  /** The user started or moved the playback: a render in progress no longer matches. */
  readonly interacted: () => void;
  /** Playback started or stopped. */
  readonly playingChanged?: (playing: boolean) => void;
  /** Another clip was chosen. */
  readonly clipChanged?: () => void;
  /** The model on show (names and node count of the lanes), or null. */
  readonly document: () => SceneDocument | null;
  /** The user's names of nodes, by name key. */
  readonly names?: () => ReadonlyMap<string, string>;
  /** The node the selection stands on (a node, or the node of a selected element), or null. */
  readonly selectedNode: () => number | null;
  /** A lane was chosen: the selection moves to that node. */
  readonly selectNode: (node: number) => void;
}

const DEFAULT_TRACK_PX = 600;
const DEFAULT_NAMES_PX = 200;
const ZOOM_STEP = 1.25;
const KEYFRAME_EPSILON = 1e-4;
const SYNC_SAMPLES = 64;
const SKELETON_ROWS = 3;

interface LaneParts {
  readonly name: HTMLButtonElement;
  readonly lane: HTMLElement;
}

// The bottom panel: a transport bar (clip, play, loop, keyframe steps, zoom) over a body of one lane per animated node,
// a time ruler and the playhead. Nothing plays by itself. The native range input stays the scrubber (named, with a
// spoken value); lanes and ruler are rebuilt only for a clip, a zoom, a width or a model, a frame of playback moves
// the playhead, the readout and the scrubber value.
export class Timeline {
  private readonly clip: HTMLSelectElement;
  private readonly play: HTMLButtonElement;
  private readonly loop: HTMLButtonElement;
  private readonly skipStart: HTMLButtonElement;
  private readonly prevKey: HTMLButtonElement;
  private readonly nextKey: HTMLButtonElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly readout: HTMLSpanElement;
  private readonly count: HTMLSpanElement;
  private readonly empty: HTMLParagraphElement;
  private readonly body: HTMLDivElement;
  private readonly names: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly ruler: HTMLDivElement;
  private readonly lanes: HTMLDivElement;
  private readonly playhead: HTMLDivElement;
  private readonly playIcon: SVGSVGElement;
  private readonly pauseIcon: SVGSVGElement;
  private readonly playback: Playback;
  private readonly parts = new Map<number, LaneParts>();
  private readonly syncTimes: number[] = [];
  private readonly resizeObserver: ResizeObserver | null;
  private animations: readonly SceneAnimation[] = [];
  private keyTimes: readonly number[] = [];
  private scale = new TimeScale(0, DEFAULT_TRACK_PX);
  private zoom = MIN_ZOOM;
  private viewWidth = 0;
  private wasPlaying = false;
  private shownPlaying: boolean | null = null;
  private shownText = '';
  private shownX = Number.NaN;
  private highlighted: number | null = null;
  private resizePending = false;
  /** Lane sets built so far: playback must not raise it. */
  laneBuilds = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: TimelineHost,
    private readonly clock: PlaybackClock = BROWSER_CLOCK,
  ) {
    this.playback = new Playback(
      { frame: (clip, time, loop) => host.frame(clip, time, loop), changed: () => this.sync() },
      [],
      clock,
    );
    this.clip = this.clipSelect();
    this.skipStart = this.transportButton(iconButton('skip-start', 'Back to start'), () => this.jump(0));
    this.play = this.transportButton(iconButton('play', 'Play', { shortcut: 'playPause' }), () =>
      this.togglePlayback(),
    );
    this.play.classList.add('tl-play');
    this.playIcon = icon('play');
    this.pauseIcon = icon('pause');
    this.prevKey = this.transportButton(iconButton('key-prev', 'Previous keyframe', { shortcut: 'prevKeyframe' }), () =>
      this.stepKeyframe(-1),
    );
    this.nextKey = this.transportButton(iconButton('key-next', 'Next keyframe', { shortcut: 'nextKeyframe' }), () =>
      this.stepKeyframe(1),
    );
    this.loop = this.transportButton(iconButton('loop', 'Loop', { pressed: true }), () => this.toggleLoop());
    this.zoomOut = this.transportButton(iconButton('zoom-out', 'Zoom out'), () => this.setZoom(this.zoom / ZOOM_STEP));
    this.zoomOut.classList.add('tl-zoom');
    this.zoomIn = this.transportButton(iconButton('zoom-in', 'Zoom in'), () => this.setZoom(this.zoom * ZOOM_STEP));
    this.zoomIn.classList.add('tl-zoom');
    this.scrub = this.scrubber();
    this.readout = el('span', { className: 'time-readout', attributes: { 'aria-hidden': 'true' } });
    this.count = el('span', { className: 'hint keyframe-count' });
    this.empty = el('p', { className: 'hint', text: 'This model has no animations.' });
    this.ruler = el('div', { className: 'tl-ruler', attributes: { 'aria-hidden': 'true' } });
    this.lanes = el('div', { className: 'tl-lanes' });
    this.playhead = el('div', { className: 'tl-playhead', attributes: { 'aria-hidden': 'true' } });
    this.track = el('div', { className: 'tl-track' }, [
      el('div', { className: 'tl-head' }, [this.ruler, this.scrub]),
      this.lanes,
      this.playhead,
    ]);
    this.names = el('div', { className: 'tl-names' }, [el('div', { className: 'tl-corner' })]);
    this.names.addEventListener('keydown', (event) => this.onNamesKey(event));
    this.body = el('div', { className: 'tl-body' }, [this.names, this.track]);
    this.body.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    root.replaceChildren(this.transportBar(), this.body, this.skeleton());
    this.resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.scheduleResize());
    this.resizeObserver?.observe(this.body);
    this.sync();
  }

  private transportButton(button: HTMLButtonElement, onClick: () => void): HTMLButtonElement {
    button.addEventListener('click', onClick);
    return button;
  }

  private clipSelect(): HTMLSelectElement {
    const select = el('select', { attributes: { 'aria-label': 'Clip' } });
    select.addEventListener('change', () => {
      this.host.interacted();
      this.playback.selectClip(Number(select.value));
      this.drawLanes();
      this.host.clipChanged?.();
    });
    return select;
  }

  private scrubber(): HTMLInputElement {
    const input = el('input', {
      id: uniqueId('scrub'),
      className: 'tl-scrub',
      attributes: { type: 'range', min: '0', max: '0', step: 'any', value: '0', 'aria-label': 'Playhead' },
    });
    input.addEventListener('input', () => this.moveTo(Number(input.value)));
    input.addEventListener('keydown', (event) => this.onScrubKey(event));
    return input;
  }

  private transportBar(): HTMLElement {
    return el('div', { className: 'tl-bar' }, [
      this.skipStart,
      this.play,
      this.prevKey,
      this.nextKey,
      this.loop,
      this.clip,
      this.readout,
      this.count,
      el('span', { className: 'tl-spacer' }),
      this.zoomOut,
      this.zoomIn,
    ]);
  }

  // Aria-hidden lanes standing in for the real ones while a model opens.
  private skeleton(): HTMLElement {
    return el(
      'div',
      { className: 'tl-skeleton', attributes: { 'aria-hidden': 'true' } },
      Array.from({ length: SKELETON_ROWS }, () => el('div', { className: 'tl-skeleton-row' })),
    );
  }

  private togglePlayback(): void {
    this.host.interacted();
    if (this.playback.playing) this.playback.pause();
    else this.playback.play();
  }

  private toggleLoop(): void {
    const loop = this.loop.getAttribute('aria-pressed') !== 'true';
    this.loop.setAttribute('aria-pressed', String(loop));
    this.playback.setLoop(loop);
  }

  private onWheel(event: WheelEvent): void {
    if (!event.ctrlKey) return;
    event.preventDefault();
    this.setZoom(this.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
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

  /** Median milliseconds of the last `sync` calls, for the frame-budget test. */
  get medianSyncMs(): number {
    const sorted = [...this.syncTimes].sort((a, b) => a - b);
    return sorted[sorted.length >> 1] ?? 0;
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
    this.zoom = MIN_ZOOM;
    this.clip.replaceChildren(
      ...animations.map((animation, index) =>
        el('option', {
          text: `${animation.name || `Clip ${index + 1}`} · ${animation.length.toFixed(2)} s`,
          attributes: { value: String(index) },
        }),
      ),
    );
    // The reason is in the panel only while it holds: with clips it is not left behind as hidden text.
    if (animations.length === 0) this.root.append(this.empty);
    else this.empty.remove();
    setTimelineLoading(this.root, false);
    // No clip to play: the panel is a one-row bar.
    this.root.toggleAttribute('data-empty', animations.length === 0);
    this.drawLanes();
  }

  pause(): void {
    this.playback.pause();
  }

  seek(time: number): void {
    this.playback.pause();
    this.playback.seek(time);
    this.followPlayhead();
  }

  /** Moves the playhead to the keyframe before or after it (of any node); nothing when there is none. */
  stepKeyframe(direction: 1 | -1): void {
    const time = this.playback.time;
    const target =
      direction > 0
        ? this.keyTimes.find((t) => t > time + KEYFRAME_EPSILON)
        : this.keyTimes.findLast((t) => t < time - KEYFRAME_EPSILON);
    if (target === undefined) return;
    this.moveTo(target);
  }

  /** The selection changed: the lane of the selected node is marked and kept in view. */
  selectionChanged(): void {
    const node = this.host.selectedNode();
    if (node === this.highlighted) return;
    const before = this.highlighted === null ? undefined : this.parts.get(this.highlighted);
    if (before) this.mark(before, false);
    this.highlighted = node;
    const now = node === null ? undefined : this.parts.get(node);
    if (now) {
      this.mark(now, true);
      this.reveal(now.lane);
    }
    this.rove();
  }

  /** The node names changed (a rename): the lane labels follow. */
  namesChanged(): void {
    if (this.animations.length > 0) this.drawLanes();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.playback.pause();
  }

  private mark(parts: LaneParts, on: boolean): void {
    parts.lane.classList.toggle('sel', on);
    parts.name.classList.toggle('sel', on);
    if (on) parts.name.setAttribute('aria-current', 'true');
    else parts.name.removeAttribute('aria-current');
  }

  // A seek the user asked for: playback stops, the pose follows, the preview and a render in progress are told.
  private moveTo(time: number): void {
    this.host.interacted();
    this.playback.pause();
    this.playback.seek(time);
    this.followPlayhead();
  }

  private jump(time: number): void {
    if (this.animations.length > 0) this.moveTo(time);
  }

  private onScrubKey(event: KeyboardEvent): void {
    const command = scrubberCommand(event);
    if (!command) return;
    event.preventDefault();
    switch (command.kind) {
      case 'frames':
        this.moveTo(this.scale.stepFrames(this.playback.time, command.frames));
        break;
      case 'keyframe':
        this.stepKeyframe(command.direction);
        break;
      case 'start':
        this.moveTo(0);
        break;
      case 'end':
        this.moveTo(this.playback.length);
        break;
    }
  }

  private onNamesKey(event: KeyboardEvent): void {
    const buttons = [...this.parts.values()].map((parts) => parts.name);
    const at = buttons.findIndex((button) => button === event.target);
    if (at < 0) return;
    const next =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    const target = buttons[next];
    if (!target) return;
    event.preventDefault();
    for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
    target.focus();
  }

  // One name button is a tab stop, the selected lane's or else the first: the arrows move between the others.
  private rove(): void {
    const selected = this.highlighted === null ? undefined : this.parts.get(this.highlighted);
    const stop = selected ?? this.parts.values().next().value;
    for (const parts of this.parts.values()) parts.name.tabIndex = parts === stop ? 0 : -1;
  }

  private reveal(lane: HTMLElement): void {
    const body = this.body;
    const top = lane.offsetTop;
    const bottom = top + lane.offsetHeight;
    const header = this.ruler.offsetHeight;
    if (top - header < body.scrollTop) body.scrollTop = Math.max(0, top - header);
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = bottom - body.clientHeight;
  }

  private setZoom(value: number): void {
    const zoom = clampZoom(value);
    if (zoom === this.zoom || this.animations.length === 0) return;
    const centre = this.scale.xToTime(this.body.scrollLeft + this.visibleTrackPx() / 2);
    this.zoom = zoom;
    this.drawLanes();
    this.body.scrollLeft = Math.max(0, this.scale.timeToX(centre) - this.visibleTrackPx() / 2);
  }

  private namesPx(): number {
    return this.names.offsetWidth || DEFAULT_NAMES_PX;
  }

  private visibleTrackPx(): number {
    return Math.max(0, (this.body.clientWidth || DEFAULT_TRACK_PX + this.namesPx()) - this.namesPx());
  }

  private scheduleResize(): void {
    if (this.resizePending) return;
    this.resizePending = true;
    this.clock.request(() => {
      this.resizePending = false;
      if (Math.abs(this.visibleTrackPx() - this.viewWidth) >= 1 && this.animations.length > 0) this.drawLanes();
    });
  }

  // Keeps the playhead inside the scrolled view of a zoomed track.
  private followPlayhead(): void {
    if (this.zoom <= MIN_ZOOM) return;
    const x = this.scale.timeToX(this.playback.time);
    const left = this.body.scrollLeft;
    const view = this.visibleTrackPx();
    if (x < left || x > left + view) this.body.scrollLeft = Math.max(0, x - view / 2);
  }

  private drawLanes(): void {
    const animation = this.animations[this.playback.clipIndex];
    this.laneBuilds++;
    this.viewWidth = this.visibleTrackPx();
    this.scale = new TimeScale(animation?.length ?? 0, this.viewWidth || DEFAULT_TRACK_PX, this.zoom);
    this.track.style.width = `${this.scale.width}px`;
    this.zoomOut.disabled = !animation || this.zoom <= MIN_ZOOM;
    this.zoomIn.disabled = !animation || this.zoom >= MAX_ZOOM;
    this.ruler.replaceChildren(...this.rulerTicks());
    this.keyTimes = animation
      ? validTimes(
          animation.channels.flatMap((c) => c.keyframes.map((k) => k.time)),
          animation.length,
        )
      : [];
    this.count.textContent = animation
      ? `${this.keyTimes.length} keyframe${this.keyTimes.length === 1 ? '' : 's'}`
      : '';
    const drawn: LaneRows = animation
      ? laneRows(animation, this.host.document(), this.host.names?.(), this.scale.secondsPerPx)
      : { rows: [], more: 0 };
    this.parts.clear();
    this.highlighted = null;
    const names: HTMLElement[] = [el('div', { className: 'tl-corner' })];
    const lanes: HTMLElement[] = [];
    for (const row of drawn.rows) {
      const parts = this.laneElements(row);
      this.parts.set(row.node, parts);
      names.push(parts.name);
      lanes.push(parts.lane);
    }
    if (drawn.more > 0) {
      names.push(el('div', { className: 'tl-name more', text: `+${drawn.more} more nodes` }));
      lanes.push(el('div', { className: 'tl-lane more' }));
    }
    this.names.replaceChildren(...names);
    this.lanes.replaceChildren(...lanes);
    this.shownX = Number.NaN;
    this.selectionChanged();
    // After the selection: a model opens with none, and the first lane name is the tab stop then.
    this.rove();
    this.sync();
  }

  private rulerTicks(): HTMLElement[] {
    return this.scale.ticks().map((tick) => {
      const label = el('span', { className: 'tl-tick', text: tick.label });
      label.style.left = `${tick.x}px`;
      return label;
    });
  }

  // The name button and the lane of one node; names are text, never markup.
  private laneElements(row: LaneRows['rows'][number]): LaneParts {
    const name = el('button', { className: 'tl-name', attributes: { type: 'button' } }, [
      el('span', { text: row.name }),
    ]);
    name.title = row.name;
    name.tabIndex = -1;
    name.addEventListener('click', () => this.host.selectNode(row.node));
    const lane = el('div', { className: 'tl-lane' });
    lane.addEventListener('click', (event) => {
      this.host.selectNode(row.node);
      const time = event.target instanceof HTMLElement ? event.target.dataset['time'] : undefined;
      if (time !== undefined) this.moveTo(Number(time));
    });
    lane.append(
      ...row.markers.map((marker) => {
        const diamond = el('span', { className: 'kf', attributes: { 'aria-hidden': 'true' } });
        diamond.style.left = `${this.scale.timeToX(marker.time)}px`;
        diamond.title = marker.title;
        diamond.dataset['time'] = String(marker.time);
        return diamond;
      }),
    );
    return { name, lane };
  }

  // One frame of playback: the playhead, the readout and the scrubber value; never the lanes.
  private sync(): void {
    const start = typeof performance === 'undefined' ? 0 : performance.now();
    const length = this.playback.length;
    const time = this.playback.time;
    const has = this.animations.length > 0;
    for (const control of [this.clip, this.play, this.loop, this.scrub, this.skipStart, this.prevKey, this.nextKey]) {
      if (control.disabled === has) control.disabled = !has;
    }
    if (this.scrub.max !== String(length)) this.scrub.max = String(length);
    this.scrub.value = String(time);
    const text = describeTime(time, length);
    if (text !== this.shownText) {
      this.shownText = text;
      this.scrub.setAttribute('aria-valuetext', text);
      this.readout.textContent = has ? readoutText(time, length) : '';
    }
    const x = this.scale.timeToX(time);
    if (x !== this.shownX) {
      this.shownX = x;
      this.playhead.style.transform = `translateX(${x}px)`;
    }
    const playing = this.playback.playing;
    if (playing !== this.shownPlaying) {
      this.shownPlaying = playing;
      const label = playing ? 'Pause' : 'Play';
      this.play.setAttribute('aria-label', label);
      applyShortcutHint(this.play, 'playPause', label);
      this.play.replaceChildren(playing ? this.pauseIcon : this.playIcon);
    }
    if (playing) this.followPlayhead();
    if (this.wasPlaying !== playing) {
      this.wasPlaying = playing;
      this.host.playingChanged?.(playing);
    }
    if (typeof performance !== 'undefined') {
      this.syncTimes.push(performance.now() - start);
      if (this.syncTimes.length > SYNC_SAMPLES) this.syncTimes.shift();
    }
  }
}
