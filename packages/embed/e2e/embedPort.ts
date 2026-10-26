import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portForDirectory } from '../../../tools/harness/src/harnessPort';

/** The host pages' server sits this far above the embed server, outside the per-checkout range of 4410..4909. */
const HOST_PORT_OFFSET = 1000;

function portFrom(env: Record<string, string | undefined>, name: string): number | null {
  const raw = env[name];
  if (raw === undefined || raw === '') return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer in 1024..65535, got "${raw}"`);
  }
  return port;
}

// MS_EMBED_PORT (the embed build) and MS_EMBED_HOST_PORT (the host pages and models, another origin), else stable
// per-checkout ports from the package directory (the harness scheme), so worktrees can run the suite at the same time.
export function embedPorts(env: Record<string, string | undefined> = process.env): { frame: number; host: number } {
  const frame = portFrom(env, 'MS_EMBED_PORT') ?? portForDirectory(dirname(dirname(fileURLToPath(import.meta.url))));
  return { frame, host: portFrom(env, 'MS_EMBED_HOST_PORT') ?? frame + HOST_PORT_OFFSET };
}
