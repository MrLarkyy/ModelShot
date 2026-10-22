import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { anchors, buildWiki, convert, slugify } from '../build.mjs';
import { table } from '../pages.mjs';

const REPO = 'https://example.test/o/r';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('slugify', () => {
  test('follows the GitHub anchor rules', () => {
    expect(slugify('Not supported (reported)')).toBe('not-supported-reported');
    expect(slugify('glTF / GLB loader')).toBe('gltf--glb-loader');
    expect(slugify('The `render()` call')).toBe('the-render-call');
    expect(slugify('Snake_case and *bold* and _em_')).toBe('snake_case-and-bold-and-em');
    expect(slugify('A [link](x.md) here')).toBe('a-link-here');
    expect(slugify('Größe & Maß')).toBe('größe--maß');
  });

  test('numbers duplicates and ignores headings in fences', () => {
    const md = '# A\n\n## Same\n\n```md\n## Hidden\n```\n\n## Same\n\n## Same\n';
    expect([...anchors(md)]).toEqual(['a', 'same', 'same-1', 'same-2']);
  });
});

describe('convert', () => {
  const run = (md, ctx) => convert('x.md', md, table, REPO, ctx);

  test('rewrites page links with and without anchors', () => {
    const md = '[a](camera.md) [b](./camera.md#one) [c](#top)\n\n# Top\n';
    const { text, problems } = run(md, { anchorsByFile: new Map([['camera.md', new Set(['one'])]]) });
    expect(text).toBe('[a](Camera) [b](Camera#one) [c](#top)\n\n# Top\n');
    expect(problems).toEqual([]);
  });

  test('turns other repository paths into blob links and leaves absolute links alone', () => {
    const { text, problems } = run('[p](../packages/scene/src) [h](https://a.test/x.md) [m](mailto:a@b.c)', {
      repoRoot: root,
    });
    expect(text).toBe(`[p](${REPO}/tree/main/packages/scene/src) [h](https://a.test/x.md) [m](mailto:a@b.c)`);
    expect(problems).toEqual([]);
    expect(run('[r](../README.md)', { repoRoot: root }).text).toBe(`[r](${REPO}/blob/main/README.md)`);
  });

  test('leaves links in inline code and in fences untouched', () => {
    const md = 'see `[a](camera.md)` and\n\n```md\n[a](camera.md)\n```\n';
    const { text, problems } = run(md);
    expect(text).toBe(md);
    expect(problems).toEqual([]);
  });

  test('reports a missing page, anchor and repository path with file and line', () => {
    expect(run('\n[a](nope.md)').problems).toEqual([
      'docs/x.md:2 link to docs/nope.md, which is not in the page table',
    ]);
    expect(run('[a](camera.md#gone)', { anchorsByFile: new Map([['camera.md', new Set()]]) }).problems).toEqual([
      'docs/x.md:1 anchor #gone not found in docs/camera.md',
    ]);
    expect(run('[a](#gone)').problems).toEqual(['docs/x.md:1 anchor #gone not found in docs/x.md']);
    expect(run('[a](../nothing/here.ts)', { repoRoot: root }).problems).toEqual([
      'docs/x.md:1 link target ../nothing/here.ts does not exist in the repository',
    ]);
  });
});

describe('buildWiki', () => {
  test('a docs file missing from the table and a row without a file are problems', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-docs-'));
    const docs = path.join(dir, 'docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'extra.md'), '# Extra\n');
    const { problems } = buildWiki({ docsDir: docs, repoUrl: REPO });
    expect(problems).toContain('docs/extra.md is not in the page table (tools/wiki/pages.mjs)');
    expect(problems).toContain('docs/camera.md is in the page table but the file is missing');
  });

  test('the real docs build without problems, one page per docs file', () => {
    const { files, problems } = buildWiki({ docsDir: path.join(root, 'docs'), repoUrl: REPO });
    expect(problems).toEqual([]);
    const docs = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md'));
    expect(docs.length).toBe(table.size);
    for (const f of docs) expect(files.has(`${table.get(f).page}.md`)).toBe(true);
    const home = files.get('Home.md');
    const sidebar = files.get('_Sidebar.md');
    for (const p of table.values()) {
      expect(home).toContain(`(${p.page})`);
      expect(sidebar).toContain(`(${p.page})`);
    }
    expect(files.get('_Footer.md')).toContain(`${REPO}/tree/main/docs`);
  });
});

describe('README', () => {
  test('links the wiki, never docs/*.md, and lists every page', () => {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(readme).not.toContain('](docs/');
    for (const p of table.values()) {
      expect(readme).toContain(`(https://github.com/MrLarkyy/ModelShot/wiki/${p.page})`);
    }
  });
});
