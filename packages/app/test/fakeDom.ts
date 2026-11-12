import { vi } from 'vitest';

type Listener = (event: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  key?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  clientX?: number;
  pointerId?: number;
  target?: unknown;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

// A small element tree for the editor helpers in a Node test (the app suite runs without a DOM).
export class FakeElement {
  readonly attributes = new Map<string, string>();
  children: (FakeElement | string)[] = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly captured = new Set<number>();
  id = '';
  className = '';
  hidden = false;
  disabled = false;
  title = '';
  type = '';
  value = '';
  tabIndex = 0;
  focused = false;
  readonly style = {
    properties: new Map<string, string>(),
    setProperty(name: string, value: string): void {
      this.properties.set(name, value);
    },
  };
  readonly classList = {
    add: (name: string): void => {
      this.className = `${this.className} ${name}`.trim();
    },
  };
  private text = '';
  constructor(
    readonly tagName: string,
    readonly namespace: string | null = null,
  ) {}
  get textContent(): string {
    return this.children.length > 0
      ? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('')
      : this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  append(...children: (FakeElement | string)[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: (FakeElement | string)[]): void {
    this.children = [...children];
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  focus(): void {
    this.focused = true;
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = { type, target: this, defaultPrevented: false, ...init };
    event.preventDefault = () => {
      event.defaultPrevented = true;
    };
    event.stopPropagation = () => undefined;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  // Tag names only: enough for the helpers under test.
  querySelector<T = FakeElement>(tag: string): T | null {
    return (this.find((e) => e.tagName === tag)[0] as T | undefined) ?? null;
  }
  find(match: (element: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      if (match(child)) out.push(child);
      out.push(...child.find(match));
    }
    return out;
  }
}

export function stubDom(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (namespace: string, tag: string) => new FakeElement(tag, namespace),
  });
}
