import { MAX_SUPERSAMPLE_CHOICE, type RenderSettingsValues } from '../render/RenderSettings';
import { el, labelled } from '../ui/dom';

const MAX_SAMPLES = 4096;

// Samples, supersampling and denoise of the Render button.
export class RenderPanel {
  private readonly samples: HTMLInputElement;
  private readonly supersample: HTMLSelectElement;
  private readonly denoise: HTMLInputElement;

  constructor(
    root: HTMLElement,
    initial: RenderSettingsValues,
    private readonly onChange: (settings: RenderSettingsValues) => void,
  ) {
    this.samples = el('input', {
      attributes: { type: 'number', min: '1', max: String(MAX_SAMPLES), step: '1', inputmode: 'numeric' },
    });
    this.supersample = el(
      'select',
      {},
      Array.from({ length: MAX_SUPERSAMPLE_CHOICE }, (_, i) =>
        el('option', { text: `${i + 1}×`, attributes: { value: String(i + 1) } }),
      ),
    );
    this.denoise = el('input', { attributes: { type: 'checkbox' } });
    for (const control of [this.samples, this.supersample, this.denoise]) {
      control.addEventListener('change', () => this.report());
    }
    root.replaceChildren(
      labelled('Samples', this.samples),
      labelled('Supersampling', this.supersample),
      el('label', { className: 'choice' }, [this.denoise, el('span', { text: 'Denoise' })]),
    );
    this.show(initial);
  }

  show(settings: RenderSettingsValues): void {
    this.samples.value = String(settings.samples);
    this.supersample.value = String(settings.supersample);
    this.denoise.checked = settings.denoise;
  }

  get values(): RenderSettingsValues {
    const samples = Math.round(Number(this.samples.value));
    return {
      samples: Number.isFinite(samples) ? Math.min(MAX_SAMPLES, Math.max(1, samples)) : 1,
      supersample: Number(this.supersample.value) || 1,
      denoise: this.denoise.checked,
    };
  }

  private report(): void {
    const values = this.values;
    this.show(values);
    this.onChange(values);
  }
}
