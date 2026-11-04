import { describe, expect, it } from 'vitest';
import { harnessPort, portForDirectory, safeOffset, suitePorts } from '../src/harnessPort';

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

describe('suitePorts', () => {
  const roots = Array.from({ length: 300 }, (_, i) => `/work/checkout-${i}`);
  const bands = [4910, 5410, 5910, 6410, 6910, 7410];

  it('gives six distinct ports, each in its own band above the harness band and below the dynamic range', () => {
    for (const root of roots) {
      const ports = Object.values(suitePorts({}, root));
      expect(new Set(ports).size).toBe(6);
      ports.forEach((port, index) => {
        expect(port).toBeGreaterThanOrEqual(bands[index]!);
        expect(port).toBeLessThan(bands[index]! + 500);
        expect(port).toBeLessThan(49152);
      });
    }
  });

  it('never lands a band port on a port Chrome blocks, moving a checkout to the next safe offset', () => {
    const unsafe = [5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697];
    const hit = Array.from({ length: 20000 }, (_, i) => `/work/probe-${i}`).filter((root) =>
      unsafe.some((port) => Object.values(suitePorts({}, root)).includes(port)),
    );
    expect(hit).toEqual([]);
    // 6667 is the embed host band's port at offset 257: offsets 255..259 are skipped, as are 150 and 151 (5060, 5061).
    expect(safeOffset(257)).toBe(260);
    expect(safeOffset(150)).toBe(152);
    expect(safeOffset(0)).toBe(0);
    expect(safeOffset(499)).toBe(499);
  });

  it('keeps the hashed offset where its ports are safe, and a moved offset shared across all six bands', () => {
    let moved = 0;
    for (let i = 0; i < 20000 && moved < 3; i++) {
      const root = `/work/probe-${i}`;
      const hashed = portForDirectory(root) - 4410;
      if (safeOffset(hashed) === hashed) continue;
      moved++;
      const ports = Object.values(suitePorts({}, root));
      expect(ports.map((port, index) => port - bands[index]!)).toEqual(Array(6).fill(safeOffset(hashed)));
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('is stable per root', () => {
    expect(suitePorts({}, roots[3])).toEqual(suitePorts({}, roots[3]));
  });

  it('lets each variable override only its own port', () => {
    const base = suitePorts({}, roots[0]);
    const vars: Record<string, keyof typeof base> = {
      MS_SITE_PORT: 'site',
      MS_APP_PORT: 'app',
      MS_EMBED_PORT: 'embedFrame',
      MS_EMBED_HOST_PORT: 'embedHost',
      MS_DEPLOY_PORT: 'deploySite',
      MS_DEPLOY_HOST_PORT: 'deployHost',
    };
    for (const [name, key] of Object.entries(vars)) {
      expect(suitePorts({ [name]: '9999' }, roots[0])).toEqual({ ...base, [key]: 9999 });
    }
  });

  it('rejects two overrides on one port, naming both variables', () => {
    expect(() => suitePorts({ MS_SITE_PORT: '9000', MS_DEPLOY_PORT: '9000' }, roots[0])).toThrow(
      /MS_SITE_PORT and MS_DEPLOY_PORT both resolve to port 9000/,
    );
  });

  it('rejects an override equal to the default of another server, marking the default', () => {
    const base = suitePorts({}, roots[0]);
    expect(() => suitePorts({ MS_APP_PORT: String(base.site) }, roots[0])).toThrow(
      new RegExp(`MS_SITE_PORT \\(default\\) and MS_APP_PORT both resolve to port ${base.site}`),
    );
  });

  it('rejects an out-of-range value naming the variable', () => {
    expect(() => suitePorts({ MS_APP_PORT: '80' }, roots[0])).toThrow(/MS_APP_PORT must be an integer in 1024..65535/);
  });
});
