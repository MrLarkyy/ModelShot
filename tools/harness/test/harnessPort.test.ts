import { describe, expect, it } from 'vitest';
import { harnessPort, portForDirectory } from '../src/harnessPort';

describe('harnessPort', () => {
  it('uses MS_HARNESS_PORT when set and rejects a bad value', () => {
    expect(harnessPort({ MS_HARNESS_PORT: '5000' })).toBe(5000);
    for (const bad of ['80', 'x', '70000', '4410.5']) {
      expect(() => harnessPort({ MS_HARNESS_PORT: bad })).toThrow(/MS_HARNESS_PORT/);
    }
  });

  it('derives a stable port per checkout inside 4410..4909', () => {
    const a = portForDirectory('C:\\work\\MS-10\\tools\\harness');
    expect(a).toBe(portForDirectory('c:/work/MS-10/tools/harness'));
    expect(a).toBeGreaterThanOrEqual(4410);
    expect(a).toBeLessThan(4910);
    const ports = new Set(Array.from({ length: 20 }, (_, i) => portForDirectory(`/w/MS-${i}/tools/harness`)));
    expect(ports.size).toBeGreaterThan(10);
  });
});
