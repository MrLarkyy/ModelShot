import { orbitKeyAction } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { parseKeys } from '../src/shortcuts/listedKeys';
import { ORBIT_KEYS } from '../src/shortcuts/orbitKeys';
import { shortcutAction } from '../src/shortcuts/shortcutAction';

describe('ORBIT_KEYS', () => {
  it('names only keys the 3D view takes, and none the shortcut table takes', () => {
    for (const entry of ORBIT_KEYS) {
      expect(entry.probes.length, entry.keys).toBeGreaterThan(0);
      for (const [key, shift] of entry.probes) {
        expect(orbitKeyAction(key, shift), `${entry.keys}: ${key}`).not.toBeNull();
        expect(shortcutAction({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: shift })).toBeNull();
      }
    }
  });
});

describe('parseKeys', () => {
  it('splits alternatives and the keys of one press, and keeps a plus key', () => {
    expect(parseKeys('Shift+Arrows')).toEqual([['Shift', 'Arrows']]);
    expect(parseKeys('+ / -')).toEqual([['+'], ['-']]);
    expect(parseKeys('0 / Home')).toEqual([['0'], ['Home']]);
  });
});
