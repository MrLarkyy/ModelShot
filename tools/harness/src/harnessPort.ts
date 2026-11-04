import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_PORT = 4410;
const PORT_SPAN = 500;

type Env = Record<string, string | undefined>;

// Fixed bands of PORT_SPAN above the harness band, one per server; all far below the Windows dynamic range (49152).
const SUITE_BANDS = [
  ['site', 'MS_SITE_PORT'],
  ['app', 'MS_APP_PORT'],
  ['embedFrame', 'MS_EMBED_PORT'],
  ['embedHost', 'MS_EMBED_HOST_PORT'],
  ['deploySite', 'MS_DEPLOY_PORT'],
  ['deployHost', 'MS_DEPLOY_HOST_PORT'],
] as const;

// Ports Chrome refuses to connect to (ERR_UNSAFE_PORT) that fall inside the suite bands; the harness band has none.
const UNSAFE_PORTS = new Set([5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697]);

export type SuitePorts = Record<(typeof SUITE_BANDS)[number][0], number>;

function portFromEnv(env: Env, name: string): number | null {
  const raw = env[name];
  if (raw === undefined || raw === '') return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be an integer in 1024..65535, got "${raw}"`);
  }
  return port;
}

export function harnessPort(env: Env = process.env): number {
  const override = portFromEnv(env, 'MS_HARNESS_PORT');
  if (override !== null) return override;
  return portForDirectory(dirname(dirname(fileURLToPath(import.meta.url))));
}

export function portForDirectory(directory: string): number {
  let hash = 2166136261;
  for (const char of directory.toLowerCase().replaceAll('\\', '/')) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return BASE_PORT + (hash % PORT_SPAN);
}

// The four browser suites run at the same time, so their six servers get one offset per checkout (from the repository
// root) in six disjoint bands: distinct by construction. The offset is the checkout's hashed one, or the next one
// (wrapping inside PORT_SPAN) at which none of the six default ports is one Chrome blocks. Any two of the six on one port, an override equal to another
// server's default included, fail before a server starts.
function bandPort(index: number, offset: number): number {
  return BASE_PORT + PORT_SPAN * (index + 1) + offset;
}

/** The first offset from `start`, wrapping inside PORT_SPAN, whose six band ports are all safe for a browser. */
export function safeOffset(start: number): number {
  for (let step = 0; step < PORT_SPAN; step++) {
    const offset = (start + step) % PORT_SPAN;
    if (SUITE_BANDS.every((_, index) => !UNSAFE_PORTS.has(bandPort(index, offset)))) return offset;
  }
  throw new Error('every suite port offset lands on a port the browser blocks');
}

export function suitePorts(
  env: Env = process.env,
  root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
): SuitePorts {
  const offset = safeOffset(portForDirectory(root) - BASE_PORT);
  const ports: Partial<SuitePorts> = {};
  const owner = new Map<number, string>();
  SUITE_BANDS.forEach(([key, name], index) => {
    const override = portFromEnv(env, name);
    const port = override ?? bandPort(index, offset);
    const label = override === null ? `${name} (default)` : name;
    const other = owner.get(port);
    if (other !== undefined) throw new Error(`${other} and ${label} both resolve to port ${port}`);
    owner.set(port, label);
    ports[key] = port;
  });
  return ports as SuitePorts;
}
