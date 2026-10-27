export interface BrowserPhase {
  name: 'parallel' | 'serial';
  args: string[];
}

// Playwright exits 1 when tests failed; any other code is a kill, an interrupt or a failed launch.
const TEST_FAILURE_EXIT = 1;

// The timing tests (bench and every @timing test) must not share the machine with another test, so they run in a
// second Playwright run once the parallel one has ended. No project dependency: that would skip them after a golden
// failure and pull the goldens into the CI bench job.
export function browserPhases(extraArgs: string[]): BrowserPhase[] {
  if (extraArgs.length > 0) {
    throw new Error(
      `test:browser takes no arguments (got "${extraArgs.join(' ')}"): it runs both phases whole. ` +
        'For a filtered run use `pnpm exec playwright test <filter>` in tools/harness.',
    );
  }
  return [
    { name: 'parallel', args: ['test', '--grep-invert', '@timing'] },
    { name: 'serial', args: ['test', '--project=bench', '--workers=1'] },
  ];
}

// A failed test run still lets the next phase run; a phase that was killed or interrupted stops the runner, so no
// orphan bench run starts after the caller gave up.
export async function runPhases(
  phases: BrowserPhase[],
  run: (phase: BrowserPhase) => Promise<number>,
): Promise<number> {
  const exits: string[] = [];
  let result = 0;
  for (const phase of phases) {
    const exit = await run(phase);
    exits.push(`${phase.name} exit ${exit}`);
    if (exit !== 0 && exit !== TEST_FAILURE_EXIT) {
      console.log(`[phases] ${exits.join(', ')}; stopped, the remaining phases did not run`);
      return exit;
    }
    if (exit !== 0) result = exit;
  }
  console.log(`[phases] ${exits.join(', ')}`);
  return result;
}
