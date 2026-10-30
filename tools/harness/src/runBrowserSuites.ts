import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineSplitter, runSuites, type SuiteTask } from './browserSuites.ts';
import { suitePorts } from './harnessPort.ts';

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;
const children = new Set<ReturnType<typeof spawn>>();

for (const signal of FORWARDED) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}

function runTask({ suite, kind }: SuiteTask): Promise<number> {
  const label = `[${suite.name}] ${kind === 'build' ? 'build: ' : ''}`;
  let executable = process.execPath;
  let command: string[];
  let cwd: string;
  if (kind === 'build') {
    const pnpm = process.env['npm_execpath'];
    if (pnpm === undefined) {
      console.error(`${label}cannot find pnpm: run it through pnpm (pnpm test:browser)`);
      return Promise.resolve(2);
    }
    // pnpm is a script under npm and a native executable under corepack.
    if (/\.[cm]?js$/.test(pnpm)) command = [pnpm, ...suite.build.args];
    else {
      executable = pnpm;
      command = suite.build.args;
    }
    cwd = join(root, suite.build.cwd);
  } else {
    // The absolute CLI path keeps the child findable by the workspace runner's stray-process sweep.
    const cli = createRequire(join(root, suite.packageDir, 'package.json')).resolve('@playwright/test/cli');
    command = [cli, 'test'];
    cwd = join(root, suite.packageDir);
  }
  return new Promise((resolve) => {
    const child = spawn(executable, command, {
      cwd,
      env: { ...process.env, ...(kind === 'test' ? { MS_E2E_PREBUILT: '1' } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const out = lineSplitter(label, (line) => console.log(line));
    const err = lineSplitter(label, (line) => console.error(line));
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => out.push(chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => err.push(chunk));
    const done = (code: number): void => {
      out.end();
      err.end();
      children.delete(child);
      resolve(code);
    };
    child.on('error', (error) => {
      console.error(`${label}could not start: ${error.message}`);
      done(2);
    });
    child.on('close', (status, signal) => {
      if (signal) {
        console.error(`${label}ended by ${signal}`);
        done(128 + (constants.signals[signal] ?? 1));
      } else {
        done(status ?? 2);
      }
    });
  });
}

try {
  if (process.argv.length > 2) {
    throw new Error(
      `test:suites takes no arguments (got "${process.argv.slice(2).join(' ')}"): it runs the four suites whole. ` +
        'For one suite run `pnpm --filter @modelshot/<suite> run test:browser`.',
    );
  }
  suitePorts(process.env);
  const exit = await runSuites(runTask);
  process.exitCode = exit > 255 ? 255 : exit;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
