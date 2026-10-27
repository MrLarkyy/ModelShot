import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assemble.ts';
import { withTemp, writeTree } from './siteFixture.ts';

async function builtRepo(root: string): Promise<void> {
  await writeTree(root, {
    'packages/site/dist/index.html': 'site',
    'packages/app/dist/index.html': 'app',
    'packages/app/dist/sw.js': 'sw',
    'packages/embed/dist/index.html': 'frame',
  });
}

describe('assemble', () => {
  it('copies the three builds into the hosted layout', async () => {
    await withTemp(async (dir) => {
      await builtRepo(dir);
      const out = join(dir, 'out');
      await assemble({ root: dir, out });
      expect((await readdir(out, { recursive: true })).map((p) => p.replaceAll('\\', '/')).sort()).toEqual([
        'app',
        'app/index.html',
        'app/sw.js',
        'embed',
        'embed/v1',
        'embed/v1/index.html',
        'index.html',
      ]);
    });
  });

  it('names a missing build', async () => {
    await withTemp(async (dir) => {
      await builtRepo(dir);
      await rm(join(dir, 'packages/embed/dist'), { recursive: true });
      await expect(assemble({ root: dir, out: join(dir, 'out') })).rejects.toThrow(
        /packages[/]embed[/]dist is missing/,
      );
    });
  });

  it('refuses a site build that already holds app/ (left over from build:with-app)', async () => {
    await withTemp(async (dir) => {
      await builtRepo(dir);
      await writeTree(dir, { 'packages/site/dist/app/index.html': 'stale' });
      await expect(assemble({ root: dir, out: join(dir, 'out') })).rejects.toThrow(/packages\/site\/dist\/app exists/);
    });
  });

  it('leaves no file of an earlier run behind', async () => {
    await withTemp(async (dir) => {
      await builtRepo(dir);
      const out = join(dir, 'out');
      await writeTree(out, { 'old.html': 'stale' });
      await writeFile(join(dir, 'packages/site/dist/new.html'), 'new');
      await assemble({ root: dir, out });
      const names = (await readdir(out)).sort();
      expect(names).toContain('new.html');
      expect(names).not.toContain('old.html');
    });
  });
});
