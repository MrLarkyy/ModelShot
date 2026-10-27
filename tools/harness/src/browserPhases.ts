export interface BrowserPhase {
  name: 'parallel' | 'serial';
  args: string[];
}

// The timing tests (bench and every @timing test) must not share the machine with another test, so they run in a
// second Playwright run once the parallel one has ended. No project dependency: that would skip them after a golden
// failure and pull the goldens into the CI bench job.
export function browserPhases(extraArgs: string[]): BrowserPhase[] {
  return [
    { name: 'parallel', args: ['test', '--grep-invert', '@timing', ...extraArgs] },
    { name: 'serial', args: ['test', '--project=bench', '--workers=1', ...extraArgs] },
  ];
}

export function runPhases(phases: BrowserPhase[], run: (phase: BrowserPhase) => number): number {
  const exits = phases.map((phase) => ({ phase, exit: run(phase) }));
  console.log(`[phases] ${exits.map(({ phase, exit }) => `${phase.name} exit ${exit}`).join(', ')}`);
  return exits.every(({ exit }) => exit === 0) ? 0 : 1;
}
