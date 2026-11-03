import { suitePorts } from '../../../tools/harness/src/harnessPort';

// MS_EMBED_PORT (the embed build) and MS_EMBED_HOST_PORT (the host pages and models, another origin), else their
// bands of the per-checkout port scheme (suitePorts), so worktrees and the other suites can run at the same time.
export function embedPorts(env: Record<string, string | undefined> = process.env): { frame: number; host: number } {
  const ports = suitePorts(env);
  return { frame: ports.embedFrame, host: ports.embedHost };
}
