import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserPhases, runPhases } from './browserPhases.ts';

const harnessDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

process.exitCode = runPhases(browserPhases(process.argv.slice(2)), (phase) => {
  const result = spawnSync(process.execPath, [cli, ...phase.args], { cwd: harnessDirectory, stdio: 'inherit' });
  return result.status ?? 1;
});
