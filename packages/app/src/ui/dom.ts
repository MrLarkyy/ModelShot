type Child = Node | string;

interface ElementOptions {
  readonly id?: string;
  readonly className?: string;
  readonly text?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

// Builds an element with text through textContent only: file names and model names are user data, never markup.
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.id) element.id = options.id;
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

let counter = 0;

/** A label wrapping a control: `<label>text <control></label>`; the label text names the control for assistive tech. */
export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = el('label', { className: 'field' }, [el('span', { text }), control]);
  return label;
}

export function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`The page has no #${id} of the expected kind.`);
  return found;
}
