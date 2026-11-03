import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineSplitter, refuseArguments, runSuites, suiteSpawn, type SuiteTask } from './browserSuites.ts';
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
  const plan = suiteSpawn(
    { suite, kind },
    {
      root,
      npmExecpath: process.env['npm_execpath'],
      env: process.env,
      node: process.execPath,
      playwrightCli: (packageDir) =>
        createRequire(join(root, packageDir, 'package.json')).resolve('@playwright/test/cli'),
    },
  );
  if ('error' in plan) {
    console.error(`${label}${plan.error}`);
    return Promise.resolve(2);
  }
  return new Promise((resolve) => {
    const child = spawn(plan.file, plan.args, { cwd: plan.cwd, env: plan.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const refusal = refuseArguments(process.argv.slice(2));
  if (refusal !== null) throw new Error(refusal);
  suitePorts(process.env);
  const exit = await runSuites(runTask);
  process.exitCode = exit > 255 ? 255 : exit;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
