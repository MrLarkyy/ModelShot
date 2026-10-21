// Copies the self-hosted font files from the exact-pinned @fontsource packages into fonts/<family>/, with the
// package licence as OFL.txt. No network: the packages come from the lockfile. Run: pnpm --filter @modelshot/brand fonts:sync
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const brandRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(brandRoot, 'package.json'));

const FONT_FILES = {
  unbounded: ['unbounded-latin-600-normal.woff2', 'unbounded-latin-800-normal.woff2'],
  manrope: ['manrope-latin-400-normal.woff2', 'manrope-latin-500-normal.woff2', 'manrope-latin-700-normal.woff2'],
  'ibm-plex-mono': ['ibm-plex-mono-latin-500-normal.woff2'],
};

for (const [family, files] of Object.entries(FONT_FILES)) {
  const packageDir = dirname(require.resolve(`@fontsource/${family}/package.json`));
  const target = join(brandRoot, 'fonts', family);
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(target)) rmSync(join(target, name));
  for (const file of files) copyFileSync(join(packageDir, 'files', file), join(target, file));
  copyFileSync(join(packageDir, 'LICENSE'), join(target, 'OFL.txt'));
  console.log(`fonts/${family}: ${files.length} woff2 + OFL.txt`);
}
