import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserPhases, runPhases, type BrowserPhase } from './browserPhases.ts';

const harnessDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;

function runPhase(phase: BrowserPhase): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...phase.args], { cwd: harnessDirectory, stdio: 'inherit' });
    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    for (const signal of FORWARDED) process.on(signal, forward);
    const done = (code: number): void => {
      for (const signal of FORWARDED) process.off(signal, forward);
      resolve(code);
    };
    child.on('error', (error) => {
      console.error(`[phases] ${phase.name}: could not start Playwright: ${error.message}`);
      done(2);
    });
    child.on('exit', (status, signal) => {
      if (signal) {
        console.error(`[phases] ${phase.name}: Playwright ended by ${signal}`);
        done(128 + (constants.signals[signal] ?? 1));
      } else {
        done(status ?? 2);
      }
    });
  });
}

try {
  const exit = await runPhases(browserPhases(process.argv.slice(2)), runPhase);
  process.exitCode = exit > 255 ? 255 : exit;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
