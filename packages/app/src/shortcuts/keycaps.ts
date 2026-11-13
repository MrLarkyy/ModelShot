import { el } from '../ui/dom';
import { bindingText, type KeyBinding } from './shortcutAction';

/** Whether the platform's own key is Cmd (Apple) rather than Ctrl. */
export function isApplePlatform(platform: string = navigator.platform): boolean {
  return /^(Mac|iPhone|iPad|iPod)/.test(platform);
}

/** The key names of one binding, `Cmd` shown as the platform's own: "Ctrl", "Shift", "Z". */
export function keyNames(binding: KeyBinding, apple = isApplePlatform()): string[] {
  const names: string[] = [];
  if (binding.mod === 'ctrlOrMeta') names.push(apple ? '⌘' : 'Ctrl');
  else if (binding.mod === 'ctrl') names.push('Ctrl');
  if (binding.shift === true) names.push('Shift');
  names.push(bindingText({ key: binding.key }));
  return names;
}

/** One `<kbd class="keycap">` per key of the binding, in a `span.keycaps`. */
export function keycaps(binding: KeyBinding, apple = isApplePlatform()): HTMLSpanElement {
  return el(
    'span',
    { className: 'keycaps' },
    keyNames(binding, apple).map((name) => el('kbd', { className: 'keycap', text: name })),
  );
}
