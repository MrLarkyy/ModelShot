import { estimateRenderMs, estimateText, type RenderTiming } from '../render/estimateRenderMs';
import { MAX_SUPERSAMPLE_CHOICE, type RenderSettingsValues } from '../render/RenderSettings';
import { samplesNote } from '../render/samplesNote';
import { el, uniqueId } from '../ui/dom';
import { section } from '../ui/section';
import type { SectionState } from '../ui/sectionState';

const MAX_SAMPLES = 4096;

/** The sample counts offered as one-press choices. */
export const SAMPLE_CHIPS: readonly number[] = [64, 256, 1024];

/** The view the Render button draws, and the last finished render, for the Output readout. */
export interface RenderContext {
  readonly width: number;
  readonly height: number;
  readonly last: RenderTiming | null;
}

// Quality (samples, supersampling, denoise) and Output (the size it renders at and a time estimate) of the Render button.
export class RenderPanel {
  private readonly samples: HTMLInputElement;
  private readonly chips = new Map<number, HTMLButtonElement>();
  private readonly supersample: HTMLInputElement[] = [];
  private readonly denoise: HTMLInputElement;
  private readonly size = el('p', { className: 'hint' });
  private readonly estimate = el('p', { className: 'hint' });
  private context: RenderContext | null = null;

  constructor(
    root: HTMLElement,
    initial: RenderSettingsValues,
    private readonly onChange: (settings: RenderSettingsValues) => void,
    sections: SectionState,
  ) {
    this.samples = el('input', {
      attributes: {
        type: 'number',
        min: '1',
        max: String(MAX_SAMPLES),
        step: '1',
        inputmode: 'numeric',
        'aria-label': 'Samples',
        'data-focus': 'samples',
      },
    });
    this.samples.addEventListener('change', () => this.report());
    const chips = SAMPLE_CHIPS.map((count) => {
      const chip = el('button', {
        className: 'small',
        text: String(count),
        attributes: {
          type: 'button',
          'aria-pressed': 'false',
          title: `${count} samples`,
          'data-focus': `chip:${count}`,
        },
      });
      chip.addEventListener('click', () => {
        this.samples.value = String(count);
        this.report();
      });
      this.chips.set(count, chip);
      return chip;
    });
    const group = uniqueId('supersample');
    const choices = Array.from({ length: MAX_SUPERSAMPLE_CHOICE }, (_, i) => {
      const input = el('input', {
        attributes: {
          type: 'radio',
          name: group,
          value: String(i + 1),
          'aria-label': `Supersampling ${i + 1}×`,
          'data-focus': `ss:${i + 1}`,
        },
      });
      input.addEventListener('change', () => {
        if (input.checked) this.report();
      });
      this.supersample.push(input);
      return el('label', { className: 'segment' }, [input, el('span', { text: `${i + 1}×` })]);
    });
    this.denoise = el('input', { attributes: { type: 'checkbox', 'data-focus': 'denoise' } });
    this.denoise.addEventListener('change', () => this.report());
    root.replaceChildren(
      section(
        'render-quality',
        'Quality',
        [
          el('div', { className: 'field' }, [
            el('span', { text: 'Samples' }),
            el('div', { className: 'button-row' }, chips),
            this.samples,
          ]),
          el('div', { className: 'field' }, [
            el('span', { text: 'Supersampling' }),
            el('fieldset', { className: 'segmented', attributes: { 'aria-label': 'Supersampling' } }, choices),
          ]),
          el('label', { className: 'toggle-row' }, [el('span', { text: 'Denoise' }), this.denoise]),
          el('p', { className: 'hint', text: samplesNote() }),
        ],
        sections,
      ),
      section('render-output', 'Output', [this.size, this.estimate], sections),
    );
    this.show(initial);
  }

  show(settings: RenderSettingsValues): void {
    this.samples.value = String(settings.samples);
    for (const input of this.supersample) input.checked = Number(input.value) === settings.supersample;
    this.denoise.checked = settings.denoise;
    for (const [count, chip] of this.chips) chip.setAttribute('aria-pressed', String(count === settings.samples));
    this.paint();
  }

  /** The size of the view and the last render, for the Output section. */
  setContext(context: RenderContext | null): void {
    this.context = context;
    this.paint();
  }

  get values(): RenderSettingsValues {
    const samples = Math.round(Number(this.samples.value));
    return {
      samples: Number.isFinite(samples) ? Math.min(MAX_SAMPLES, Math.max(1, samples)) : 1,
      supersample: Number(this.supersample.find((input) => input.checked)?.value) || 1,
      denoise: this.denoise.checked,
    };
  }

  private paint(): void {
    const context = this.context;
    if (!context || !(context.width > 0) || !(context.height > 0)) {
      this.size.textContent = 'Open a model to see the render size.';
      this.estimate.textContent = '';
      return;
    }
    const { supersample, samples } = this.values;
    this.size.textContent =
      supersample > 1
        ? `${context.width} × ${context.height} px, traced at ${context.width * supersample} × ${context.height * supersample} px and scaled down.`
        : `${context.width} × ${context.height} px, the size of the 3D view.`;
    const pixels = context.width * context.height * supersample * supersample;
    this.estimate.textContent = estimateText(estimateRenderMs(context.last, { samples, pixels }));
  }

  private report(): void {
    const values = this.values;
    this.show(values);
    this.onChange(values);
  }
}
