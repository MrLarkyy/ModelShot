import { describe, expect, it } from 'vitest';
import { clampZoom, FRAME_RATE, MAX_ZOOM, THUMB_INSET_PX, TimeScale } from '../src/timeline/TimeScale';

describe('TimeScale', () => {
  it('maps the clip onto the track between the thumb insets and back', () => {
    const scale = new TimeScale(2, 612);
    expect(scale.timeToX(0)).toBe(THUMB_INSET_PX);
    expect(scale.timeToX(2)).toBe(612 - THUMB_INSET_PX);
    expect(scale.timeToX(1)).toBe(306);
    for (const time of [0, 0.25, 0.5, 1.3, 2]) expect(scale.xToTime(scale.timeToX(time))).toBeCloseTo(time, 9);
  });

  it('clamps times and positions outside the clip and refuses non-numbers', () => {
    const scale = new TimeScale(2, 600);
    expect(scale.timeToX(-1)).toBe(scale.timeToX(0));
    expect(scale.timeToX(9)).toBe(scale.timeToX(2));
    expect(scale.xToTime(-50)).toBe(0);
    expect(scale.xToTime(9000)).toBe(2);
    expect(scale.timeToX(NaN)).toBe(THUMB_INSET_PX);
    expect(scale.xToTime(NaN)).toBe(0);
  });

  it('a track of length 0, or without width, maps everything to the inset and has no ticks', () => {
    for (const scale of [new TimeScale(0, 600), new TimeScale(2, 0), new TimeScale(NaN, 600)]) {
      expect(scale.timeToX(1)).toBe(THUMB_INSET_PX);
      expect(scale.xToTime(300)).toBe(0);
      expect(scale.ticks()).toEqual([]);
      expect(scale.secondsPerPx).toBe(0);
    }
  });

  it('zoom widens the track and is held to 1..16', () => {
    expect(new TimeScale(2, 600, 4).width).toBe(2400);
    expect(new TimeScale(2, 600, 99).zoom).toBe(MAX_ZOOM);
    expect(new TimeScale(2, 600, 0.1).zoom).toBe(1);
    expect(clampZoom(NaN)).toBe(1);
  });

  it('ticks are on 1, 2, 5 steps and never closer than the minimum, at every zoom and length', () => {
    for (const length of [0.3, 1, 2, 7.5, 60, 3600]) {
      for (const zoom of [1, 2, 5, 16]) {
        const scale = new TimeScale(length, 600, zoom);
        const ticks = scale.ticks(64);
        expect(ticks.length).toBeGreaterThan(0);
        for (let i = 1; i < ticks.length; i++) {
          expect((ticks[i]?.x ?? 0) - (ticks[i - 1]?.x ?? 0), `${length} s at ${zoom}x`).toBeGreaterThanOrEqual(
            64 - 1e-9,
          );
        }
        expect(ticks[0]?.time).toBe(0);
        expect(ticks.at(-1)?.time ?? 0).toBeLessThanOrEqual(length + 1e-9);
      }
    }
  });

  it('steps by frames onto n/24 and stays inside the clip', () => {
    const scale = new TimeScale(2, 600);
    expect(scale.stepFrames(0, 1)).toBeCloseTo(1 / FRAME_RATE, 12);
    expect(scale.stepFrames(0.5, 1)).toBeCloseTo(13 / 24, 12);
    expect(scale.stepFrames(0.51, 1)).toBeCloseTo(13 / 24, 12);
    expect(scale.stepFrames(0.51, -1)).toBeCloseTo(12 / 24, 12);
    expect(scale.stepFrames(0.5, -1)).toBeCloseTo(11 / 24, 12);
    expect(scale.stepFrames(0.5, 10)).toBeCloseTo(22 / 24, 12);
    expect(scale.stepFrames(0, -1)).toBe(0);
    expect(scale.stepFrames(1.99, 10)).toBe(2);
    expect(scale.stepFrames(NaN, 1)).toBeCloseTo(1 / 24, 12);
  });
});
