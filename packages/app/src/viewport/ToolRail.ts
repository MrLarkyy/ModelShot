import { iconButton } from '../ui/iconButton';
import type { GizmoMode } from './gizmoFrame';

const TOOLS = [
  { mode: 'move', label: 'Move', icon: 'move', shortcut: 'move' },
  { mode: 'rotate', label: 'Rotate', icon: 'rotate', shortcut: 'rotate' },
] as const;

// The gizmo mode buttons over the view. The keys W and E and these buttons end in the same `select`, and the editor
// reports every mode change back to `setMode`, so the pressed button is the active mode whichever way it was chosen.
export class ToolRail {
  private readonly buttons = new Map<GizmoMode, HTMLButtonElement>();

  constructor(
    root: HTMLElement,
    private readonly select: (mode: GizmoMode) => void,
  ) {
    for (const tool of TOOLS) {
      const button = iconButton(tool.icon, tool.label, { pressed: tool.mode === 'move', shortcut: tool.shortcut });
      button.disabled = true;
      button.addEventListener('click', () => this.select(tool.mode));
      this.buttons.set(tool.mode, button);
    }
    root.replaceChildren(...this.buttons.values());
  }

  /** Marks the active mode. */
  setMode(mode: GizmoMode): void {
    for (const [id, button] of this.buttons) button.setAttribute('aria-pressed', String(id === mode));
  }

  /** The buttons work once the editor tools have loaded. */
  setEnabled(enabled: boolean): void {
    for (const button of this.buttons.values()) button.disabled = !enabled;
  }
}
