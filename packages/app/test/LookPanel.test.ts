import { LOOK_PRESETS } from '@modelshot/looks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOK_DESCRIPTIONS, LookPanel } from '../src/panels/LookPanel';
import { FakeElement, stubDom } from './fakeDom';

function setup(initial = 'studio') {
  stubDom();
  const root = new FakeElement('div');
  const onSelect = vi.fn();
  const panel = new LookPanel(root as unknown as HTMLElement, initial, onSelect);
  const cards = root.find((e) => e.className === 'look-card');
  return { panel, cards, onSelect, root };
}

describe('LookPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('has a radio card per look in order, named by the look, with one line each', () => {
    const { cards, panel } = setup();
    expect(panel.ids).toEqual(Object.keys(LOOK_PRESETS));
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(Object.values(LOOK_PRESETS).map((p) => p.name));
    expect(cards.every((c) => c.getAttribute('role') === 'radio')).toBe(true);
    for (const id of Object.keys(LOOK_PRESETS)) expect(LOOK_DESCRIPTIONS[id]).toBeTruthy();
  });

  it('marks exactly the shown look and gives it the one tab stop', () => {
    const { cards, panel } = setup();
    panel.show('marketplace');
    expect(cards.map((c) => c.getAttribute('aria-checked'))).toEqual(
      Object.keys(LOOK_PRESETS).map((id) => String(id === 'marketplace')),
    );
    expect(cards.map((c) => c.tabIndex)).toEqual(
      Object.keys(LOOK_PRESETS).map((id) => (id === 'marketplace' ? 0 : -1)),
    );
  });

  it('selects by click and moves the choice with the arrows, wrapping', () => {
    const { cards, onSelect } = setup();
    cards[1]?.dispatch('click');
    expect(onSelect).toHaveBeenLastCalledWith(Object.keys(LOOK_PRESETS)[1]);
    cards[0]?.dispatch('keydown', { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith(Object.keys(LOOK_PRESETS).at(-1));
    cards[0]?.dispatch('keydown', { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith(Object.keys(LOOK_PRESETS)[1]);
    expect(cards[1]?.focused).toBe(true);
  });
});
