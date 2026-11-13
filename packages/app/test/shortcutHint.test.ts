import { describe, expect, it } from 'vitest';
import { keyNames } from '../src/shortcuts/keycaps';
import { SHORTCUTS } from '../src/shortcuts/shortcutAction';
import { ariaKeyShortcuts, hintText } from '../src/shortcuts/shortcutHint';

describe('shortcutHint', () => {
  it('writes aria-keyshortcuts for Ctrl and Cmd bindings, plain keys and Space', () => {
    expect(ariaKeyShortcuts('open')).toBe('Control+O Meta+O');
    expect(ariaKeyShortcuts('render')).toBe('R');
    expect(ariaKeyShortcuts('playPause')).toBe('Space');
    expect(ariaKeyShortcuts('redo')).toBe('Control+Shift+Z Meta+Shift+Z Control+Y');
    expect(ariaKeyShortcuts('nextKeyframe')).toBe('.');
  });

  it('writes the tooltip as the label and its keys', () => {
    expect(hintText('Render', 'render')).toBe('Render (R)');
    expect(hintText('Export', 'export')).toBe('Export (Ctrl+E / Cmd+E)');
  });

  it('names the keys of a binding for the keycaps, Cmd on Apple platforms', () => {
    const redo = SHORTCUTS.find((s) => s.action === 'redo')?.bindings[0];
    if (!redo) throw new Error('redo has a binding');
    expect(keyNames(redo, false)).toEqual(['Ctrl', 'Shift', 'Z']);
    expect(keyNames(redo, true)).toEqual(['⌘', 'Shift', 'Z']);
    expect(keyNames({ key: ' ' }, false)).toEqual(['Space']);
    expect(keyNames({ key: 'Escape' }, false)).toEqual(['Esc']);
  });
});
