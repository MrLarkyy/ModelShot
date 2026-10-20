import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_PORT = 4410;
const PORT_SPAN = 500;

export function harnessPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env['MS_HARNESS_PORT'];
  if (raw !== undefined && raw !== '') {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`MS_HARNESS_PORT must be an integer in 1024..65535, got "${raw}"`);
    }
    return port;
  }
  return portForDirectory(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function portForDirectory(directory: string): number {
  let hash = 2166136261;
  for (const char of directory.toLowerCase().replaceAll('\\', '/')) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return BASE_PORT + (hash % PORT_SPAN);
}
