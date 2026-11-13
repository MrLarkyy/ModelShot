import { vi } from 'vitest';

type Listener = (event: Record<string, unknown>) => void;

// Just enough of an element for the timeline to follow what the timeline keeps in its panel: the child tree, text, attributes, classes
// and listeners.
export class TimelineElement {
  id = '';
  className = '';
  title = '';
  type = '';
  textContent = '';
  disabled = false;
  value = '';
  max = '';
  tabIndex = 0;
  offsetTop = 0;
  offsetHeight = 0;
  offsetWidth = 0;
  clientWidth = 0;
  clientHeight = 0;
  scrollLeft = 0;
  scrollTop = 0;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  children: TimelineElement[] = [];
  mutations = 0;
  private parent: TimelineElement | null = null;

  constructor(readonly tag = 'div') {}

  readonly classList = {
    add: (name: string): void => {
      if (!this.hasClass(name)) this.className = `${this.className} ${name}`.trim();
    },
    toggle: (name: string, force?: boolean): void => {
      const on = force ?? !this.hasClass(name);
      const rest = this.className.split(' ').filter((part) => part !== name && part !== '');
      this.className = (on ? [...rest, name] : rest).join(' ');
    },
  };

  hasClass(name: string): boolean {
    return this.className.split(' ').includes(name);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'value') this.value = value;
    if (name === 'max') this.max = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.attributes.set(name, '');
    else this.attributes.delete(name);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault: () => undefined, ...event });
  }
  isConnected = true;
  focus(): void {}
  getClientRects(): unknown[] {
    return [];
  }
  removeEventListener(): void {}
  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }
  getContext(): object {
    return new Proxy({}, { get: () => () => undefined, set: () => true });
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  append(...nodes: TimelineElement[]): void {
    this.mutations++;
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: TimelineElement[]): void {
    this.mutations++;
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  /** The text of the element and everything under it, as `textContent` reads a real tree. */
  text(): string {
    return this.textContent + this.children.map((child) => child.text()).join('');
  }
  all(match: (element: TimelineElement) => boolean): TimelineElement[] {
    return this.children.flatMap((child) => [...(match(child) ? [child] : []), ...child.all(match)]);
  }
  byClass(name: string): TimelineElement[] {
    return this.all((element) => element.hasClass(name));
  }
}

/** Stubs `document` and `HTMLElement` so the timeline builds its panel out of these elements. */
export function stubTimelineDom(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new TimelineElement(tag),
    createElementNS: () => new TimelineElement('svg'),
    documentElement: {},
  });
  vi.stubGlobal('HTMLElement', TimelineElement);
}
