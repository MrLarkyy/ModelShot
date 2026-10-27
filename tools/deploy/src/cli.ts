import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './assemble.ts';
import { checkDist } from './checkDist.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'tools', 'deploy', 'dist');

try {
  await assemble({ root, out });
} catch (error) {
  console.error(`deploy: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const problems = await checkDist(out);
for (const problem of problems) console.error(`deploy: ${problem}`);
if (problems.length > 0) process.exit(1);
console.log(`deploy: assembled ${out}`);
