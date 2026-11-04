import type { SceneAnimation } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { Playback, type PlaybackClock } from '../src/timeline/Playback';

const clip: SceneAnimation = { name: 'c', loop: 'loop', length: 2, channels: [] };

function setup(animations: readonly SceneAnimation[] = [clip]) {
  let time = 0;
  let pending: (() => void) | null = null;
  const clock: PlaybackClock = {
    request: (callback) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
    now: () => time,
  };
  const frames: { clip: number; time: number; loop: boolean }[] = [];
  const release: (() => void)[] = [];
  const changed: number[] = [];
  const playback = new Playback(
    {
      frame: (c, t, l) => {
        frames.push({ clip: c, time: t, loop: l });
        return new Promise<void>((resolve) => release.push(resolve));
      },
      changed: () => changed.push(1),
    },
    animations,
    clock,
  );
  const advance = (ms: number): void => {
    time += ms;
    const run = pending;
    pending = null;
    run?.();
  };
  return { playback, frames, release, advance, changed, isScheduled: () => pending !== null };
}

describe('Playback', () => {
  it('does nothing for a model without clips', () => {
    const { playback, frames } = setup([]);
    playback.play();
    playback.seek(1);
    expect(playback.playing).toBe(false);
    expect(frames).toHaveLength(1);
    expect(playback.length).toBe(0);
  });

  it('follows the clock and loops past the end', () => {
    const { playback, advance, frames, release } = setup();
    playback.play();
    advance(500);
    expect(playback.time).toBeCloseTo(0.5);
    release.splice(0).forEach((r) => r());
    advance(2000);
    expect(playback.time).toBeCloseTo(0.5);
    expect(frames.at(-1)?.loop).toBe(true);
  });

  it('holds at the end and stops when not looping', () => {
    const { playback, advance } = setup();
    playback.setLoop(false);
    playback.play();
    advance(5000);
    expect(playback.time).toBe(2);
    expect(playback.playing).toBe(false);
    playback.play();
    expect(playback.time).toBe(0);
    expect(playback.playing).toBe(true);
  });

  it('scrubs within the clip, clamps, and sends the latest position after a pending frame', async () => {
    const { playback, frames, release } = setup();
    playback.seek(1);
    playback.seek(1.5);
    playback.seek(99);
    expect(playback.time).toBe(2);
    expect(frames).toHaveLength(1);
    release.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames).toHaveLength(2);
    expect(frames[1]?.time).toBe(2);
  });

  it('pauses without scheduling more frames and resets on a new clip list', () => {
    const { playback, isScheduled, advance } = setup();
    playback.play();
    advance(100);
    playback.pause();
    expect(playback.playing).toBe(false);
    expect(isScheduled()).toBe(false);
    playback.seek(1);
    playback.setAnimations([clip, clip]);
    expect(playback.time).toBe(0);
    playback.selectClip(1);
    expect(playback.clipIndex).toBe(1);
    playback.selectClip(9);
    expect(playback.clipIndex).toBe(1);
  });
});
