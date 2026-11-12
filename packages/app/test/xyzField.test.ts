import { afterEach, describe, expect, it, vi } from 'vitest';
import { xyzField } from '../src/ui/xyzField';
import { FakeElement, stubDom } from './fakeDom';

function setup(extra: Partial<Parameters<typeof xyzField>[0]> = {}) {
  stubDom();
  const commit = vi.fn();
  const field = xyzField({ label: 'Position', values: [1, 2, 3], unit: 'px', step: 0.5, commit, ...extra });
  const inputs = field.inputs as unknown as FakeElement[];
  const root = field.element as unknown as FakeElement;
  const letter = (axis: string): FakeElement =>
    root.find((e) => e.className.includes('xyz-axis') && e.textContent === axis)[0] as FakeElement;
  const hint = root.find((e) => e.className === 'xyz-hint')[0] as FakeElement;
  return { commit, inputs, letter, hint };
}

describe('xyzField', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('labels each input with the row label and the axis and shows the unit', () => {
    const { inputs } = setup();
    expect(inputs.map((i) => i.getAttribute('aria-label'))).toEqual(['Position X', 'Position Y', 'Position Z']);
    expect(inputs.map((i) => i.value)).toEqual(['1', '2', '3']);
    expect(inputs[0]?.getAttribute('inputmode')).toBe('decimal');
  });

  it('steps with the arrows, ten times with Shift and a tenth with Alt, one commit per press', () => {
    const { commit, inputs } = setup();
    inputs[0]?.dispatch('keydown', { key: 'ArrowUp' });
    expect(commit).toHaveBeenLastCalledWith([1.5, 2, 3]);
    inputs[1]?.dispatch('keydown', { key: 'ArrowDown', shiftKey: true });
    expect(commit).toHaveBeenLastCalledWith([1.5, -3, 3]);
    inputs[2]?.dispatch('keydown', { key: 'ArrowUp', altKey: true });
    expect(commit).toHaveBeenLastCalledWith([1.5, -3, 3.05]);
    expect(commit).toHaveBeenCalledTimes(3);
    expect(inputs[2]?.value).toBe('3.05');
  });

  it('commits a typed value on change', () => {
    const { commit, inputs } = setup();
    if (inputs[1]) inputs[1].value = '7,25';
    inputs[1]?.dispatch('change');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([1, 7.25, 3]);
  });

  it('reverts and flags a value that is not a number or out of range, without a commit', () => {
    const { commit, inputs, hint } = setup({ min: -10, max: 10 });
    for (const bad of ['abc', '', '11', 'Infinity', '1e999']) {
      if (inputs[0]) inputs[0].value = bad;
      inputs[0]?.dispatch('change');
      expect(inputs[0]?.value).toBe('1');
      expect(inputs[0]?.getAttribute('aria-invalid')).toBe('true');
      expect(hint.hidden).toBe(false);
    }
    expect(commit).not.toHaveBeenCalled();
    if (inputs[0]) inputs[0].value = '4';
    inputs[0]?.dispatch('change');
    expect(commit).toHaveBeenCalledWith([4, 2, 3]);
    expect(inputs[0]?.getAttribute('aria-invalid')).toBeNull();
    expect(hint.hidden).toBe(true);
  });

  it('refuses an arrow step past the limit', () => {
    const { commit, inputs } = setup({ values: [10, 0, 0], max: 10 });
    inputs[0]?.dispatch('keydown', { key: 'ArrowUp' });
    expect(commit).not.toHaveBeenCalled();
    expect(inputs[0]?.getAttribute('aria-invalid')).toBe('true');
  });

  it('scrubs by dragging an axis letter and commits once on release', () => {
    const { commit, inputs, letter } = setup();
    const x = letter('X');
    x.dispatch('pointerdown', { pointerId: 4, clientX: 100 });
    expect(x.captured.has(4)).toBe(true);
    x.dispatch('pointermove', { pointerId: 4, clientX: 104 });
    x.dispatch('pointermove', { pointerId: 4, clientX: 110 });
    expect(inputs[0]?.value).toBe('6');
    expect(commit).not.toHaveBeenCalled();
    x.dispatch('pointerup', { pointerId: 4, clientX: 110 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([6, 2, 3]);
    expect(x.captured.has(4)).toBe(false);
  });

  it('commits nothing for a click on a letter without movement', () => {
    const { commit, letter } = setup();
    const y = letter('Y');
    y.dispatch('pointerdown', { pointerId: 1, clientX: 5 });
    y.dispatch('pointerup', { pointerId: 1, clientX: 5 });
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels a scrub with Escape and restores the value', () => {
    const { commit, inputs, letter } = setup();
    const z = letter('Z');
    z.dispatch('pointerdown', { pointerId: 2, clientX: 0 });
    z.dispatch('pointermove', { pointerId: 2, clientX: 40 });
    expect(inputs[2]?.value).toBe('23');
    inputs[2]?.dispatch('keydown', { key: 'Escape' });
    expect(inputs[2]?.value).toBe('3');
    z.dispatch('pointerup', { pointerId: 2, clientX: 40 });
    expect(commit).not.toHaveBeenCalled();
  });

  it('is inert when disabled or read-only', () => {
    for (const extra of [{ disabled: true }, { readOnly: true }]) {
      const { commit, inputs, letter } = setup(extra);
      inputs[0]?.dispatch('keydown', { key: 'ArrowUp' });
      letter('X').dispatch('pointerdown', { pointerId: 1, clientX: 0 });
      expect(commit).not.toHaveBeenCalled();
      expect(inputs[0]?.disabled || (inputs[0] as unknown as { readOnly: boolean }).readOnly).toBe(true);
    }
  });
});
