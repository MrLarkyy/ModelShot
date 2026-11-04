import { orbitKeyAction } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS, shortcutAction, type KeyLike } from '../src/shortcuts/shortcutAction';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('shortcutAction', () => {
  it.each([
    [key('o', { ctrlKey: true }), 'open'],
    [key('O', { metaKey: true }), 'open'],
    [key('e', { ctrlKey: true }), 'export'],
    [key('r'), 'render'],
    [key('R'), 'render'],
    [key('Escape'), 'cancel'],
    [key('1'), 'front'],
    [key('2'), 'side'],
    [key('3'), 'three-quarter'],
    [key('4'), 'isometric'],
    [key('l'), 'nextLook'],
    [key('h'), 'toggleSelected'],
    [key('?'), 'help'],
    [key('z', { ctrlKey: true }), 'undo'],
    [key('Z', { metaKey: true }), 'undo'],
    [key('z', { ctrlKey: true, shiftKey: true }), 'redo'],
    [key('y', { ctrlKey: true }), 'redo'],
    [key(' '), 'playPause'],
    [key('w'), 'move'],
    [key('e'), 'rotate'],
    [key('g'), 'overlays'],
    [key('F2'), 'rename'],
    [key('['), 'outliner'],
    [key(']'), 'inspector'],
    [key('t'), 'timeline'],
  ])('maps %o to %s', (event, action) => {
    expect(shortcutAction(event)).toBe(action);
  });

  it('leaves unknown keys, Alt combinations and other Ctrl combinations alone', () => {
    expect(shortcutAction(key('x'))).toBeNull();
    expect(shortcutAction(key('r', { altKey: true }))).toBeNull();
    expect(shortcutAction(key('r', { ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key('y', { metaKey: true }))).toBeNull();
    expect(shortcutAction(key('z', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(shortcutAction(key('constructor'))).toBeNull();
  });

  it('never takes a key the viewport uses for its orbit controls', () => {
    for (const k of ['r', 'Escape', '1', '2', '3', '4', 'l', 'h', '?', ' ', 'w', 'e', 'g', 'F2', '[', ']', 't']) {
      expect(orbitKeyAction(k, false), k).toBeNull();
      expect(orbitKeyAction(k, true), k).toBeNull();
    }
    const orbitKeys = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      '+',
      '=',
      '-',
      '_',
      'Home',
      '0',
      'o',
      'O',
      'i',
      'I',
    ];
    for (const k of orbitKeys) {
      expect(orbitKeyAction(k, false), k).not.toBeNull();
      expect(shortcutAction(key(k)), k).toBeNull();
    }
  });

  it('lists every action once for the help dialog', () => {
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).toHaveLength(21);
    expect(SHORTCUTS.every((s) => ['File', 'View', 'Selection', 'Timeline'].includes(s.group))).toBe(true);
  });
});
