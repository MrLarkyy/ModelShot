import { bindDisclosure } from './bindDisclosure';
import { byId } from './dom';
import { keyNames } from '../shortcuts/keycaps';
import { SHORTCUTS, type ShortcutAction } from '../shortcuts/shortcutAction';
import { applyShortcutHint } from '../shortcuts/shortcutHint';
import { icon, type IconName } from './icon';

const ICON_BUTTONS: readonly (readonly [id: string, name: IconName])[] = [
  ['undo-button', 'undo'],
  ['redo-button', 'redo'],
  ['outliner-toggle', 'panel-left'],
  ['inspector-toggle', 'panel-right'],
  ['timeline-toggle', 'panel-bottom'],
  ['bar-more-button', 'more'],
  ['help-open', 'help'],
  ['alert-close', 'close'],
  ['storage-close', 'close'],
];

// Static buttons that carry a shortcut: id and action; the label is the button's own.
const HINTED: readonly (readonly [id: string, action: ShortcutAction])[] = [
  ['undo-button', 'undo'],
  ['redo-button', 'redo'],
  ['outliner-toggle', 'outliner'],
  ['inspector-toggle', 'inspector'],
  ['timeline-toggle', 'timeline'],
  ['render-button', 'render'],
  ['export-button', 'export'],
  ['menu-export-button', 'export'],
  ['open-button', 'open'],
  ['empty-open', 'open'],
  ['help-open', 'help'],
];

/** The shortcut keys of the menu items and the buttons, read from the shortcut list. */
export function hintStaticControls(root: ParentNode = document): void {
  for (const [id, action] of HINTED) {
    const button = byId(id, HTMLButtonElement);
    applyShortcutHint(button, action, button.getAttribute('aria-label') ?? button.firstChild?.textContent?.trim());
  }
  for (const kbd of root.querySelectorAll<HTMLElement>('kbd[data-shortcut]')) {
    const binding = SHORTCUTS.find((s) => s.action === kbd.dataset['shortcut'])?.bindings[0];
    if (binding) kbd.textContent = keyNames(binding).join('+');
  }
}

/** Puts the icons on the static top-bar buttons and binds the More list that holds the groups below 900 px. */
export function bindTopBar(): void {
  for (const [id, name] of ICON_BUTTONS) byId(id, HTMLButtonElement).append(icon(name));
  hintStaticControls();
  const overflow = byId('bar-overflow', HTMLElement);
  // Closed at first; the stylesheet shows the group inline from 900 px up whatever this says.
  overflow.hidden = true;
  // Opening moves the focus into the list, and Escape gives it back to the button.
  bindDisclosure(byId('bar-more-button', HTMLButtonElement), overflow, { focusFirst: true });
}
