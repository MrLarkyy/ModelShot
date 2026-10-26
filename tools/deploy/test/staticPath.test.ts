import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStaticPath } from '../e2e/staticPath.ts';
import { withTemp, writeTree } from './siteFixture.ts';

const PREFIX = '/ModelShot/';

async function resolveIn(path: string): Promise<ReturnType<typeof resolveStaticPath>> {
  return withTemp(async (dir) => {
    await writeTree(join(dir, 'site'), { 'index.html': 'root', 'app/index.html': 'app', 'app/a.js': 'js' });
    await writeTree(dir, { 'secret.txt': 'outside the site' });
    const result = resolveStaticPath(join(dir, 'site'), PREFIX, path);
    return result.kind === 'file'
      ? { kind: 'file', path: result.path.slice(dir.length).split(String.fromCharCode(92)).join('/') }
      : result;
  });
}

describe('resolveStaticPath', () => {
  it.each(['/ModelShot/../secret.txt', '/ModelShot/%2e%2e/secret.txt', '/ModelShot/app/%2e%2E/%2e%2e/secret.txt'])(
    'refuses traversal %s',
    async (path) => {
      expect(await resolveIn(path)).toEqual({ kind: 'badRequest' });
    },
  );

  it.each([
    '/ModelShot/app%2fa.js',
    '/ModelShot/app%5Ca.js',
    '/ModelShot/a%00.js',
    '/ModelShot/%E0%A4%A',
    '/ModelShot/a\\b',
  ])('refuses %s', async (path) => {
    expect(await resolveIn(path)).toEqual({ kind: 'badRequest' });
  });

  it('redirects the project path and a directory without its slash', async () => {
    expect(await resolveIn('/ModelShot')).toEqual({ kind: 'redirect', location: '/ModelShot/' });
    expect(await resolveIn('/ModelShot/app')).toEqual({ kind: 'redirect', location: '/ModelShot/app/' });
  });

  it('gives a directory its index.html and a file itself', async () => {
    expect(await resolveIn('/ModelShot/')).toEqual({ kind: 'file', path: '/site/index.html' });
    expect(await resolveIn('/ModelShot/app/')).toEqual({ kind: 'file', path: '/site/app/index.html' });
    expect(await resolveIn('/ModelShot/app/a.js')).toEqual({ kind: 'file', path: '/site/app/a.js' });
  });

  it('answers 404 for a missing file and for a path outside the prefix', async () => {
    expect(await resolveIn('/ModelShot/nope.js')).toEqual({ kind: 'notFound' });
    expect(await resolveIn('/index.html')).toEqual({ kind: 'notFound' });
  });
});
