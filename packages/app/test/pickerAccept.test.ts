import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PICKER_ACCEPT, entryAccept, type EntryKind } from '../src/intake/pickerAccept';
import { APP_ROOT } from './appSources';

const KINDS: EntryKind[] = ['bbmodel', 'skin', 'gltf-obj'];

describe('pickerAccept', () => {
  it('keeps every entry within the full list', () => {
    const all = new Set(PICKER_ACCEPT.split(','));
    for (const kind of KINDS)
      for (const extension of entryAccept(kind).split(',')) expect(all.has(extension)).toBe(true);
  });

  it('narrows a skin to PNG', () => {
    expect(entryAccept('skin')).toBe('.png');
  });

  it('is the accept of the page file input', () => {
    const html = readFileSync(join(APP_ROOT, 'index.html'), 'utf8');
    expect(html).toContain(`accept="${PICKER_ACCEPT}"`);
  });
});
