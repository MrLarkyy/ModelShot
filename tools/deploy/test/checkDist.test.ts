import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDist } from '../src/checkDist.ts';
import { CSP, FRAME_CSP, cleanSite, page, withTemp, writeTree } from './siteFixture.ts';

async function problemsOf(
  change: (files: Record<string, string>) => void,
  remove: readonly string[] = [],
): Promise<string[]> {
  return withTemp(async (dir) => {
    const files = cleanSite();
    change(files);
    await writeTree(dir, files);
    for (const path of remove) await rm(join(dir, path));
    return checkDist(dir);
  });
}

describe('checkDist', () => {
  it('passes a site whose pages carry the policy', async () => {
    expect(await problemsOf(() => undefined)).toEqual([]);
  });

  it('names a page without a CSP meta', async () => {
    const problems = await problemsOf((f) => (f['app/index.html'] = page(null)));
    expect(problems).toEqual(['app/index.html: no Content-Security-Policy meta']);
  });

  it('refuses a CSP that comes after a script', async () => {
    const late = `<script src="./a.js"></script><meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
    const problems = await problemsOf((f) => (f['index.html'] = `<!doctype html><html><head>${late}</head></html>`));
    expect(problems.join()).toContain('index.html: the CSP meta comes after a script');
  });

  it('refuses two CSP metas', async () => {
    const two = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />${page(CSP)}`;
    const problems = await problemsOf((f) => (f['index.html'] = two));
    expect(problems.join()).toContain('index.html: 2 Content-Security-Policy metas');
  });

  it('refuses a wildcard source', async () => {
    const problems = await problemsOf(
      (f) => (f['index.html'] = page(CSP.replace("connect-src 'self'", 'connect-src *'))),
    );
    expect(problems.join()).toContain('connect-src has the wildcard source *');
  });

  it('refuses unsafe-inline', async () => {
    const problems = await problemsOf(
      (f) => (f['index.html'] = page(CSP.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"))),
    );
    expect(problems.join()).toContain("style-src allows 'unsafe-inline'");
  });

  it('refuses a host source', async () => {
    const problems = await problemsOf(
      (f) => (f['index.html'] = page(CSP.replace("img-src 'self'", "img-src 'self' cdn.example.com"))),
    );
    expect(problems.join()).toContain('img-src has the host source cdn.example.com');
  });

  it('allows https: and http: only in the connect-src of the frame', async () => {
    const wide = CSP.replace("connect-src 'self'", "connect-src 'self' https:");
    expect((await problemsOf((f) => (f['app/index.html'] = page(wide)))).join()).toContain('allows the scheme https:');
    const imgs = FRAME_CSP.replace("img-src 'self'", "img-src 'self' https:");
    expect((await problemsOf((f) => (f['embed/v1/index.html'] = page(imgs)))).join()).toContain(
      'img-src allows the scheme',
    );
  });

  it('refuses frame-ancestors', async () => {
    const problems = await problemsOf((f) => (f['embed/v1/index.html'] = page(`${FRAME_CSP}; frame-ancestors 'none'`)));
    expect(problems.join()).toContain('sets frame-ancestors');
  });

  it('refuses a root-absolute href, src and url()', async () => {
    const problems = await problemsOf((f) => {
      f['index.html'] = page(CSP, '<link rel="icon" href="/favicon.svg" />');
      f['app/a.css'] = 'a { background: url(/x.png) }';
    });
    expect(problems.join()).toContain('index.html: root-absolute URL href="/');
    expect(problems.join()).toContain('app/a.css: root-absolute URL url(/');
  });

  it('refuses a script or stylesheet from another origin but not a link to a page', async () => {
    const problems = await problemsOf((f) => {
      f['index.html'] = page(CSP, '<script src="https://cdn.example.com/a.js"></script>');
      f['app/index.html'] = page(CSP, '<a href="https://github.com/MrLarkyy/ModelShot">source</a>');
    });
    expect(problems.filter((p) => p.includes('another origin'))).toHaveLength(1);
    expect(problems.join()).not.toContain('app/index.html');
  });

  it('names a missing service worker and a missing element script', async () => {
    const problems = await problemsOf(() => undefined, ['app/sw.js', 'embed/v1/modelshot-embed.js']);
    expect(problems).toEqual(['app/sw.js is missing', 'embed/v1/modelshot-embed.js is missing']);
  });
});
