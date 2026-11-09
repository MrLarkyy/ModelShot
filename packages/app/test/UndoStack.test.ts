import { describe, expect, it } from 'vitest';
import { MAX_UNDO_ENTRIES, UndoStack } from '../src/history/UndoStack';

const ok = (): Promise<boolean> => Promise.resolve(true);

describe('UndoStack', () => {
  it('undoes and redoes through the states', async () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    stack.record('b');
    const shown: string[] = [];
    const show = (s: string): Promise<boolean> => {
      shown.push(s);
      return Promise.resolve(true);
    };
    expect(await stack.undo('c', show)).toBe(true);
    expect(await stack.undo('b', show)).toBe(true);
    expect(await stack.undo('a', show)).toBe(false);
    expect(shown).toEqual(['b', 'a']);
    expect(await stack.redo('a', show)).toBe(true);
    expect(shown.at(-1)).toBe('b');
    expect(stack.canRedo).toBe(true);
  });

  it('a new change forgets the redo side', async () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    await stack.undo('b', ok);
    expect(stack.canRedo).toBe(true);
    stack.record('c');
    expect(stack.canRedo).toBe(false);
  });

  it('keeps the entry when the state could not be shown', async () => {
    const stack = new UndoStack<string>();
    stack.record('a');
    expect(await stack.undo('b', () => Promise.resolve(false))).toBe(false);
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it('caps its depth and clears', async () => {
    const stack = new UndoStack<number>();
    for (let i = 0; i < MAX_UNDO_ENTRIES + 20; i++) stack.record(i);
    let depth = 0;
    while (await stack.undo(0, ok)) depth++;
    expect(depth).toBe(MAX_UNDO_ENTRIES);
    stack.record(1);
    stack.clear();
    expect(stack.canUndo).toBe(false);
  });
});
