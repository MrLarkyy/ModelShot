import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderPanel, SAMPLE_CHIPS } from '../src/panels/RenderPanel';
import { SectionState } from '../src/ui/sectionState';
import { FakeElement, stubDom } from './fakeDom';

const start = { samples: 256, supersample: 1, denoise: false };

function setup(initial = start) {
  stubDom();
  const root = new FakeElement('div');
  const onChange = vi.fn();
  const panel = new RenderPanel(root as unknown as HTMLElement, initial, onChange, new SectionState(null));
  const chips = root.find((e) => e.tagName === 'button' && SAMPLE_CHIPS.map(String).includes(e.textContent));
  const samples = root.find((e) => e.getAttribute('aria-label') === 'Samples')[0] as FakeElement;
  const radios = root.find((e) => e.getAttribute('type') === 'radio');
  const text = (): string => root.textContent;
  return { panel, root, chips, samples, radios, onChange, text };
}

describe('RenderPanel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('presses the chip that equals the sample count and none for another count', () => {
    const { chips, panel } = setup();
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    panel.show({ ...start, samples: 100 });
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
  });

  it('a chip sets the samples and reports one change', () => {
    const { chips, onChange, samples } = setup();
    chips[2]?.dispatch('click');
    expect(samples.value).toBe('1024');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ samples: 1024, supersample: 1, denoise: false });
  });

  it('clamps a typed count to 1..4096 and reads the checked supersampling', () => {
    const { panel, samples, radios } = setup();
    samples.value = '99999';
    expect(panel.values.samples).toBe(4096);
    samples.value = 'abc';
    expect(panel.values.samples).toBe(1);
    expect(radios).toHaveLength(4);
    panel.show({ ...start, supersample: 3 });
    expect(panel.values.supersample).toBe(3);
  });

  it('explains the two defaults and shows no estimate before a render finished', () => {
    const { panel, text } = setup();
    expect(text()).toContain('Render uses 256 samples by default for one still');
    panel.setContext({ width: 100, height: 50, last: null });
    expect(text()).toContain('100 × 50 px');
    expect(text()).toContain('No estimate before the first render.');
  });

  it('estimates from the last render and shows the traced size for supersampling', () => {
    const { panel, text } = setup({ ...start, supersample: 2 });
    panel.setContext({ width: 100, height: 50, last: { samples: 256, pixels: 5000, ms: 3000 } });
    expect(text()).toContain('traced at 200 × 100 px');
    expect(text()).toContain('About 0:12, estimated from your last render.');
  });
});
