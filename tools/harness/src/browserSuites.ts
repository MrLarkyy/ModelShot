import { join } from 'node:path';

export type SuiteName = 'app' | 'embed' | 'site' | 'deploy';

export interface Suite {
  name: SuiteName;
  /** The package directory (repository root relative) whose Playwright config the test step runs. */
  packageDir: string;
  /** The pnpm command that builds what the suite serves, and the directory it runs in. */
  build: { args: string[]; cwd: string };
  /** Every directory the build writes, repository root relative. No two suites may share or nest one. */
  outputs: string[];
}

export interface SuiteTask {
  suite: Suite;
  kind: 'build' | 'test';
}

export interface SuiteResult {
  suite: SuiteName;
  kind: 'build' | 'test';
  exit: number;
  seconds: number;
}

// Playwright and the build tools exit 1 on failure; any other code is a kill, an interrupt or a failed launch.
const FAILURE_EXIT = 1;

export const SUITES: Suite[] = [
  {
    name: 'app',
    packageDir: 'packages/app',
    build: { args: ['run', 'build:e2e'], cwd: 'packages/app' },
    outputs: ['packages/app/dist-e2e'],
  },
  {
    name: 'embed',
    packageDir: 'packages/embed',
    build: { args: ['run', 'build:e2e'], cwd: 'packages/embed' },
    outputs: ['packages/embed/dist-e2e'],
  },
  {
    name: 'site',
    packageDir: 'packages/site',
    build: { args: ['run', 'build:e2e'], cwd: 'packages/site' },
    outputs: ['packages/site/dist-e2e'],
  },
  {
    // The production chain of the deploy artifact (tools/deploy/src/layout.ts): the only build that writes dist.
    name: 'deploy',
    packageDir: 'tools/deploy',
    build: { args: ['--filter', '@modelshot/deploy...', 'run', 'build'], cwd: '.' },
    outputs: [
      ...['app', 'embed', 'site', 'export', 'formats', 'looks', 'pathtracer', 'renderer-rt', 'scene'].map(
        (name) => `packages/${name}/dist`,
      ),
      'tools/deploy/dist',
    ],
  },
];

// The deploy tests are the shortest, so they follow the site tests in one lane: the same wall time as four lanes with
// one browser fewer running at once.
export const SUITE_LANES: SuiteName[][] = [['app'], ['embed'], ['site', 'deploy']];

/**
 * Every build first, all at once and with no test running (the build is the largest CPU spike and the suites assert
 * wall-clock bounds); then the lanes at once. A failed build skips only its own tests. A kill or an interrupt stops
 * the runner: nothing new starts and that exit code is returned.
 */
export async function runSuites(
  run: (task: SuiteTask) => Promise<number>,
  now: () => number = () => performance.now(),
  log: (line: string) => void = (line) => console.log(line),
): Promise<number> {
  const results: SuiteResult[] = [];
  const buildFailed = new Set<SuiteName>();
  let testFailed = false;
  let stopped: number | null = null;

  const step = async (suite: Suite, kind: 'build' | 'test'): Promise<void> => {
    const start = now();
    const exit = await run({ suite, kind });
    results.push({ suite: suite.name, kind, exit, seconds: (now() - start) / 1000 });
    if (exit === 0) return;
    if (exit !== FAILURE_EXIT) stopped ??= exit;
    else if (kind === 'build') buildFailed.add(suite.name);
    else testFailed = true;
  };

  await Promise.all(SUITES.map((suite) => step(suite, 'build')));
  if (stopped === null) {
    await Promise.all(
      SUITE_LANES.map(async (lane) => {
        for (const name of lane) {
          if (stopped !== null) return;
          if (buildFailed.has(name)) continue;
          await step(
            SUITES.find((suite) => suite.name === name)!,
            'test',
          );
        }
      }),
    );
  }

  const line = results.map((r) => `${r.kind} ${r.suite} ${r.exit} ${formatSeconds(r.seconds)}`).join(', ');
  log(`[suites] ${line}${stopped === null ? '' : '; stopped, nothing new started'}`);
  if (stopped !== null) return stopped;
  return buildFailed.size > 0 || testFailed ? FAILURE_EXIT : 0;
}

export function formatSeconds(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

/** Splits streamed chunks into lines (LF or CRLF), each emitted once with the prefix; `end` flushes the partial one. */
export function lineSplitter(prefix: string, emit: (line: string) => void): { push(chunk: string): void; end(): void } {
  let rest = '';
  return {
    push(chunk) {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) emit(`${prefix}${line.replace(/\r$/, '')}`);
    },
    end() {
      if (rest !== '') emit(`${prefix}${rest.replace(/\r$/, '')}`);
      rest = '';
    },
  };
}

export interface SpawnPlan {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

/** The process that runs one task, or the reason it cannot (exit 2). Only test children get MS_E2E_PREBUILT. */
export function suiteSpawn(
  { suite, kind }: SuiteTask,
  context: {
    root: string;
    npmExecpath: string | undefined;
    env: Record<string, string | undefined>;
    node: string;
    playwrightCli: (packageDir: string) => string;
  },
): SpawnPlan | { error: string } {
  if (kind === 'test') {
    return {
      file: context.node,
      // The absolute CLI path keeps the child findable by the workspace runner's stray-process sweep.
      args: [context.playwrightCli(suite.packageDir), 'test'],
      cwd: join(context.root, suite.packageDir),
      env: { ...context.env, MS_E2E_PREBUILT: '1' },
    };
  }
  const pnpm = context.npmExecpath;
  if (pnpm === undefined) return { error: 'cannot find pnpm: run it through pnpm (pnpm test:browser)' };
  const cwd = join(context.root, suite.build.cwd);
  // pnpm is a script under npm and a native executable under corepack.
  if (/\.[cm]?js$/.test(pnpm)) return { file: context.node, args: [pnpm, ...suite.build.args], cwd, env: context.env };
  return { file: pnpm, args: suite.build.args, cwd, env: context.env };
}

/** The runner takes no arguments: a message when it got some. */
export function refuseArguments(argv: string[]): string | null {
  if (argv.length === 0) return null;
  return (
    `test:suites takes no arguments (got "${argv.join(' ')}"): it runs the four suites whole. ` +
    'For one suite run `pnpm --filter @modelshot/<suite> run test:browser`.'
  );
}
