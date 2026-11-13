import { describe, expect, it } from 'vitest';
import { SCRUBBER_KEYS, scrubberCommand } from '../src/timeline/scrubberKeys';

describe('scrubberCommand', () => {
  it.each([
    [{ key: 'ArrowLeft' }, { kind: 'frames', frames: -1 }],
    [{ key: 'ArrowRight' }, { kind: 'frames', frames: 1 }],
    [
      { key: 'ArrowRight', shiftKey: true },
      { kind: 'frames', frames: 10 },
    ],
    [
      { key: 'ArrowLeft', shiftKey: true },
      { kind: 'frames', frames: -10 },
    ],
    [{ key: 'PageUp' }, { kind: 'keyframe', direction: -1 }],
    [{ key: 'PageDown' }, { kind: 'keyframe', direction: 1 }],
    [{ key: 'Home' }, { kind: 'start' }],
    [{ key: 'End' }, { kind: 'end' }],
  ])('maps %o', (event, command) => {
    expect(scrubberCommand(event)).toEqual(command);
  });

  it('leaves other keys and modified keys alone', () => {
    expect(scrubberCommand({ key: 'a' })).toBeNull();
    expect(scrubberCommand({ key: 'ArrowUp' })).toBeNull();
    expect(scrubberCommand({ key: 'ArrowRight', ctrlKey: true })).toBeNull();
    expect(scrubberCommand({ key: 'Home', altKey: true })).toBeNull();
  });

  it('lists its keys for the help dialog', () => {
    expect(SCRUBBER_KEYS.length).toBeGreaterThanOrEqual(4);
  });
});
