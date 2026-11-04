import { ACCEPTED_MODEL_EXTENSIONS, ACCEPTED_RESOURCE_EXTENSIONS } from '@modelshot/formats';
import { describe, expect, it } from 'vitest';
import { HandoffLimits } from '../src/handoff';
import indexHtml from '../index.html?raw';

const pickable = [...ACCEPTED_MODEL_EXTENSIONS, ...ACCEPTED_RESOURCE_EXTENSIONS];

function acceptAttribute(): string[] {
  const input = /<input\b[^>]*\bid="file-input"[^>]*>/.exec(indexHtml)?.[0] ?? '';
  const accept = /\baccept="([^"]*)"/.exec(input)?.[1];
  expect(accept, 'the file input has an accept attribute').toBeDefined();
  return accept!.split(',');
}

describe('pickable file extensions', () => {
  it('are the same in formats, the picker accept attribute and the landing handoff', () => {
    expect(pickable).toEqual(expect.arrayContaining(['.jpg', '.jpeg', '.png', '.glb']));
    expect([...acceptAttribute()].sort()).toEqual([...pickable].sort());
    expect([...HandoffLimits.extensions].sort()).toEqual([...pickable].sort());
  });
});
