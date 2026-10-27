import { describe, expect, it, vi } from 'vitest';
import { browserPhases, runPhases } from '../src/browserPhases';

describe('browserPhases', () => {
  it('runs everything but the timing tests, then the bench project alone', () => {
    expect(browserPhases([])).toEqual([
      { name: 'parallel', args: ['test', '--grep-invert', '@timing'] },
      { name: 'serial', args: ['test', '--project=bench', '--workers=1'] },
    ]);
  });

  it('refuses extra arguments and points to playwright test', () => {
    expect(() => browserPhases(['golden.spec'])).toThrow(/pnpm exec playwright test/);
  });
});

describe('runPhases', () => {
  const phases = browserPhases([]);
  const runner = (exits: Record<string, number>) =>
    vi.fn((phase: { name: string }) => Promise.resolve(exits[phase.name] ?? 0));

  it('runs the serial phase after a failed parallel phase and fails', async () => {
    const run = runner({ parallel: 1 });
    expect(await runPhases(phases, run)).toBe(1);
    expect(run.mock.calls.map(([phase]) => phase.name)).toEqual(['parallel', 'serial']);
  });

  it('succeeds only when every phase succeeds', async () => {
    expect(await runPhases(phases, runner({}))).toBe(0);
    expect(await runPhases(phases, runner({ serial: 1 }))).toBe(1);
  });

  it.each([130, 143, 255, 4294967295, 2])(
    'stops without the serial phase after exit %i and returns it',
    async (code) => {
      const run = runner({ parallel: code });
      expect(await runPhases(phases, run)).toBe(code);
      expect(run.mock.calls.map(([phase]) => phase.name)).toEqual(['parallel']);
    },
  );
});
