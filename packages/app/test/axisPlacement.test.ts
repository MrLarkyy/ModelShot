import { describe, expect, it } from 'vitest';
import { AXIS_BOX_PX, placeAxisBox, type PlacedBox } from '../src/viewport/axisPlacement';

const boxOf = (height: number, insets: { left: number; bottom: number }): PlacedBox => ({
  left: insets.left,
  right: insets.left + AXIS_BOX_PX,
  top: height - insets.bottom - AXIS_BOX_PX,
  bottom: height - insets.bottom,
});
const overlaps = (a: PlacedBox, b: PlacedBox): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('placeAxisBox', () => {
  it('stands in the bottom-left corner when nothing is in the way', () => {
    expect(placeAxisBox(800, 600, [])).toEqual({ left: 12, bottom: 12 });
  });

  it('rises above a render bar at the bottom', () => {
    const bar: PlacedBox = { left: 20, right: 360, top: 520, bottom: 580 };
    const insets = placeAxisBox(375, 600, [bar]);
    expect(overlaps(boxOf(600, insets), bar)).toBe(false);
    expect(insets.bottom).toBeGreaterThan(60);
  });

  it('moves right of a rail at the top left', () => {
    const rail: PlacedBox = { left: 8, right: 52, top: 8, bottom: 104 };
    const insets = placeAxisBox(375, 150, [rail]);
    expect(overlaps(boxOf(150, insets), rail)).toBe(false);
  });

  it('keeps the box inside a tiny view', () => {
    const insets = placeAxisBox(40, 40, [{ left: 0, right: 40, top: 0, bottom: 40 }]);
    expect(insets.left).toBeGreaterThanOrEqual(0);
    expect(insets.bottom).toBeGreaterThanOrEqual(0);
  });
});
