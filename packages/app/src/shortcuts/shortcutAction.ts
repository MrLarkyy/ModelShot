export const SHORTCUT_ACTIONS = [
  'open',
  'render',
  'export',
  'cancel',
  'front',
  'side',
  'three-quarter',
  'isometric',
  'nextLook',
  'toggleSelected',
  'help',
  'undo',
  'redo',
  'playPause',
  'move',
  'rotate',
  'overlays',
  'rename',
  'search',
  'outliner',
  'inspector',
  'timeline',
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey?: boolean;
}

export type ShortcutGroup = 'File' | 'View' | 'Selection' | 'Timeline';

/**
 * One key that triggers an action. `key` is `KeyboardEvent.key` (a single letter in lower case). `mod`: `ctrlOrMeta`
 * needs Ctrl or Cmd, `ctrl` Ctrl alone, none no modifier. `shift` is checked only when stated.
 */
export interface KeyBinding {
  readonly key: string;
  readonly mod?: 'ctrlOrMeta' | 'ctrl';
  readonly shift?: boolean;
}

export interface Shortcut {
  readonly action: ShortcutAction;
  readonly label: string;
  readonly group: ShortcutGroup;
  readonly bindings: readonly KeyBinding[];
  /** The bindings as text, derived from them. */
  readonly keys: string;
}

const KEY_NAMES: Readonly<Record<string, string>> = { ' ': 'Space', Escape: 'Esc' };

function keyName(key: string): string {
  return KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** The binding as the key names a person reads: "Ctrl+Shift+Z / Cmd+Shift+Z". */
export function bindingText(binding: KeyBinding): string {
  const name = `${binding.shift === true ? 'Shift+' : ''}${keyName(binding.key)}`;
  if (binding.mod === 'ctrlOrMeta') return `Ctrl+${name} / Cmd+${name}`;
  return binding.mod === 'ctrl' ? `Ctrl+${name}` : name;
}

function entry(
  action: ShortcutAction,
  group: ShortcutGroup,
  label: string,
  ...bindings: readonly KeyBinding[]
): Shortcut {
  return { action, label, group, bindings, keys: bindings.map(bindingText).join(' / ') };
}

/** The one shortcut table: key handling, the help dialog, tooltips, menus and the docs all read it. Plain keys never collide with the viewport's own (arrows, + - = _ 0 Home O I). */
export const SHORTCUTS: readonly Shortcut[] = [
  entry('open', 'File', 'Open files', { key: 'o', mod: 'ctrlOrMeta' }),
  entry('export', 'File', 'Export', { key: 'e', mod: 'ctrlOrMeta' }),
  entry('undo', 'File', 'Undo', { key: 'z', mod: 'ctrlOrMeta', shift: false }),
  entry('redo', 'File', 'Redo', { key: 'z', mod: 'ctrlOrMeta', shift: true }, { key: 'y', mod: 'ctrl' }),
  entry('render', 'File', 'Render', { key: 'r' }),
  entry('cancel', 'File', 'Stop the render', { key: 'Escape' }),
  entry('front', 'View', 'Front view', { key: '1' }),
  entry('side', 'View', 'Side view', { key: '2' }),
  entry('three-quarter', 'View', 'Three-quarter view', { key: '3' }),
  entry('isometric', 'View', 'Isometric view', { key: '4' }),
  entry('nextLook', 'View', 'Next look', { key: 'l' }),
  entry('overlays', 'View', 'Show or hide the grid and gizmos', { key: 'g' }),
  entry('outliner', 'View', 'Show or hide the outliner', { key: '[' }),
  entry('inspector', 'View', 'Show or hide the inspector', { key: ']' }),
  entry('timeline', 'View', 'Show or hide the timeline', { key: 't' }),
  entry('help', 'View', 'This list', { key: '?' }),
  entry('toggleSelected', 'Selection', 'Show or hide the selected node', { key: 'h' }),
  entry('move', 'Selection', 'Move gizmo', { key: 'w' }),
  entry('rotate', 'Selection', 'Rotate gizmo', { key: 'e' }),
  entry('search', 'Selection', 'Search the outliner', { key: '/' }),
  entry('rename', 'Selection', 'Rename the selected node', { key: 'F2' }),
  entry('playPause', 'Timeline', 'Play or pause the animation', { key: ' ' }),
];

function matches(binding: KeyBinding, key: string, event: KeyLike): boolean {
  if (binding.key !== key) return false;
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  if (binding.mod === 'ctrl') {
    if (!event.ctrlKey) return false;
  } else if (binding.mod === 'ctrlOrMeta') {
    if (!ctrlOrMeta) return false;
  } else if (ctrlOrMeta) {
    return false;
  }
  return binding.shift === undefined || binding.shift === (event.shiftKey === true);
}

// The action of a key press, or null. A key with Ctrl, Alt or Meta is only what a binding with a modifier names; the
// plain keys leave every key the orbit controls use alone.
export function shortcutAction(event: KeyLike): ShortcutAction | null {
  if (event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  for (const shortcut of SHORTCUTS) {
    if (shortcut.bindings.some((binding) => matches(binding, key, event))) return shortcut.action;
  }
  return null;
}
