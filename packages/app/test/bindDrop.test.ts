import { describe, expect, it } from 'vitest';
import { bindDrop } from '../src/intake/bindDrop';

type Listener = (event: unknown) => void;

class FakeTarget {
  readonly listeners = new Map<string, Listener>();
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
  fire(type: string, types: string[] = ['Files'], files: File[] = []): { prevented: boolean } {
    const state = { prevented: false };
    this.listeners.get(type)?.({
      dataTransfer: { types, files, dropEffect: 'none' },
      preventDefault: () => (state.prevented = true),
    });
    return state;
  }
}

function setup() {
  const target = new FakeTarget();
  const active: boolean[] = [];
  const dropped: File[][] = [];
  const dispose = bindDrop(
    target,
    (value) => active.push(value),
    (files) => dropped.push(files),
  );
  return { target, active, dropped, dispose };
}

describe('bindDrop', () => {
  it('stays active until the last nested leave', () => {
    const { target, active } = setup();
    target.fire('dragenter');
    target.fire('dragenter');
    target.fire('dragleave');
    expect(active).toEqual([true, true]);
    target.fire('dragleave');
    expect(active).toEqual([true, true, false]);
  });

  it('clears on drop and hands the files over', () => {
    const { target, active, dropped } = setup();
    const file = new File(['x'], 'a.bbmodel');
    target.fire('dragenter');
    expect(target.fire('drop', ['Files'], [file]).prevented).toBe(true);
    expect(active.at(-1)).toBe(false);
    expect(dropped).toEqual([[file]]);
  });

  it('ignores a drag that carries no files', () => {
    const { target, active, dropped } = setup();
    expect(target.fire('dragenter', ['text/plain']).prevented).toBe(false);
    target.fire('drop', ['text/plain']);
    expect(active).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it('removes its listeners', () => {
    const { target, dispose } = setup();
    dispose();
    expect(target.listeners.size).toBe(0);
  });
});
