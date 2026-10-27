import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portForDirectory } from '../../harness/src/harnessPort.ts';

/** The host page server sits this far above the site server, outside the per-checkout range of 4410..4909. */
const HOST_PORT_OFFSET = 2000;

function portFrom(env: Record<string, string | undefined>, name: string): number | null {
  const raw = env[name];
  if (raw === undefined || raw === '') return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer in 1024..65535, got "${raw}"`);
  }
  return port;
}

// MS_DEPLOY_PORT (the site as Pages serves it) and MS_DEPLOY_HOST_PORT (a page on another origin that embeds the
// viewer), else stable per-checkout ports from the package directory (the harness scheme), so worktrees can run the
// suite at the same time.
export function deployPorts(env: Record<string, string | undefined> = process.env): { site: number; host: number } {
  const site = portFrom(env, 'MS_DEPLOY_PORT') ?? portForDirectory(dirname(dirname(fileURLToPath(import.meta.url))));
  return { site, host: portFrom(env, 'MS_DEPLOY_HOST_PORT') ?? site + HOST_PORT_OFFSET };
}
