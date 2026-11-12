import type { HintStore } from '../state/HintStore';
import { SHORTCUTS, type ShortcutAction } from '../shortcuts/shortcutAction';
import { el } from './dom';
import { iconButton } from './iconButton';

const SHOWN: readonly ShortcutAction[] = ['open', 'render', 'export', 'front', 'side', 'help'];

/** The key and label pairs of the hint row, taken from the shortcut list so they cannot drift from it. */
export function hintItems(): { readonly keys: string; readonly label: string }[] {
  return SHOWN.flatMap((action) => {
    const shortcut = SHORTCUTS.find((candidate) => candidate.action === action);
    return shortcut ? [{ keys: shortcut.keys, label: shortcut.label }] : [];
  });
}

// A one-time row over the view after the first model opens: the keys worth knowing, dismissed for good with its close
// button. Text only; nothing leaves the page.
export class FirstRunHint {
  constructor(
    private readonly host: HTMLElement,
    private readonly store: HintStore,
    private readonly onDismiss: () => void,
  ) {
    const close = iconButton('close', 'Dismiss shortcut hints', { small: true });
    close.addEventListener('click', () => this.dismiss());
    const items = hintItems().map(({ keys, label }) =>
      el('li', {}, [el('kbd', { text: keys }), el('span', { text: ` ${label}` })]),
    );
    items.push(el('li', { text: 'Drag to orbit, scroll to zoom' }));
    host.replaceChildren(el('ul', { className: 'hint-list' }, items), close);
  }

  /** Shown unless it was dismissed before. */
  show(): void {
    this.host.hidden = this.store.dismissed;
  }

  hide(): void {
    this.host.hidden = true;
  }

  private dismiss(): void {
    this.store.dismiss();
    this.host.hidden = true;
    this.onDismiss();
  }
}
