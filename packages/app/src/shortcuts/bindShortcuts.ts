import { shortcutAction, type ShortcutAction } from './shortcutAction';

const TYPING = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

function inTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return TYPING.has(target.tagName) || target.isContentEditable;
}

// Document-wide shortcuts. Ignored while typing in a field and while a dialog is open (the dialog has its own keys);
// a handled key's default (the browser's Open dialog for Ctrl+O) is prevented.
export function bindShortcuts(target: Document, handlers: Readonly<Record<ShortcutAction, () => void>>): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (inTypingTarget(event.target) || target.querySelector('dialog[open]')) return;
    const action = shortcutAction(event);
    if (!action) return;
    event.preventDefault();
    handlers[action]();
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
