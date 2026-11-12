import { LOOK_PRESETS } from '@modelshot/looks';
import { srgbHex } from '../inspector/lightValues';
import { LOOK_ADJUST_LIMITS, NO_LOOK_ADJUST, isNeutral, type LookAdjust } from '../session/adjustLook';
import { el, uniqueId } from '../ui/dom';
import { icon } from '../ui/icon';
import { section } from '../ui/section';
import type { SectionState } from '../ui/sectionState';
import { lookSwatch } from './lookSwatch';

export interface LookAdjustHost {
  /** The user is dragging: show this adjustment, record nothing. */
  readonly preview: (adjust: LookAdjust) => void;
  /** The user finished a change: record one undo step and keep it with the model. */
  readonly commit: (adjust: LookAdjust) => void;
}

/** One line per shipped look; a look without an entry shows no line. */
export const LOOK_DESCRIPTIONS: Readonly<Record<string, string>> = {
  studio: 'Soft key light from above on a neutral dark backdrop.',
  marketplace: 'Bright, even light for product-style stills.',
  rim: 'A glowing edge line on a dark backdrop.',
  softbox: 'Lit by a studio image: broad, gentle shadows.',
};

// The look presets that ship, as radio cards (one tab stop, arrows move the choice); the choice is applied by the caller
// through `applyLook`. `show` marks the card of the look in use, whoever chose it (a card, the L key, Undo).
export class LookPanel {
  private readonly cards = new Map<string, HTMLButtonElement>();
  private readonly exposure: HTMLInputElement;
  private readonly exposureValue: HTMLSpanElement;
  private readonly saturation: HTMLInputElement;
  private readonly saturationValue: HTMLSpanElement;
  private readonly sceneBackdrop: HTMLInputElement;
  private readonly colourBackdrop: HTMLInputElement;
  private readonly colour: HTMLInputElement;
  private readonly reset: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    initial: string,
    private readonly onSelect: (id: string) => void,
    private readonly adjust: LookAdjustHost,
    sections: SectionState,
  ) {
    const ids = Object.keys(LOOK_PRESETS);
    const cards = Object.values(LOOK_PRESETS).map((preset) => {
      const describedBy = uniqueId('look-note');
      const swatch = el('span', { className: 'look-swatch', attributes: { 'aria-hidden': 'true' } });
      swatch.style.setProperty('background', lookSwatch(preset));
      const description = LOOK_DESCRIPTIONS[preset.id];
      const card = el(
        'button',
        {
          className: 'look-card',
          attributes: {
            type: 'button',
            role: 'radio',
            'aria-label': preset.name,
            'aria-checked': 'false',
            'data-look': preset.id,
            ...(description ? { 'aria-describedby': describedBy } : {}),
          },
        },
        [
          swatch,
          el('span', { className: 'look-card-text' }, [
            el('span', { className: 'look-card-name', text: preset.name }),
            ...(description ? [el('span', { id: describedBy, className: 'hint', text: description })] : []),
          ]),
          el('span', { className: 'look-card-check' }),
        ],
      );
      card.addEventListener('click', () => {
        // The card in use is already the choice: pressing it again must not drop an adjustment made on it.
        if (card.getAttribute('aria-checked') !== 'true') this.onSelect(preset.id);
      });
      card.addEventListener('keydown', (event) => {
        const step =
          event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -1
              : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = ids[(ids.indexOf(preset.id) + step + ids.length) % ids.length];
        if (!next) return;
        this.onSelect(next);
        this.cards.get(next)?.focus();
      });
      this.cards.set(preset.id, card);
      return card;
    });
    const head = el('div', { className: 'look-head' }, [
      el('span', { className: 'overline', text: 'Look preset' }),
      el('span', { className: 'hint' }, [el('kbd', { text: 'L' }), ' next look']),
    ]);
    const group = uniqueId('backdrop');
    const mode = (value: string, label: string): [HTMLInputElement, HTMLLabelElement] => {
      const input = el('input', {
        attributes: { type: 'radio', name: group, value, 'data-focus': `backdrop:${value}` },
      });
      input.addEventListener('change', () => {
        if (input.checked) this.adjust.commit(this.read());
      });
      return [input, el('label', { className: 'segment' }, [input, el('span', { text: label })])];
    };
    const [sceneInput, sceneLabel] = mode('scene', 'Scene');
    const [colourInput, colourLabel] = mode('colour', 'Colour');
    this.sceneBackdrop = sceneInput;
    this.colourBackdrop = colourInput;
    this.colour = el('input', {
      id: 'backdrop-colour',
      className: 'colour-input',
      attributes: { type: 'color', 'aria-label': 'Backdrop colour', 'data-focus': 'backdrop-colour' },
    });
    this.colour.addEventListener('input', () => {
      if (this.colourBackdrop.checked) this.adjust.preview(this.read());
    });
    this.colour.addEventListener('change', () => {
      this.colourBackdrop.checked = true;
      this.adjust.commit(this.read());
    });
    const slider = (
      label: string,
      limits: readonly [number, number],
      step: number,
    ): { readonly row: HTMLElement; readonly input: HTMLInputElement; readonly value: HTMLSpanElement } => {
      const id = uniqueId('grade');
      const input = el('input', {
        id,
        attributes: {
          type: 'range',
          min: String(limits[0]),
          max: String(limits[1]),
          step: String(step),
          'data-focus': id,
        },
      });
      const value = el('span', { className: 'slider-value', attributes: { 'aria-hidden': 'true' } });
      input.addEventListener('input', () => {
        this.paint();
        this.adjust.preview(this.read());
      });
      input.addEventListener('change', () => this.adjust.commit(this.read()));
      return {
        input,
        value,
        row: el('div', { className: 'field' }, [el('label', { text: label, attributes: { for: id } }), input, value]),
      };
    };
    const exposure = slider('Exposure', LOOK_ADJUST_LIMITS.exposure, 0.1);
    const saturation = slider('Saturation', LOOK_ADJUST_LIMITS.saturation, 0.05);
    this.exposure = exposure.input;
    this.exposureValue = exposure.value;
    this.saturation = saturation.input;
    this.saturationValue = saturation.value;
    this.reset = el('button', { className: 'small', text: 'Reset adjustments', attributes: { type: 'button' } });
    this.reset.addEventListener('click', () => this.adjust.commit(NO_LOOK_ADJUST));
    root.replaceChildren(
      head,
      el('div', { className: 'look-cards', attributes: { role: 'radiogroup', 'aria-label': 'Look preset' } }, cards),
      section(
        'look-backdrop',
        'Backdrop',
        [
          el('fieldset', { className: 'segmented', attributes: { 'aria-label': 'Backdrop' } }, [
            sceneLabel,
            colourLabel,
          ]),
          el('div', { className: 'field' }, [
            el('label', { text: 'Colour', attributes: { for: 'backdrop-colour' } }),
            this.colour,
          ]),
        ],
        sections,
      ),
      section('look-grading', 'Grading', [exposure.row, saturation.row, this.reset], sections),
    );
    this.show(initial);
  }

  /** The look ids in display order. */
  get ids(): string[] {
    return [...this.cards.keys()];
  }

  // What the controls hold, as a look adjustment.
  private read(): LookAdjust {
    return {
      exposure: Math.round(Number(this.exposure.value) * 100) / 100,
      saturation: Math.round(Number(this.saturation.value) * 100) / 100,
      backdrop: this.colourBackdrop.checked ? this.colour.value : null,
    };
  }

  private paint(): void {
    const { exposure, saturation } = this.read();
    this.exposureValue.textContent = `${exposure > 0 ? '+' : ''}${exposure.toFixed(1)} EV`;
    this.saturationValue.textContent = `${Math.round(saturation * 100)} %`;
    this.exposure.setAttribute('aria-valuetext', this.exposureValue.textContent);
    this.saturation.setAttribute('aria-valuetext', this.saturationValue.textContent);
  }

  show(id: string, adjust: LookAdjust = NO_LOOK_ADJUST): void {
    for (const [key, card] of this.cards) {
      const on = key === id;
      card.setAttribute('aria-checked', String(on));
      card.tabIndex = on ? 0 : -1;
      card.querySelector('.look-card-check')?.replaceChildren(...(on ? [icon('check', { size: 14 })] : []));
    }
    const preset = Object.hasOwn(LOOK_PRESETS, id) ? LOOK_PRESETS[id] : undefined;
    this.exposure.value = String(adjust.exposure);
    this.saturation.value = String(adjust.saturation);
    this.colour.value = adjust.backdrop ?? (preset ? srgbHex(preset.backdrop.top) : this.colour.value);
    this.sceneBackdrop.checked = adjust.backdrop === null;
    this.colourBackdrop.checked = adjust.backdrop !== null;
    this.reset.disabled = isNeutral(adjust);
    this.paint();
  }
}
