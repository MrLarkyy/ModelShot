import { shortcutAction, type ShortcutAction } from './shortcutAction';

const TYPING = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const ACTIVATES_ON_SPACE = new Set(['BUTTON', 'A', 'SUMMARY']);

// Inputs that take no text: the shortcuts (Undo among them) keep working on a focused slider, checkbox or radio.
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'image']);

function nonTextInput(target: HTMLElement): boolean {
  return target.tagName === 'INPUT' && NON_TEXT_INPUTS.has((target.getAttribute('type') ?? 'text').toLowerCase());
}

/** Whether keys typed at `target` belong to a field that edits text (or a list), not to a shortcut. */
export function inTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (nonTextInput(target)) return false;
  return TYPING.has(target.tagName) || target.isContentEditable;
}

// Space belongs to a focused button, link, tab or separator (it presses or moves it), not to play and pause.
function keepsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ACTIVATES_ON_SPACE.has(target.tagName) ||
    nonTextInput(target) ||
    ['separator', 'tab', 'slider'].includes(target.getAttribute('role') ?? '')
  );
}

// Document-wide shortcuts. Ignored while typing in a field and while a dialog is open (the dialog has its own keys);
// a handled key's default (the browser's Open dialog for Ctrl+O) is prevented.
export function bindShortcuts(target: Document, handlers: Readonly<Record<ShortcutAction, () => void>>): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (inTypingTarget(event.target) || target.querySelector('dialog[open]')) return;
    const action = shortcutAction(event);
    if (!action) return;
    if (action === 'playPause' && keepsSpace(event.target)) return;
    event.preventDefault();
    handlers[action]();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
