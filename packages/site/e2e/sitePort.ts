import { suitePorts } from '../../../tools/harness/src/harnessPort';

// MS_SITE_PORT, else the site band of the per-checkout port scheme (suitePorts), so worktrees and the other suites
// can run at the same time.
export function sitePort(env: Record<string, string | undefined> = process.env): number {
  return suitePorts(env).site;
}
