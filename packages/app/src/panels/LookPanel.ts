import { LOOK_PRESETS } from '@modelshot/looks';
import { el, uniqueId } from '../ui/dom';

// The look presets that ship, as radios; the choice is applied by the caller through `applyLook`.
export class LookPanel {
  private readonly inputs = new Map<string, HTMLInputElement>();

  constructor(
    root: HTMLElement,
    initial: string,
    private readonly onSelect: (id: string) => void,
  ) {
    const group = uniqueId('look');
    const choices = Object.values(LOOK_PRESETS).map((preset) => {
      const input = el('input', { attributes: { type: 'radio', name: group, value: preset.id } });
      input.addEventListener('change', () => {
        if (input.checked) this.onSelect(preset.id);
      });
      this.inputs.set(preset.id, input);
      return el('label', { className: 'choice' }, [input, el('span', { text: preset.name })]);
    });
    root.replaceChildren(el('fieldset', {}, [el('legend', { text: 'Look preset' }), ...choices]));
    this.show(initial);
  }

  /** The look ids in display order. */
  get ids(): string[] {
    return [...this.inputs.keys()];
  }

  show(id: string): void {
    for (const [key, input] of this.inputs) input.checked = key === id;
  }
}
