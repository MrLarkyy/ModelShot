import { describe, expect, it } from 'vitest';
import { MAX_SETTLE_RENDERS, renderSettled } from '../src/viewer/renderSettled';

/** A renderer that needs `frames` calls before it is done. */
function settlingAfter(frames: number): { render(): void; readonly needsRender: boolean; calls: number } {
  return {
    calls: 0,
    render() {
      this.calls++;
    },
    get needsRender() {
      return this.calls < frames;
    },
  };
}

describe('renderSettled', () => {
  it('renders once when nothing is left, and until settled otherwise', () => {
    for (const frames of [0, 1, 4]) {
      const renderer = settlingAfter(frames);
      renderSettled(renderer);
      expect(renderer.calls, `${frames}`).toBe(Math.max(1, frames));
      expect(renderer.needsRender).toBe(false);
    }
  });

  it('stops after MAX_SETTLE_RENDERS calls of a renderer that never settles', () => {
    const renderer = settlingAfter(Infinity);
    renderSettled(renderer);
    expect(renderer.calls).toBe(MAX_SETTLE_RENDERS);
  });
});
