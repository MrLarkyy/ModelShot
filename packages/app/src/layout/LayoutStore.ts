import { DEFAULT_LAYOUT, type LayoutState } from './layoutState';
import { parseLayout } from './parseLayout';

export const LAYOUT_KEY = 'modelshot.layout.v1';

type Backing = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The layout of this browser in localStorage. A blocked or full storage keeps the layout for the session and tells the
// user once; it never reaches the editor flow.
export class LayoutStore {
  private current: LayoutState;
  private told = false;
  private readonly listeners = new Set<(state: LayoutState) => void>();

  constructor(
    private readonly backing: Backing | null,
    private readonly notify: (message: string) => void = () => undefined,
  ) {
    this.current = DEFAULT_LAYOUT;
    try {
      this.current = parseLayout(backing?.getItem(LAYOUT_KEY) ?? null);
    } catch {
      this.tell();
    }
  }

  get state(): LayoutState {
    return this.current;
  }

  onChange(listener: (state: LayoutState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<LayoutState>): void {
    this.current = { ...this.current, ...patch };
    try {
      this.backing?.setItem(LAYOUT_KEY, JSON.stringify(this.current));
    } catch {
      this.tell();
    }
    for (const listener of this.listeners) listener(this.current);
  }

  /** Back to the defaults, and the stored record removed ("Forget local data"). */
  reset(): void {
    this.current = DEFAULT_LAYOUT;
    try {
      this.backing?.removeItem(LAYOUT_KEY);
    } catch {
      this.tell();
    }
    for (const listener of this.listeners) listener(this.current);
  }

  private tell(): void {
    if (this.told) return;
    this.told = true;
    this.notify('The panel layout is not being kept in this browser.');
  }
}
