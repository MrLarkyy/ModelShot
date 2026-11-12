import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from '../src/shortcuts/shortcutAction';
import { hintItems } from '../src/ui/FirstRunHint';

describe('hintItems', () => {
  it('takes every key and label from the shortcut list', () => {
    const items = hintItems();
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(SHORTCUTS.some((shortcut) => shortcut.keys === item.keys && shortcut.label === item.label)).toBe(true);
    }
  });

  it('names the shortcut list itself', () => {
    expect(hintItems().some((item) => item.keys === '?')).toBe(true);
  });
});
