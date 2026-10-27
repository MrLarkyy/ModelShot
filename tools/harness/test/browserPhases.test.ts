import { describe, expect, it, vi } from 'vitest';
import { browserPhases, runPhases } from '../src/browserPhases';

describe('browserPhases', () => {
  it('runs everything but the timing tests, then the bench project alone', () => {
    expect(browserPhases([])).toEqual([
      { name: 'parallel', args: ['test', '--grep-invert', '@timing'] },
      { name: 'serial', args: ['test', '--project=bench', '--workers=1'] },
    ]);
  });

  it('passes extra arguments to both phases', () => {
    for (const phase of browserPhases(['--reporter=dot'])) expect(phase.args.at(-1)).toBe('--reporter=dot');
  });
});

describe('runPhases', () => {
  const phases = browserPhases([]);

  it('runs the serial phase after a failed parallel phase and fails', () => {
    const run = vi.fn((phase: { name: string }) => (phase.name === 'parallel' ? 1 : 0));
    expect(runPhases(phases, run)).toBe(1);
    expect(run.mock.calls.map(([phase]) => phase.name)).toEqual(['parallel', 'serial']);
  });

  it('succeeds only when every phase succeeds', () => {
    expect(runPhases(phases, () => 0)).toBe(0);
    expect(runPhases(phases, (phase) => (phase.name === 'serial' ? 1 : 0))).toBe(1);
  });
});
