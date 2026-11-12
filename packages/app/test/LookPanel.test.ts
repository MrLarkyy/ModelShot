import { LOOK_PRESETS } from '@modelshot/looks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOK_DESCRIPTIONS, LookPanel } from '../src/panels/LookPanel';
import { SectionState } from '../src/ui/sectionState';
import { FakeElement, stubDom } from './fakeDom';

function setup(initial = 'studio') {
  stubDom();
  const root = new FakeElement('div');
  const onSelect = vi.fn();
  const adjust = { preview: vi.fn(), commit: vi.fn() };
  const panel = new LookPanel(root as unknown as HTMLElement, initial, onSelect, adjust, new SectionState(null));
  const cards = root.find((e) => e.className === 'look-card');
  return { panel, cards, onSelect, root, adjust };
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

  it('previews a grading slider while it moves and commits once when it is released', () => {
    const { root, adjust } = setup();
    const exposure = root.find((e) => e.tagName === 'input' && e.getAttribute('type') === 'range')[0] as FakeElement;
    exposure.value = '1.5';
    exposure.dispatch('input');
    exposure.value = '2';
    exposure.dispatch('input');
    expect(adjust.preview).toHaveBeenCalledTimes(2);
    expect(adjust.commit).not.toHaveBeenCalled();
    exposure.dispatch('change');
    expect(adjust.commit).toHaveBeenCalledTimes(1);
    expect(adjust.commit).toHaveBeenCalledWith({ exposure: 2, saturation: 1, backdrop: null });
  });

  it('shows an adjustment, offers Reset only while something is adjusted and resets with one commit', () => {
    const { panel, root, adjust } = setup();
    const reset = root.find((e) => e.tagName === 'button' && e.textContent === 'Reset adjustments')[0] as FakeElement;
    expect(reset.disabled).toBe(true);
    panel.show('studio', { exposure: -1, saturation: 0.5, backdrop: '#336699' });
    expect(reset.disabled).toBe(false);
    const colour = root.find((e) => e.getAttribute('type') === 'color')[0] as FakeElement;
    expect(colour.value).toBe('#336699');
    reset.dispatch('click');
    expect(adjust.commit).toHaveBeenCalledWith({ exposure: 0, saturation: 1, backdrop: null });
  });

  it('commits a backdrop colour chosen with the picker as the Colour backdrop', () => {
    const { root, adjust } = setup();
    const colour = root.find((e) => e.getAttribute('type') === 'color')[0] as FakeElement;
    colour.value = '#aabbcc';
    colour.dispatch('change');
    expect(adjust.commit).toHaveBeenCalledWith({ exposure: 0, saturation: 1, backdrop: '#aabbcc' });
  });
});
