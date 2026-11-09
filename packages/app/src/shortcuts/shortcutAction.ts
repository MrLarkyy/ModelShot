export type ShortcutAction =
  | 'open'
  | 'render'
  | 'export'
  | 'cancel'
  | 'front'
  | 'side'
  | 'three-quarter'
  | 'isometric'
  | 'nextLook'
  | 'toggleSelected'
  | 'help'
  | 'undo'
  | 'redo'
  | 'playPause'
  | 'move'
  | 'rotate'
  | 'overlays'
  | 'rename'
  | 'outliner'
  | 'inspector'
  | 'timeline';

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey?: boolean;
}

export type ShortcutGroup = 'File' | 'View' | 'Selection' | 'Timeline';

/** Shown in the shortcut list; the plain keys never collide with the viewport's own (arrows, + - = _ 0 Home O I). */
export const SHORTCUTS: readonly {
  readonly keys: string;
  readonly action: ShortcutAction;
  readonly label: string;
  readonly group: ShortcutGroup;
}[] = [
  { keys: 'Ctrl+O / Cmd+O', action: 'open', label: 'Open files', group: 'File' },
  { keys: 'Ctrl+E / Cmd+E', action: 'export', label: 'Export', group: 'File' },
  { keys: 'Ctrl+Z / Cmd+Z', action: 'undo', label: 'Undo', group: 'File' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', action: 'redo', label: 'Redo', group: 'File' },
  { keys: 'R', action: 'render', label: 'Render', group: 'File' },
  { keys: 'Esc', action: 'cancel', label: 'Cancel the render', group: 'File' },
  { keys: '1', action: 'front', label: 'Front view', group: 'View' },
  { keys: '2', action: 'side', label: 'Side view', group: 'View' },
  { keys: '3', action: 'three-quarter', label: 'Three-quarter view', group: 'View' },
  { keys: '4', action: 'isometric', label: 'Isometric view', group: 'View' },
  { keys: 'L', action: 'nextLook', label: 'Next look', group: 'View' },
  { keys: 'G', action: 'overlays', label: 'Show or hide the grid and gizmos', group: 'View' },
  { keys: '[', action: 'outliner', label: 'Show or hide the outliner', group: 'View' },
  { keys: ']', action: 'inspector', label: 'Show or hide the inspector', group: 'View' },
  { keys: 'T', action: 'timeline', label: 'Show or hide the timeline', group: 'View' },
  { keys: '?', action: 'help', label: 'This list', group: 'View' },
  { keys: 'H', action: 'toggleSelected', label: 'Show or hide the selected node', group: 'Selection' },
  { keys: 'W', action: 'move', label: 'Move gizmo', group: 'Selection' },
  { keys: 'E', action: 'rotate', label: 'Rotate gizmo', group: 'Selection' },
  { keys: 'F2', action: 'rename', label: 'Rename the selected node', group: 'Selection' },
  { keys: 'Space', action: 'playPause', label: 'Play or pause the animation', group: 'Timeline' },
];

const PLAIN: Readonly<Record<string, ShortcutAction>> = {
  r: 'render',
  Escape: 'cancel',
  '1': 'front',
  '2': 'side',
  '3': 'three-quarter',
  '4': 'isometric',
  l: 'nextLook',
  h: 'toggleSelected',
  '?': 'help',
  ' ': 'playPause',
  w: 'move',
  e: 'rotate',
  g: 'overlays',
  F2: 'rename',
  '[': 'outliner',
  ']': 'inspector',
  t: 'timeline',
};

// The action of a key press, or null. A key with Ctrl, Alt or Meta is only Ctrl/Cmd+O, +E, +Z and Ctrl+Y; the
// plain keys leave every key the orbit controls use alone.
export function shortcutAction(event: KeyLike): ShortcutAction | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (key === 'o') return 'open';
    if (key === 'e') return 'export';
    if (key === 'z') return event.shiftKey === true ? 'redo' : 'undo';
    if (key === 'y' && event.ctrlKey) return 'redo';
    return null;
  }
  return Object.hasOwn(PLAIN, key) ? (PLAIN[key] ?? null) : null;
}
