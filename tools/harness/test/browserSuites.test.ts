import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUITES, lineSplitter, runSuites, type SuiteName, type SuiteTask } from '../src/browserSuites';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

function scripts(packageDir: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(root, packageDir, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts;
}

describe('suite outputs', () => {
  it('are disjoint: no directory equals or contains another', () => {
    const all = SUITES.flatMap((suite) => suite.outputs.map((dir) => ({ suite: suite.name, dir: resolve(root, dir) })));
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        expect(a.dir === b.dir || a.dir.startsWith(b.dir + sep), `${a.suite} ${a.dir} vs ${b.suite} ${b.dir}`).toBe(
          false,
        );
      }
    }
  });

  it('match the --outDir of the e2e build and preview scripts', () => {
    for (const name of ['app', 'embed', 'site'] as const) {
      const suite = SUITES.find((s) => s.name === name)!;
      const [output] = suite.outputs;
      const dir = output!.slice(suite.packageDir.length + 1);
      const mine = scripts(suite.packageDir);
      const outDirs = [...(mine['build:e2e'] ?? '').matchAll(/--outDir (\S+)/g)].map((m) => m[1]);
      expect(outDirs.length, name).toBeGreaterThan(0);
      for (const outDir of outDirs) expect(outDir === dir || outDir === `../${name}/${dir}/app`, name).toBe(true);
      if (name !== 'site') expect(mine['preview:e2e'], name).toContain(`--outDir ${dir}`);
    }
  });
});

describe('suite scripts', () => {
  it('mirror the test:browser script of every suite package', () => {
    for (const suite of SUITES) expect(scripts(suite.packageDir)['test:browser'], suite.name).toBe('playwright test');
  });
});

describe('playwright configs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function commands(prebuilt: boolean): Promise<Record<SuiteName, string[]>> {
    vi.resetModules();
    if (prebuilt) vi.stubEnv('MS_E2E_PREBUILT', '1');
    else vi.stubEnv('MS_E2E_PREBUILT', '');
    vi.stubEnv('MS_DEPLOY_URL', '');
    const list = (config: { webServer?: unknown }): string[] =>
      [config.webServer ?? []].flat().map((server) => (server as { command: string }).command);
    return {
      app: list((await import('../../../packages/app/playwright.config.ts')).default),
      embed: list((await import('../../../packages/embed/playwright.config.ts')).default),
      site: list((await import('../../../packages/site/playwright.config.ts')).default),
      deploy: list((await import('../../deploy/playwright.config.ts')).default),
    };
  }

  it('serve only when the runner built them', async () => {
    for (const [name, list] of Object.entries(await commands(true))) {
      for (const command of list) expect(command, name).not.toMatch(/build|serve:e2e/);
    }
  });

  it('build what they serve when run alone', async () => {
    const alone = await commands(false);
    expect(alone.app[0]).toContain('serve:e2e');
    expect(alone.embed[0]).toContain('serve:e2e');
    expect(alone.site[0]).toMatch(/build:e2e && .*--outDir dist-e2e/);
    expect(alone.deploy[0]).toContain('run build && node e2e/serve.ts');
  });
});

