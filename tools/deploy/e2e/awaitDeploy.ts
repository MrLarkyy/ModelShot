import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_FILES } from '../src/checkDist.ts';

const POLL_MS = 10_000;
// GitHub Pages sends max-age=600, so a changed file can take up to ten minutes to reach a cache in front of it.
const DEADLINE_MS = 10 * 60_000 + POLL_MS;

// Against a deployed URL: waits until every fixed-name file of the artifact under test (the three pages, app/sw.js and
// the element script; all other files carry a content hash) is live with the artifact's bytes, so the run tests this
// deploy and not the one before, or a half-propagated one.
export default async function awaitDeploy(): Promise<void> {
  const live = process.env['MS_DEPLOY_URL'];
  if (live === undefined || live === '') return;
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const base = live.replace(/\/*$/, '/');
  const expected = new Map<string, string>();
  for (const file of REQUIRED_FILES) {
    const text = await readFile(join(dist, file), 'utf8').catch(() => null);
    if (text !== null) expected.set(file, text);
  }
  if (expected.size === 0) {
    console.warn('deploy: tools/deploy/dist is not here, so the live site is tested as it is');
    return;
  }
  let waited = 0;
  for (;;) {
    const stale: string[] = [];
    for (const [file, text] of expected) {
      const response = await fetch(new URL(file, base), { cache: 'no-store' }).catch(() => null);
      if (!response?.ok || (await response.text()) !== text) stale.push(file);
    }
    if (stale.length === 0) return;
    if (waited >= DEADLINE_MS) {
      throw new Error(`${stale.join(', ')} still differ from the deployed artifact after ${waited / 1000} s`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    waited += POLL_MS;
  }
}
