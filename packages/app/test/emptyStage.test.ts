import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

describe('the empty stage at boot', () => {
  // The app marks the stage when a model opens or fails to; with nothing to restore it never runs that code.
  it('is marked empty in the markup, the stage and the timeline alike', () => {
    expect(indexHtml).toMatch(/<div id="viewport"[^>]*\sdata-empty[\s>]/);
    expect(indexHtml).toMatch(/<section id="timeline"[^>]*\sdata-empty[\s>]/);
  });
});
