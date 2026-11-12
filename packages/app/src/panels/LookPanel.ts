import { LOOK_PRESETS } from '@modelshot/looks';
import { el, uniqueId } from '../ui/dom';
import { icon } from '../ui/icon';
import { lookSwatch } from './lookSwatch';

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

  constructor(
    root: HTMLElement,
    initial: string,
    private readonly onSelect: (id: string) => void,
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
      card.addEventListener('click', () => this.onSelect(preset.id));
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
    root.replaceChildren(
      head,
      el('div', { className: 'look-cards', attributes: { role: 'radiogroup', 'aria-label': 'Look preset' } }, cards),
    );
    this.show(initial);
  }

  /** The look ids in display order. */
  get ids(): string[] {
    return [...this.cards.keys()];
  }

  show(id: string): void {
    for (const [key, card] of this.cards) {
      const on = key === id;
      card.setAttribute('aria-checked', String(on));
      card.tabIndex = on ? 0 : -1;
      card.querySelector('.look-card-check')?.replaceChildren(...(on ? [icon('check', { size: 14 })] : []));
    }
  }
}
