import { icon, type IconName } from './icon';

interface IconButtonOptions {
  /** The 26 px size for dense rows. */
  readonly small?: boolean;
  /** A toggle: sets `aria-pressed`. */
  readonly pressed?: boolean;
}

/** A button with only an icon; the label is its accessible name and its tooltip. */
export function iconButton(name: IconName, label: string, options: IconButtonOptions = {}): HTMLButtonElement {
  if (label.trim() === '') throw new Error('An icon-only button needs a label.');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = options.small ? 'icon-button small' : 'icon-button';
  button.setAttribute('aria-label', label);
  button.title = label;
  if (options.pressed !== undefined) button.setAttribute('aria-pressed', String(options.pressed));
  button.append(icon(name, { size: options.small ? 14 : 16 }));
  return button;
}
