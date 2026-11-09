import { vi } from 'vitest';

// Just enough of an element tree for the icon helpers in a Node test (the app suite runs without a DOM).
export class FakeNode {
  readonly attributes = new Map<string, string>();
  readonly children: FakeNode[] = [];
  className = '';
  title = '';
  type = '';
  constructor(
    readonly tag: string,
    readonly namespace: string | null = null,
  ) {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  append(...children: FakeNode[]): void {
    this.children.push(...children);
  }
}

export function stubSvgDocument(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (namespace: string, tag: string) => new FakeNode(tag, namespace),
  });
}
