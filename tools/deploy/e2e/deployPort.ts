import { suitePorts } from '../../harness/src/harnessPort.ts';

// MS_DEPLOY_PORT (the site as Pages serves it) and MS_DEPLOY_HOST_PORT (a page on another origin that embeds the
// viewer), else their bands of the per-checkout port scheme (suitePorts), so worktrees and the other suites can run
// at the same time.
export function deployPorts(env: Record<string, string | undefined> = process.env): { site: number; host: number } {
  const ports = suitePorts(env);
  return { site: ports.deploySite, host: ports.deployHost };
}
