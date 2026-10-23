import { describe, expect, it } from 'vitest';
import { HandoffLimits } from '../src/handoff/HandoffLimits';
import { checkIntake } from '../src/intake/checkIntake';

const file = (name: string, size = 10): File => new File([new Uint8Array(size)], name);

describe('checkIntake', () => {
  it('accepts a model with its resources', () => {
    expect(checkIntake([file('a.gltf'), file('a.bin'), file('a.png')])).toBeNull();
  });

  it('refuses nothing, too many files, other extensions and too many bytes with the handoff codes', () => {
    expect(checkIntake([])?.code).toBe('EMPTY');
    const many = Array.from({ length: HandoffLimits.maxFiles + 1 }, (_, i) => file(`m${i}.bbmodel`));
    expect(checkIntake(many)?.code).toBe('TOO_MANY');
    expect(checkIntake([file('setup.exe')])?.code).toBe('UNSUPPORTED_TYPE');
    const big = { name: 'big.bbmodel', size: HandoffLimits.maxTotalBytes + 1 } as File;
    expect(checkIntake([big])?.code).toBe('TOO_LARGE');
  });

  it('names the limit in the message', () => {
    expect(checkIntake([file('setup.exe')])?.message).toContain('setup.exe');
    expect(checkIntake([{ name: 'big.bbmodel', size: 300 * 1024 * 1024 } as File])?.message).toContain('256 MiB');
  });
});
