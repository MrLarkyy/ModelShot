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
  | 'help';

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** Shown in the shortcut list; the plain keys never collide with the viewport's own (arrows, + - = _ 0 Home O I). */
export const SHORTCUTS: readonly { readonly keys: string; readonly action: ShortcutAction; readonly label: string }[] =
  [
    { keys: 'Ctrl+O / Cmd+O', action: 'open', label: 'Open files' },
    { keys: 'R', action: 'render', label: 'Render' },
    { keys: 'Ctrl+E / Cmd+E', action: 'export', label: 'Export' },
    { keys: 'Esc', action: 'cancel', label: 'Cancel the render' },
    { keys: '1', action: 'front', label: 'Front view' },
    { keys: '2', action: 'side', label: 'Side view' },
    { keys: '3', action: 'three-quarter', label: 'Three-quarter view' },
    { keys: '4', action: 'isometric', label: 'Isometric view' },
    { keys: 'L', action: 'nextLook', label: 'Next look' },
    { keys: 'H', action: 'toggleSelected', label: 'Show or hide the selected node' },
    { keys: '?', action: 'help', label: 'This list' },
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
};

// The action of a key press, or null. A key with Ctrl, Alt or Meta is only Ctrl/Cmd+O and Ctrl/Cmd+E; the
// plain keys leave every key the orbit controls use alone.
export function shortcutAction(event: KeyLike): ShortcutAction | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (key === 'o') return 'open';
    if (key === 'e') return 'export';
    return null;
  }
  return Object.hasOwn(PLAIN, key) ? (PLAIN[key] ?? null) : null;
}
