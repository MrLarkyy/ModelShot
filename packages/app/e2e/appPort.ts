import { suitePorts } from '../../../tools/harness/src/harnessPort';

// MS_APP_PORT, else the app band of the per-checkout port scheme (suitePorts), so worktrees and the other suites can
// run at the same time.
export function appPort(env: Record<string, string | undefined> = process.env): number {
  return suitePorts(env).app;
}
