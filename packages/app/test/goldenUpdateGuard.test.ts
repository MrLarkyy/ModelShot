import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const guard = fileURLToPath(new URL('../../site/scripts/refuseInCi.mjs', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

function run(env: Record<string, string>): { status: number | null; stderr: string } {
  const base = { ...process.env };
  delete base['CI'];
  const { status, stderr } = spawnSync(process.execPath, [guard, 'golden:update:app'], {
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  return { status, stderr };
}

describe('pnpm golden:update:app', () => {
  it('is refused when CI is set and names the script to run on a dev machine', () => {
    const result = run({ CI: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pnpm golden:update:app');
  });

  it('is allowed outside CI', () => {
    expect(run({}).status).toBe(0);
  });

  it('runs the guard before Playwright rewrites any golden', () => {
    const script = manifest.scripts['golden:update'] ?? '';
    expect(script.startsWith('node ../site/scripts/refuseInCi.mjs golden:update:app && ')).toBe(true);
    expect(script).toContain('--update-snapshots=all app.system');
  });
});
