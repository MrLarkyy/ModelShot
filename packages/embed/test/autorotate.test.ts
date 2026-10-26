import { describe, expect, it } from 'vitest';
import { AUTOROTATE_DEG_PER_S, startAutorotate } from '../src/frame/autorotate';
import { postStatus, type StatusTarget } from '../src/frame/postStatus';

function harness(options: { reduce?: boolean; hidden?: boolean } = {}) {
  const yaws: number[] = [];
  let changed = 0;
  let pending: ((time: number) => void) | null = null;
  const motion = Object.assign(new EventTarget(), { matches: options.reduce ?? false });
  const input = new EventTarget();
  let hidden = options.hidden ?? false;
  const stop = startAutorotate(
    { orbit: { rotate: (yaw: number) => yaws.push(yaw) }, changed: () => changed++ },
    {
      input,
      matchMedia: () => motion,
      isHidden: () => hidden,
      requestFrame: (callback) => {
        pending = callback;
        return 1;
      },
      cancelFrame: () => {
        pending = null;
      },
    },
  );
  const frame = (time: number): void => {
    const callback = pending;
    pending = null;
    callback?.(time);
  };
  return {
    yaws,
    changes: () => changed,
    frame,
    input,
    motion,
    stop,
    scheduled: () => pending !== null,
    setHidden: (value: boolean) => (hidden = value),
  };
}

describe('startAutorotate', () => {
  it('turns at 20 degrees a second, a long frame counting as 100 ms', () => {
    const h = harness();
    h.frame(1000);
    h.frame(1050);
    h.frame(3050);
    expect(h.yaws).toEqual([(AUTOROTATE_DEG_PER_S * 50) / 1000, (AUTOROTATE_DEG_PER_S * 100) / 1000]);
    expect(h.changes()).toBe(2);
  });

  it('never starts under reduced motion', () => {
    const h = harness({ reduce: true });
    expect(h.scheduled()).toBe(false);
    h.frame(0);
    expect(h.yaws).toEqual([]);
  });

  it('stops when reduced motion is turned on', () => {
    const h = harness();
    h.frame(0);
    h.motion.matches = true;
    h.motion.dispatchEvent(new Event('change'));
    expect(h.scheduled()).toBe(false);
  });

  it.each(['pointerdown', 'wheel', 'keydown'])('stops for good on %s', (type) => {
    const h = harness();
    h.frame(0);
    h.frame(100);
    h.input.dispatchEvent(new Event(type));
    h.frame(200);
    expect(h.yaws).toHaveLength(1);
    expect(h.scheduled()).toBe(false);
  });

  it('pauses while the page is hidden and does not jump when it shows again', () => {
    const h = harness();
    h.frame(0);
    h.setHidden(true);
    h.frame(5000);
    h.setHidden(false);
    h.frame(9000);
    h.frame(9050);
    expect(h.yaws).toEqual([(AUTOROTATE_DEG_PER_S * 50) / 1000]);
  });
});

describe('postStatus', () => {
  const recorder = () => {
    const sent: [unknown, string][] = [];
    const target: StatusTarget = { postMessage: (message, origin) => sent.push([message, origin]) };
    return { sent, target };
  };

  it('posts load and error messages to the parent', () => {
    const parent = recorder();
    const self = recorder();
    postStatus(parent.target, self.target, { type: 'load' });
    postStatus(parent.target, self.target, { type: 'error', code: 'MODEL_TOO_LARGE', message: 'too large' });
    expect(parent.sent).toEqual([
      [{ source: 'modelshot-embed', v: 1, type: 'load' }, '*'],
      [{ source: 'modelshot-embed', v: 1, type: 'error', code: 'MODEL_TOO_LARGE', message: 'too large' }, '*'],
    ]);
    expect(self.sent).toEqual([]);
  });

  it('posts nothing when the frame is not embedded', () => {
    const top = recorder();
    postStatus(top.target, top.target, { type: 'load' });
    expect(top.sent).toEqual([]);
  });
});
