import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portForDirectory } from '../../../tools/harness/src/harnessPort';

// MS_APP_PORT, else a stable per-checkout port from the app directory (the harness scheme), so worktrees can run the
// app tests at the same time.
export function appPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env['MS_APP_PORT'];
  if (raw !== undefined && raw !== '') {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`MS_APP_PORT must be an integer in 1024..65535, got "${raw}"`);
    }
    return port;
  }
  return portForDirectory(dirname(dirname(fileURLToPath(import.meta.url))));
}
