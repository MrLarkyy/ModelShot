const GIB = 1024 ** 3;
const MAX_WORKERS = 32;
const LOCAL_CAP = 6;

// SwiftShader runs several threads per page, so one worker per four logical CPUs; the float render targets of the
// path tracer and the bakes need about 2 GiB per worker.
export function playwrightWorkers(env: Record<string, string | undefined>, cpus: number, totalBytes: number): number {
  const raw = env['MS_PW_WORKERS'];
  if (raw !== undefined && raw !== '') {
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 1 || count > MAX_WORKERS) {
      throw new Error(`MS_PW_WORKERS must be an integer in 1..${MAX_WORKERS}, got "${raw}"`);
    }
    return count;
  }
  if (env['CI']) return 1;
  return Math.max(1, Math.min(LOCAL_CAP, Math.floor(cpus / 4), Math.floor(totalBytes / (2 * GIB))));
}
