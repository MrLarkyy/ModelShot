import { describe, expect, it } from 'vitest';
import { checkHandoffFiles } from '../src/handoff/checkHandoffFiles';
import { findHandoffViolation } from '../src/handoff/findHandoffViolation';
import { HandoffLimits } from '../src/handoff/HandoffLimits';

function file(name: string, size = 10): { name: string; size: number } {
  return { name, size };
}

describe('checkHandoffFiles', () => {
  it('accepts every listed extension, in any case', () => {
    const files = ['a.bbmodel', 'b.gltf', 'c.GLB', 'd.bin', 'e.obj', 'f.mtl', 'skin.PNG'].map((n) => file(n));
    expect(checkHandoffFiles(files)).toBeNull();
  });

  it('rejects an empty selection', () => {
    expect(checkHandoffFiles([])?.code).toBe('EMPTY');
  });

  it('rejects 33 files and names the limit', () => {
    const files = Array.from({ length: HandoffLimits.maxFiles + 1 }, (_, i) => file(`m${i}.obj`));
    const error = checkHandoffFiles(files);
    expect(error?.code).toBe('TOO_MANY');
    expect(error?.message).toContain('at most 32');
  });

  it('accepts exactly 32 files and exactly 256 MiB', () => {
    const files = Array.from({ length: 32 }, (_, i) => file(`m${i}.obj`, HandoffLimits.maxTotalBytes / 32));
    expect(checkHandoffFiles(files)).toBeNull();
  });

  it('rejects 256 MiB + 1 byte and names the limit', () => {
    const error = checkHandoffFiles([file('big.glb', HandoffLimits.maxTotalBytes - 9), file('t.png', 10)]);
    expect(error?.code).toBe('TOO_LARGE');
    expect(error?.message).toContain('256 MiB');
  });

  it.each(['setup.exe', 'model', 'notes.bbmodel.txt', '.png', 'archive.zip'])('rejects "%s"', (name) => {
    const error = checkHandoffFiles([file('ok.bbmodel'), file(name)]);
    expect(error?.code).toBe('UNSUPPORTED_TYPE');
    expect(error?.message).toContain(name);
    expect(error?.message).toContain('.bbmodel');
  });

  it('shortens a very long hostile name in the message', () => {
    const error = checkHandoffFiles([file(`${'x'.repeat(5000)}.exe`)]);
    expect(error?.message.length).toBeLessThan(300);
  });

  it('counts the files before looking at any of them', () => {
    const files = new Proxy(new Array<{ name: string; size: number }>(1000), {
      get(target, key, receiver) {
        if (key === 'length') return 1000;
        if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error('entry read');
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(findHandoffViolation(files)).toEqual({ code: 'TOO_MANY', count: 1000 });
  });
});
