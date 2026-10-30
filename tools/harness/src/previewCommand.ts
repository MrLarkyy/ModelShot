import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The command of a suite's Playwright web server. Alone, `pnpm run serve:e2e` builds what it serves. After the
 * concurrent runner built everything, vite starts directly from the package's `preview:e2e` script (one source for its
 * flags): pnpm as the wrapper printed ELIFECYCLE when Playwright stopped the server at the end of a loaded run.
 */
export function previewCommand(packageDir: string, port: number, prebuilt: boolean): string {
  if (!prebuilt) return `pnpm run serve:e2e --port ${port}`;
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const script = manifest.scripts?.['preview:e2e'];
  if (script === undefined || !script.startsWith('vite preview ')) {
    throw new Error(`${packageDir}: the preview:e2e script must start with "vite preview "`);
  }
  return `node node_modules/vite/bin/vite.js ${script.slice('vite '.length)} --port ${port}`;
}
