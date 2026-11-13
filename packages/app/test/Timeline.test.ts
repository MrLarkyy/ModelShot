import type { SceneAnimation, SceneDocument } from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeTime, readoutText } from '../src/timeline/describeTime';
import type { PlaybackClock } from '../src/timeline/Playback';
import { Timeline, type TimelineHost } from '../src/timeline/Timeline';
import { stubTimelineDom, TimelineElement } from './fakeTimelineDom';

const REASON = 'This model has no animations.';
const key = (time: number, x = 0) => ({
  time,
  value: [x, 0, 0] as [number, number, number],
  interpolation: 'linear' as const,
});
const clip: SceneAnimation = { name: 'bob', loop: 'loop', length: 1, channels: [] };
const walk: SceneAnimation = {
  name: 'walk',
  loop: 'loop',
  length: 2,
  channels: [
    { node: 1, property: 'rotation', keyframes: [key(0), key(1, 45)] },
    { node: 0, property: 'rotation', keyframes: [key(0.5, 10)] },
    { node: 0, property: 'translation', keyframes: [key(0.5), key(2)] },
  ],
};
const doc = { nodes: [{ name: 'body' }, { name: 'head' }], meshes: [] } as unknown as SceneDocument;

function manualClock() {
  let now = 0;
  let pending: (() => void) | null = null;
  const clock: PlaybackClock = {
    request: (callback) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
    now: () => now,
  };
  const advance = (ms: number): void => {
    now += ms;
    const callback = pending;
    pending = null;
    callback?.();
  };
  return { clock, advance };
}

function setup(overrides: Partial<TimelineHost> = {}) {
  const root = new TimelineElement();
  const selected: { node: number | null } = { node: null };
  const selectNode = vi.fn();
  const interacted = vi.fn();
  const { clock, advance } = manualClock();
  const timeline = new Timeline(
    root as unknown as HTMLElement,
    {
      frame: () => Promise.resolve(),
      interacted,
      document: () => doc,
      selectedNode: () => selected.node,
      selectNode,
      ...overrides,
    },
    clock,
  );
  const button = (label: string): TimelineElement => {
    const found = root.all((e) => e.getAttribute('aria-label') === label)[0];
    if (!found) throw new Error(`No control named ${label}`);
    return found;
  };
  return { root, timeline, selected, selectNode, interacted, advance, button };
}

