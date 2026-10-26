import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLL_MS = 10_000;
// GitHub Pages sends max-age=600, so a changed file can take up to ten minutes to reach a cache in front of it.
const DEADLINE_MS = 10 * 60_000 + POLL_MS;

// Against a deployed URL: waits until the live app/sw.js is the file of the artifact under test (its version is a hash
// of every file the app ships), so the run tests this deploy and not the one before.
export default async function awaitDeploy(): Promise<void> {
  const live = process.env['MS_DEPLOY_URL'];
  if (live === undefined || live === '') return;
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'app', 'sw.js');
  const expected = await readFile(dist, 'utf8').catch(() => null);
  if (expected === null) {
    console.warn('deploy: tools/deploy/dist/app/sw.js is not here, so the live site is tested as it is');
    return;
  }
  const url = new URL('app/sw.js', live.replace(/\/*$/, '/')).href;
  let waited = 0;
  for (;;) {
    const response = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (response?.ok && (await response.text()) === expected) return;
    if (waited >= DEADLINE_MS)
      throw new Error(`${url} still differs from the deployed artifact after ${waited / 1000} s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    waited += POLL_MS;
  }
}
