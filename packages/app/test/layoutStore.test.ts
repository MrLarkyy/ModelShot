import { describe, expect, it, vi } from 'vitest';
import { LAYOUT_KEY, LayoutStore } from '../src/layout/LayoutStore';
import { DEFAULT_LAYOUT, PANEL_LIMITS } from '../src/layout/layoutState';
import { MAX_LAYOUT_BYTES, parseLayout } from '../src/layout/parseLayout';

function backing(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

describe('parseLayout', () => {
  it('gives the defaults for nothing, bad JSON and non-objects', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{nope')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('[1,2]')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('7')).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps sizes to their ranges and ignores values that are not finite numbers', () => {
    const layout = parseLayout(JSON.stringify({ outlinerPx: 5, inspectorPx: 99999, timelinePx: 'wide' }));
    expect(layout.outlinerPx).toBe(PANEL_LIMITS.outlinerPx[0]);
    expect(layout.inspectorPx).toBe(PANEL_LIMITS.inspectorPx[1]);
    expect(layout.timelinePx).toBe(DEFAULT_LAYOUT.timelinePx);
  });

  it('keeps known flags and the tab, drops unknown keys and wrong types', () => {
    const layout = parseLayout(
      JSON.stringify({
        collapsed: { outliner: true, inspector: 'yes', extra: true },
        overlays: { grid: false, stats: true },
        tab: 'material',
        evil: 1,
      }),
    );
    expect(layout.collapsed).toEqual({ outliner: true, inspector: false, timeline: false });
    expect(layout.overlays).toEqual({ ...DEFAULT_LAYOUT.overlays, grid: false, stats: true });
    expect(layout.tab).toBe('material');
    expect(Object.keys(layout)).not.toContain('evil');
    expect(parseLayout(JSON.stringify({ tab: 'nope' })).tab).toBe(DEFAULT_LAYOUT.tab);
  });

  it('ignores a record larger than the limit', () => {
    const big = JSON.stringify({ outlinerPx: 300, pad: 'x'.repeat(MAX_LAYOUT_BYTES) });
    expect(parseLayout(big)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('LayoutStore', () => {
  it('reads the stored layout, writes updates and tells listeners', () => {
    const storage = backing({ [LAYOUT_KEY]: JSON.stringify({ outlinerPx: 300 }) });
    const store = new LayoutStore(storage);
    expect(store.state.outlinerPx).toBe(300);
    const seen = vi.fn();
    store.onChange(seen);
    store.update({ inspectorPx: 400 });
    expect(JSON.parse(storage.data.get(LAYOUT_KEY) ?? '{}')).toMatchObject({ outlinerPx: 300, inspectorPx: 400 });
    expect(seen).toHaveBeenCalledOnce();
  });

  it('keeps working and tells once when storage throws', () => {
    const notify = vi.fn();
    const storage = backing();
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const store = new LayoutStore(storage, notify);
    store.update({ timelinePx: 200 });
    store.update({ timelinePx: 210 });
    expect(store.state.timelinePx).toBe(210);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('starts with the defaults without storage or when reading throws', () => {
    expect(new LayoutStore(null).state).toEqual(DEFAULT_LAYOUT);
    const storage = backing();
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(new LayoutStore(storage).state).toEqual(DEFAULT_LAYOUT);
  });

  it('reset removes the stored record and restores the defaults', () => {
    const storage = backing({ [LAYOUT_KEY]: JSON.stringify({ outlinerPx: 300 }) });
    const store = new LayoutStore(storage);
    store.reset();
    expect(storage.data.has(LAYOUT_KEY)).toBe(false);
    expect(store.state).toEqual(DEFAULT_LAYOUT);
  });
});
