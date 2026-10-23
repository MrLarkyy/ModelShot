import { el } from '../ui/dom';
import { SHORTCUTS } from './shortcutAction';

const VIEWPORT_KEYS: readonly [string, string][] = [
  ['Arrows', 'Orbit (in the 3D view)'],
  ['Shift+Arrows', 'Pan'],
  ['+ / -', 'Zoom'],
  ['0 / Home', 'Reset the view'],
  ['O', 'Perspective or orthographic'],
  ['I', 'Isometric view'],
];

// The shortcut list in a native dialog.
export class HelpDialog {
  constructor(private readonly dialog: HTMLDialogElement) {
    const rows = (entries: readonly [string, string][]): HTMLElement[] =>
      entries.flatMap(([keys, label]) => [el('dt', { text: keys }), el('dd', { text: label })]);
    const close = el('button', { text: 'Close', attributes: { type: 'button' } });
    close.addEventListener('click', () => this.close());
    dialog.replaceChildren(
      el('h2', { id: 'help-title', text: 'Keyboard shortcuts' }),
      el('h3', { text: 'Anywhere' }),
      el('dl', {}, rows(SHORTCUTS.map((s) => [s.keys, s.label]))),
      el('h3', { text: 'In the 3D view' }),
      el('dl', {}, rows(VIEWPORT_KEYS)),
      close,
    );
  }

  open(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }
}
