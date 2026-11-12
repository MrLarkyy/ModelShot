import type { SceneAnimation } from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '../src/timeline/Timeline';

// Just enough of an element to follow what the timeline keeps in its panel: the child tree, text and attributes.
class FakeElement {
  id = '';
  className = '';
  textContent = '';
  disabled = false;
  value = '';
  max = '';
  checked = false;
  clientWidth = 0;
  readonly style: Record<string, string> = {};
  readonly attributes = new Set<string>();
  children: FakeElement[] = [];
  private parent: FakeElement | null = null;

  setAttribute(name: string): void {
    this.attributes.add(name);
  }
  toggleAttribute(name: string, force: boolean): void {
    if (force) this.attributes.add(name);
    else this.attributes.delete(name);
  }
  addEventListener(): void {}
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  /** The text of the element and everything under it, as `textContent` reads a real tree. */
  text(): string {
    return this.textContent + this.children.map((child) => child.text()).join('');
  }
}

const REASON = 'This model has no animations.';
const clip: SceneAnimation = { name: 'bob', loop: 'loop', length: 1, channels: [] };

function setup() {
  const root = new FakeElement();
  const timeline = new Timeline(root as unknown as HTMLElement, {
    frame: () => Promise.resolve(),
    interacted: () => undefined,
  });
  return { root, timeline };
}

describe('Timeline', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says why it is empty, as a one-row bar, while the model has no clip', () => {
    const { root } = setup();
    expect(root.text()).toContain(REASON);
    expect(root.attributes.has('data-empty')).toBe(true);
  });

  it('keeps the reason out of the panel while clips are listed, and brings it back once without them', () => {
    const { root, timeline } = setup();
    timeline.show([clip]);
    expect(root.text()).toContain('bob');
    expect(root.text()).not.toContain(REASON);
    expect(root.attributes.has('data-empty')).toBe(false);
    timeline.show([]);
    timeline.show([]);
    expect(root.text().split(REASON)).toHaveLength(2);
    expect(root.attributes.has('data-empty')).toBe(true);
  });
});