describe('runSuites', () => {
  interface Fake {
    run: (task: SuiteTask) => Promise<number>;
    events: string[];
    active: Set<string>;
    maxBuildsRunning: () => number;
  }

  function fake(exits: Record<string, number> = {}, delays: Record<string, number> = {}): Fake {
    const events: string[] = [];
    const active = new Set<string>();
    let peak = 0;
    return {
      events,
      active,
      maxBuildsRunning: () => peak,
      run: async ({ suite, kind }) => {
        const id = `${kind} ${suite.name}`;
        events.push(`start ${id}`);
        active.add(id);
        if (kind === 'build') peak = Math.max(peak, [...active].filter((a) => a.startsWith('build')).length);
        await new Promise((r) => setTimeout(r, delays[id] ?? 1));
        active.delete(id);
        events.push(`end ${id}`);
        return exits[id] ?? 0;
      },
    };
  }

  const quiet = (): void => undefined;
  const run = (f: Fake): Promise<number> => runSuites(f.run, () => 0, quiet);
  const started = (f: Fake): string[] =>
    f.events.filter((e) => e.startsWith('start')).map((e) => e.slice('start '.length));

  it('starts every build before any test, all builds at once', async () => {
    const f = fake();
    expect(await run(f)).toBe(0);
    const firstTest = f.events.findIndex((e) => e.startsWith('start test'));
    const lastBuildEnd = f.events.map((e, i) => (e.startsWith('end build') ? i : -1)).reduce((a, b) => Math.max(a, b));
    expect(lastBuildEnd).toBeLessThan(firstTest);
    expect(f.maxBuildsRunning()).toBe(4);
  });

  it('runs the lanes at once, site before deploy', async () => {
    const f = fake({}, { 'test site': 20, 'test app': 20, 'test embed': 20 });
    await run(f);
    const tests = started(f).filter((s) => s.startsWith('test'));
    expect(tests.slice(0, 3).sort()).toEqual(['test app', 'test embed', 'test site']);
    expect(tests[3]).toBe('test deploy');
    expect(f.events.indexOf('end test site')).toBeLessThan(f.events.indexOf('start test deploy'));
  });

  it('runs deploy after a failed site test and fails', async () => {
    const f = fake({ 'test site': 1 });
    expect(await run(f)).toBe(1);
    expect(started(f)).toContain('test deploy');
  });

  it('skips the tests of a failed build, runs the others and fails', async () => {
    const f = fake({ 'build embed': 1 });
    expect(await run(f)).toBe(1);
    expect(started(f)).not.toContain('test embed');
    expect(started(f)).toEqual(expect.arrayContaining(['test app', 'test site', 'test deploy']));
  });

  it('lets the other suites finish after a failed test', async () => {
    const f = fake({ 'test app': 1 }, { 'test embed': 20 });
    expect(await run(f)).toBe(1);
    expect(f.events).toContain('end test embed');
  });

  it.each([130, 4294967295])('starts nothing new after a build ends with %i and returns it', async (code) => {
    const f = fake({ 'build app': code });
    expect(await run(f)).toBe(code);
    expect(started(f).filter((s) => s.startsWith('test'))).toEqual([]);
  });

  it.each([130, 4294967295])('starts nothing new after a test ends with %i and returns it', async (code) => {
    const f = fake({ 'test site': code }, { 'test app': 20 });
    expect(await run(f)).toBe(code);
    expect(started(f)).not.toContain('test deploy');
  });

  it('ends with one summary line of exit codes and durations', async () => {
    const lines: string[] = [];
    let clock = 0;
    const f = fake({ 'test app': 1 });
    await runSuites(
      f.run,
      () => (clock += 1500),
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[suites\] build \w+ 0 \d+s, .*test app 1 \d+s/);
  });
});

describe('lineSplitter', () => {
  function collect(chunks: string[]): string[] {
    const lines: string[] = [];
    const splitter = lineSplitter('[x] ', (line) => lines.push(line));
    for (const chunk of chunks) splitter.push(chunk);
    splitter.end();
    return lines;
  }

  it('joins a line cut at a chunk boundary and prefixes each line once', () => {
    expect(collect(['ab', 'c\nde', 'f\n'])).toEqual(['[x] abc', '[x] def']);
  });

  it('handles CRLF', () => {
    expect(collect(['a\r\nb\r\n'])).toEqual(['[x] a', '[x] b']);
  });

  it('flushes an unterminated last line on end', () => {
    expect(collect(['a\nb'])).toEqual(['[x] a', '[x] b']);
  });

  it('emits nothing for an empty stream', () => {
    expect(collect([])).toEqual([]);
  });
});
