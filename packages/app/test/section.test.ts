import { afterEach, describe, expect, it, vi } from 'vitest';
import { section } from '../src/ui/section';
import { MAX_SECTIONS_BYTES, SECTIONS_KEY, SectionState, parseSections } from '../src/ui/sectionState';
import { FakeElement, stubDom } from './fakeDom';

function backing(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

describe('parseSections', () => {
  it('opens everything for nothing, bad JSON, non-objects and oversized records', () => {
    expect(parseSections(null).size).toBe(0);
    expect(parseSections('{nope').size).toBe(0);
    expect(parseSections('[1]').size).toBe(0);
    expect(parseSections('7').size).toBe(0);
    const big = JSON.stringify({ 'object-state': false, pad: 'x'.repeat(MAX_SECTIONS_BYTES) });
    expect(parseSections(big).size).toBe(0);
  });

  it('keeps known sections stored closed, drops unknown keys and wrong types', () => {
    const closed = parseSections(
      JSON.stringify({ 'object-state': false, 'light-key': true, 'material-edges': 'no', evil: false }),
    );
    expect([...closed]).toEqual(['object-state']);
  });
});

describe('SectionState', () => {
  it('stores closed sections and reads them back', () => {
    const store = backing();
    const state = new SectionState(store);
    expect(state.isOpen('object-state')).toBe(true);
    state.set('object-state', false);
    expect(JSON.parse(store.data.get(SECTIONS_KEY) ?? '')).toEqual({ 'object-state': false });
    expect(new SectionState(store).isOpen('object-state')).toBe(false);
    state.set('object-state', true);
    expect(new SectionState(store).isOpen('object-state')).toBe(true);
  });

  it('keeps the choice for the session and tells once when the storage fails', () => {
    const notify = vi.fn();
    const failing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    const state = new SectionState(failing, notify);
    state.set('light-key', false);
    state.set('light-fill', false);
    expect(state.isOpen('light-key')).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('forgets everything on reset', () => {
    const store = backing({ [SECTIONS_KEY]: JSON.stringify({ 'light-key': false }) });
    const state = new SectionState(store);
    expect(state.isOpen('light-key')).toBe(false);
    state.reset();
    expect(state.isOpen('light-key')).toBe(true);
    expect(store.data.has(SECTIONS_KEY)).toBe(false);
  });
});

describe('section', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders a header button that controls a hidden-when-closed body', () => {
    stubDom();
    const state = new SectionState(backing({ [SECTIONS_KEY]: JSON.stringify({ 'object-transform': false }) }));
    const root = section('object-transform', 'Transform', [], state) as unknown as FakeElement;
    const [head, body] = root.children as FakeElement[];
    expect(head?.tagName).toBe('button');
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(head?.getAttribute('aria-controls')).toBe(body?.id);
    expect(body?.hidden).toBe(true);
    expect(head?.textContent).toBe('Transform');
  });

  it('toggles by click and remembers it', () => {
    stubDom();
    const state = new SectionState(backing());
    const root = section('object-state', 'State', [], state) as unknown as FakeElement;
    const [head, body] = root.children as FakeElement[];
    expect(body?.hidden).toBe(false);
    head?.dispatch('click');
    expect(head?.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);
    expect(state.isOpen('object-state')).toBe(false);
    head?.dispatch('click');
    expect(body?.hidden).toBe(false);
    expect(state.isOpen('object-state')).toBe(true);
  });
});
