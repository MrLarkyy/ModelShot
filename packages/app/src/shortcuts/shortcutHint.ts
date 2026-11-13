import { bindingText, SHORTCUTS, type KeyBinding, type ShortcutAction } from './shortcutAction';

function ariaKey(binding: KeyBinding): string[] {
  const name = binding.key === ' ' ? 'Space' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  const shift = binding.shift === true ? 'Shift+' : '';
  if (binding.mod === 'ctrlOrMeta') return [`Control+${shift}${name}`, `Meta+${shift}${name}`];
  return [binding.mod === 'ctrl' ? `Control+${shift}${name}` : `${shift}${name}`];
}

/** The `aria-keyshortcuts` value of an action: "Control+O Meta+O". */
export function ariaKeyShortcuts(action: ShortcutAction): string {
  const shortcut = SHORTCUTS.find((candidate) => candidate.action === action);
  return shortcut ? shortcut.bindings.flatMap(ariaKey).join(' ') : '';
}

/** "Label (keys)" for a tooltip. */
export function hintText(label: string, action: ShortcutAction): string {
  const shortcut = SHORTCUTS.find((candidate) => candidate.action === action);
  return shortcut ? `${label} (${shortcut.bindings.map(bindingText).join(' / ')})` : label;
}

/**
 * Gives a control its shortcut: the title, which is also its accessible description (the accessible name stays the
 * plain label), and `aria-keyshortcuts`.
 */
export function applyShortcutHint(element: HTMLElement, action: ShortcutAction, label?: string): void {
  const text = label ?? element.getAttribute('aria-label') ?? element.textContent.trim();
  element.title = hintText(text, action);
  element.setAttribute('aria-keyshortcuts', ariaKeyShortcuts(action));
}
