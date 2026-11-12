// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('app playwright config timeouts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async (ci: string) => {
    vi.stubEnv('CI', ci);
    vi.resetModules();
    return (await import('../playwright.config')).default;
  };

  it('ends a CI shard at 17 minutes, before the 20-minute job limit cancels it and drops the report', async () => {
    expect((await load('true')).globalTimeout).toBe(17 * 60_000);
  });

  it('sets no global limit locally', async () => {
    expect((await load('')).globalTimeout).toBe(0);
  });

  it('keeps the 120 s test default: a slower test sets its own, so a hang costs two minutes', async () => {
    expect((await load('true')).timeout).toBe(120_000);
  });

  it('splits the suite per test under --shard while it runs one worker', async () => {
    const config = await load('true');
    expect(config.fullyParallel).toBe(true);
    expect(config.workers).toBe(1);
  });

  it('keeps the trace of a failed test on CI only, so a failure that does not repeat locally can be read', async () => {
    expect((await load('true')).use?.trace).toBe('retain-on-failure');
    expect((await load('')).use?.trace).toBe('off');
  });
});