describe('Timeline', () => {
  beforeEach(() => {
    stubTimelineDom();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says why it is empty, as a one-row bar, while the model has no clip', () => {
    const { root, timeline } = setup();
    timeline.show([]);
    expect(root.text()).toContain(REASON);
    expect(root.attributes.has('data-empty')).toBe(true);
  });

  it('keeps the reason out of the panel while clips are listed, and brings it back once without them', () => {
    const { root, timeline } = setup();
    timeline.show([clip]);
    expect(root.text()).toContain('bob');
    expect(root.text()).not.toContain(REASON);
    expect(root.attributes.has('data-empty')).toBe(false);
    timeline.show([]);
    timeline.show([]);
    expect(root.text().split(REASON)).toHaveLength(2);
    expect(root.attributes.has('data-empty')).toBe(true);
  });

  it('ends the busy skeleton when the clips are listed', () => {
    const { root, timeline } = setup();
    root.setAttribute('data-loading', '');
    root.setAttribute('aria-busy', 'true');
    timeline.show([walk]);
    expect(root.attributes.has('data-loading')).toBe(false);
    expect(root.attributes.has('aria-busy')).toBe(false);
  });

  it('draws one lane per animated node in node order, named as text, with a diamond per keyframe time', () => {
    const { root, timeline } = setup();
    timeline.show([walk]);
    const names = root.byClass('tl-name');
    expect(names.map((name) => name.title)).toEqual(['body', 'head']);
    const lanes = root.byClass('tl-lane');
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.byClass('kf').map((kf) => kf.dataset['time'])).toEqual(['0.5', '2']);
    expect(lanes[1]?.byClass('kf').map((kf) => kf.dataset['time'])).toEqual(['0', '1']);
    expect(lanes[1]?.byClass('kf')[1]?.title).toBe('1.00 s · rotation 45, 0, 0');
    expect(root.byClass('keyframe-count')[0]?.textContent).toBe('4 keyframes');
  });

  it('a click on a lane or its name selects that node', () => {
    const { root, timeline, selectNode } = setup();
    timeline.show([walk]);
    root.byClass('tl-name')[1]?.fire('click');
    expect(selectNode).toHaveBeenLastCalledWith(1);
    root.byClass('tl-lane')[0]?.fire('click', { target: root });
    expect(selectNode).toHaveBeenLastCalledWith(0);
  });

  it('marks the lane of the selected node and moves the mark with the selection', () => {
    const { root, timeline, selected } = setup();
    timeline.show([walk]);
    selected.node = 1;
    timeline.selectionChanged();
    const [first, second] = root.byClass('tl-name');
    expect(second?.getAttribute('aria-current')).toBe('true');
    expect(root.byClass('tl-lane')[1]?.hasClass('sel')).toBe(true);
    selected.node = 0;
    timeline.selectionChanged();
    expect(first?.getAttribute('aria-current')).toBe('true');
    expect(second?.getAttribute('aria-current')).toBeNull();
    expect(root.byClass('tl-lane')[1]?.hasClass('sel')).toBe(false);
    selected.node = null;
    timeline.selectionChanged();
    expect(root.byClass('sel')).toHaveLength(0);
  });

  it('steps to the previous and next keyframe of any node, and stays at the ends', () => {
    const { timeline, interacted } = setup();
    timeline.show([walk]);
    timeline.stepKeyframe(1);
    expect(timeline.time).toBe(0.5);
    timeline.stepKeyframe(1);
    expect(timeline.time).toBe(1);
    timeline.stepKeyframe(-1);
    expect(timeline.time).toBe(0.5);
    timeline.stepKeyframe(1);
    timeline.stepKeyframe(1);
    timeline.stepKeyframe(1);
    expect(timeline.time).toBe(2);
    expect(interacted).toHaveBeenCalled();
    timeline.seek(0);
    timeline.stepKeyframe(-1);
    expect(timeline.time).toBe(0);
  });

  it('moves the scrubber one frame with the arrows, ten with Shift, and by keyframe with Page keys', () => {
    const { root, timeline } = setup();
    timeline.show([walk]);
    const scrub = root.byClass('tl-scrub')[0];
    const press = (k: string, shiftKey = false) => scrub?.fire('keydown', { key: k, shiftKey });
    press('ArrowRight');
    expect(timeline.time).toBeCloseTo(1 / 24, 9);
    press('ArrowRight', true);
    expect(timeline.time).toBeCloseTo(11 / 24, 9);
    press('ArrowLeft');
    expect(timeline.time).toBeCloseTo(10 / 24, 9);
    press('PageDown');
    expect(timeline.time).toBe(0.5);
    press('End');
    expect(timeline.time).toBe(2);
    press('Home');
    expect(timeline.time).toBe(0);
  });

  it('the readout, the scrubber value text and the playhead come from the same time', () => {
    const { root, timeline } = setup();
    timeline.show([walk]);
    timeline.seek(0.5);
    const scrub = root.byClass('tl-scrub')[0];
    expect(root.byClass('time-readout')[0]?.textContent).toBe(readoutText(0.5, 2));
    expect(scrub?.getAttribute('aria-valuetext')).toBe(describeTime(0.5, 2));
    expect(root.byClass('tl-playhead')[0]?.style['transform']).toMatch(/^translateX\(/);
  });

  it('the Loop toggle states whether it is pressed and the clip follows it', () => {
    const { timeline, button } = setup();
    timeline.show([walk]);
    const loop = button('Loop');
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    loop.fire('click');
    expect(loop.getAttribute('aria-pressed')).toBe('false');
    expect(timeline.looping).toBe(false);
  });

  it('Play switches to Pause, and frames of playback move the playhead without touching a lane', () => {
    const { root, timeline, button, advance } = setup();
    timeline.show([walk]);
    const lanes = root.byClass('tl-lanes')[0];
    const names = root.byClass('tl-names')[0];
    const children = [...(lanes?.children ?? [])];
    const builds = timeline.laneBuilds;
    const touched = [lanes, names, ...root.byClass('tl-lane'), ...root.byClass('tl-name')].map((e) => e?.mutations);
    button('Play').fire('click');
    expect(button('Pause')).toBeDefined();
    for (let i = 0; i < 20; i++) advance(50);
    expect(timeline.time).toBeGreaterThan(0.9);
    expect(timeline.laneBuilds).toBe(builds);
    expect(lanes?.children).toEqual(children);
    expect([lanes, names, ...root.byClass('tl-lane'), ...root.byClass('tl-name')].map((e) => e?.mutations)).toEqual(
      touched,
    );
    button('Pause').fire('click');
    expect(button('Play')).toBeDefined();
  });

  it('disables the transport without a clip', () => {
    const { timeline, button } = setup();
    timeline.show([]);
    expect(button('Play').disabled).toBe(true);
    expect(button('Next keyframe').disabled).toBe(true);
    timeline.show([walk]);
    expect(button('Play').disabled).toBe(false);
  });
});
