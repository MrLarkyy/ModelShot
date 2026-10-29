import { describe, expect, it } from 'vitest';
import { MAX_SETTLE_RENDERS, renderSettled } from '../src/viewer/renderSettled';

/** A renderer that needs `frames` render calls, after `uploads` advanceLighting calls, before it is done. */
function settlingAfter(frames: number, uploads = 0) {
  return {
    calls: 0,
    uploadCalls: 0,
    render() {
      if (this.uploadCalls < uploads) this.uploadCalls++;
      else this.calls++;
    },
    advanceLighting() {
      if (this.uploadCalls >= uploads) return false;
      this.uploadCalls++;
      return this.uploadCalls < uploads;
    },
    get needsRender() {
      return this.uploadCalls < uploads || this.calls < frames;
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

  it('finishes an upload of more calls than the cap before it converges the frame', () => {
    const renderer = settlingAfter(4, 20);
    renderSettled(renderer);
    expect(renderer.uploadCalls).toBe(20);
    expect(renderer.calls).toBe(4);
    expect(renderer.needsRender).toBe(false);
  });
});
