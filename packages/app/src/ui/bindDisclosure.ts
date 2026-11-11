// A button that shows and hides a list of buttons next to it: `aria-expanded` and `aria-controls` on the button, Escape
// and a click or focus outside close it and give the focus back. A disclosure, not an ARIA menu: Tab moves through the
// items like through any buttons.
export function bindDisclosure(
  button: HTMLButtonElement,
  list: HTMLElement,
  options: { readonly focusFirst?: boolean } = {},
): () => void {
  const set = (open: boolean, restoreFocus = false): void => {
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open && options.focusFirst)
      list.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus();
    if (!open && restoreFocus) button.focus();
  };
  button.addEventListener('click', () => set(list.hidden !== false));
  list.addEventListener('click', (event) => {
    // A list of controls that stay open (More) is operated item after item; a menu of actions closes on the one chosen.
    if (!options.focusFirst && event.target instanceof HTMLButtonElement && !event.target.disabled) set(false);
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !list.hidden) {
      event.stopPropagation();
      set(false, true);
    }
  };
  const onOutside = (event: Event): void => {
    if (list.hidden || !(event.target instanceof Node)) return;
    if (!list.contains(event.target) && !button.contains(event.target)) set(false);
  };
  button.addEventListener('keydown', onKey);
  list.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('focusin', onOutside);
  return () => {
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('focusin', onOutside);
  };
}
