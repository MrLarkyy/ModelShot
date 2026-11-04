export const MAX_UNDO_ENTRIES = 100;

// Undo and redo over whole setup states. `record` takes the state before a change; `undo` and `redo` take the state now
// and a function that shows another one, and move the entry only when it did (a scene that cannot be built keeps the
// stacks as they were). A new change forgets the redo side.
export class UndoStack<T> {
  private past: T[] = [];
  private future: T[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  record(before: T): void {
    this.past.push(before);
    if (this.past.length > MAX_UNDO_ENTRIES) this.past.shift();
    this.future = [];
  }

  async undo(now: T, show: (state: T) => Promise<boolean>): Promise<boolean> {
    const previous = this.past.at(-1);
    if (previous === undefined || !(await show(previous))) return false;
    this.past.pop();
    this.future.push(now);
    return true;
  }

  async redo(now: T, show: (state: T) => Promise<boolean>): Promise<boolean> {
    const next = this.future.at(-1);
    if (next === undefined || !(await show(next))) return false;
    this.future.pop();
    this.past.push(now);
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
