#!/usr/bin/env node
// @ts-check
// Builds the GitHub wiki from docs/*.md: page names, rewritten links, Home, sidebar and footer. docs/ is the only source;
// nothing generated here is committed.
//
//   node tools/wiki/build.mjs --check          report broken links and pages missing from the table (exit 1)
//   node tools/wiki/build.mjs --out <dir>      write the wiki files (refuses when there are problems)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groups, table as defaultTable } from './pages.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DOCS = path.join(here, '..', '..', 'docs');
export const DEFAULT_REPO_URL = 'https://github.com/MrLarkyy/ModelShot';

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Calls `visit(line, inFence, index)` for every line; a fence opener, its body and its closer are all in a fence.
 * @param {string} markdown
 * @param {(line: string, inFence: boolean, index: number) => void} visit
 */
function eachLine(markdown, visit) {
  let fence = '';
  markdown.split('\n').forEach((line, index) => {
    const m = FENCE.exec(line);
    if (fence) {
      visit(line, true, index);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = '';
    } else if (m) {
      fence = m[1];
      visit(line, true, index);
    } else visit(line, false, index);
  });
}

/**
 * GitHub's anchor for a heading text.
 * @param {string} heading
 */
export function slugify(heading) {
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/(`+[^`]*`+)/)
    .map((part, i) => {
      if (i % 2 === 1) return part.replace(/^`+|`+$/g, '');
      return part
        .replace(/<[^>]+>/g, '')
        .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e) => {
          if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
          const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
        })
        .replace(/(^|[^\p{L}\p{N}_])_+([^_]+)_+(?=$|[^\p{L}\p{N}_])/gu, '$1$2')
        .replace(/\*/g, '');
    })
    .join('')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

/**
 * The heading anchors of a page, duplicates numbered like GitHub does.
 * @param {string} markdown
 */
export function anchors(markdown) {
  /** @type {Set<string>} */
  const found = new Set();
  /** @type {Map<string, number>} */
  const seen = new Map();
  eachLine(markdown, (line, inFence) => {
    const m = inFence ? null : /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!m) return;
    const slug = slugify(m[1]);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    found.add(n === 0 ? slug : `${slug}-${n}`);
  });
  return found;
}

/**
 * Rewrites the link targets of one docs page for the wiki.
 * @param {string} file docs file name
 * @param {string} markdown
 * @param {Map<string, import('./pages.mjs').WikiPage>} table
 * @param {string} repoUrl
 * @param {{ repoRoot?: string, anchorsByFile?: Map<string, Set<string>> }} [ctx]
 * @returns {{ text: string, problems: string[] }}
 */
export function convert(file, markdown, table, repoUrl, ctx = {}) {
  /** @type {string[]} */
  const problems = [];
  const own = anchors(markdown);

  /**
   * @param {string} target
   * @param {number} index
   * @param {boolean} [image]
   */
  const rewrite = (target, index, image = false) => {
    const where = `docs/${file}:${index + 1}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return target;
    const hash = target.indexOf('#');
    const rawPath = hash < 0 ? target : target.slice(0, hash);
    const frag = hash < 0 ? '' : target.slice(hash + 1);
    if (rawPath === '') {
      if (frag && !own.has(frag)) problems.push(`${where} anchor #${frag} not found in docs/${file}`);
      return target;
    }
    const resolved = path.posix.normalize(path.posix.join('docs', rawPath));
    if (path.posix.dirname(resolved) === 'docs' && resolved.endsWith('.md')) {
      const name = path.posix.basename(resolved);
      const page = table.get(name);
      if (!page) {
        problems.push(`${where} link to docs/${name}, which is not in the page table`);
        return target;
      }
      const set = ctx.anchorsByFile?.get(name);
      if (frag && set && !set.has(frag)) problems.push(`${where} anchor #${frag} not found in docs/${name}`);
      return frag ? `${page.page}#${frag}` : page.page;
    }
    let isDir = false;
    if (ctx.repoRoot !== undefined) {
      const abs = path.join(ctx.repoRoot, ...resolved.split('/'));
      if (resolved.startsWith('..') || !fs.existsSync(abs)) {
        problems.push(`${where} link target ${rawPath} does not exist in the repository`);
        return target;
      }
      isDir = fs.statSync(abs).isDirectory();
    }
    const clean = resolved.replace(/\/$/, '');
    return `${repoUrl}/${isDir ? 'tree' : image ? 'raw' : 'blob'}/main/${clean}${frag ? `#${frag}` : ''}`;
  };

  /** @type {string[]} */
  const out = [];
  eachLine(markdown, (line, inFence, index) => {
    if (inFence) {
      out.push(line);
      return;
    }
    const masked = line.replace(/(`+)[^`]*\1/g, (m) => 'x'.repeat(m.length));
    /** @type {{ at: number, length: number, text: string }[]} */
    const edits = [];
    /**
     * @param {RegExpMatchArray} m
     * @param {number} prefixLength
     * @param {boolean} image
     */
    const edit = (m, prefixLength, image) => {
      const target = m[0].slice(prefixLength).match(/^[^)\s>]+|^\S+/)?.[0] ?? '';
      const at = (m.index ?? 0) + prefixLength;
      if (line.slice(at, at + target.length) !== target) return;
      edits.push({ at, length: target.length, text: rewrite(target, index, image) });
    };
    for (const m of masked.matchAll(/\]\(<?[^)\s>]+/g)) {
      const open = masked.lastIndexOf('[', m.index);
      const image = open > 0 && masked[open - 1] === '!';
      edit(m, m[0].startsWith('](<') ? 3 : 2, image);
    }
    const ref = /^\s{0,3}\[[^\]]+\]:\s*/.exec(masked);
    if (ref)
      edit(/** @type {RegExpMatchArray} */ (Object.assign([masked.slice(0)], { index: 0 })), ref[0].length, false);
    let text = line;
    for (const e of edits.sort((x, y) => y.at - x.at))
      text = text.slice(0, e.at) + e.text + text.slice(e.at + e.length);
    out.push(text);
  });
  return { text: out.join('\n'), problems };
}

function homeText() {
  const lines = [
    'ModelShot renders Blockbench and low-poly models in the browser. These pages describe the formats, the renderers and the project.',
    '',
  ];
  for (const g of groups) {
    lines.push(`## ${g.name}`, '');
    for (const p of g.pages) lines.push(`- [${p.title}](${p.page}) — ${p.description}`);
    lines.push('');
  }
  return lines.join('\n');
}

function sidebarText() {
  const lines = ['**[ModelShot](Home)**', ''];
  for (const g of groups) {
    lines.push(`**${g.name}**`, '');
    for (const p of g.pages) lines.push(`- [${p.title}](${p.page})`);
    lines.push('');
  }
  return lines.join('\n');
}

/** @param {string} repoUrl */
function footerText(repoUrl) {
  return `[Repository](${repoUrl}) · This wiki is generated from [docs/](${repoUrl}/tree/main/docs): change the pages there.\n`;
}

/**
 * @param {{ docsDir?: string, repoUrl?: string, table?: Map<string, import('./pages.mjs').WikiPage> }} [options]
 * @returns {{ files: Map<string, string>, problems: string[] }}
 */
export function buildWiki({ docsDir = DEFAULT_DOCS, repoUrl = DEFAULT_REPO_URL, table = defaultTable } = {}) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} */
  const files = new Map();
  const present = fs
    .readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  for (const f of present)
    if (!table.has(f)) problems.push(`docs/${f} is not in the page table (tools/wiki/pages.mjs)`);
  /** @type {Map<string, string>} */
  const sources = new Map();
  for (const f of table.keys()) {
    if (present.includes(f)) sources.set(f, fs.readFileSync(path.join(docsDir, f), 'utf8').replace(/\r\n/g, '\n'));
    else problems.push(`docs/${f} is in the page table but the file is missing`);
  }
  const anchorsByFile = new Map([...sources].map(([f, md]) => [f, anchors(md)]));
  const repoRoot = path.join(docsDir, '..');
  for (const [f, md] of sources) {
    const result = convert(f, md, table, repoUrl, { repoRoot, anchorsByFile });
    problems.push(...result.problems);
    const entry = /** @type {import('./pages.mjs').WikiPage} */ (table.get(f));
    files.set(`${entry.page}.md`, result.text);
  }
  files.set('Home.md', homeText());
  files.set('_Sidebar.md', sidebarText());
  files.set('_Footer.md', footerText(repoUrl));
  return { files, problems };
}

/** @param {NodeJS.ProcessEnv} [env] */
export function repoUrlFromEnv(env = process.env) {
  return env.GITHUB_REPOSITORY ? `https://github.com/${env.GITHUB_REPOSITORY}` : DEFAULT_REPO_URL;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const { files, problems } = buildWiki({ repoUrl: repoUrlFromEnv() });
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0) {
    const out = args[outIndex + 1];
    if (!out) {
      console.error('--out needs a directory');
      process.exit(1);
    }
    fs.mkdirSync(out, { recursive: true });
    for (const [name, text] of files) fs.writeFileSync(path.join(out, name), text);
  }
  console.log(`wiki ok: ${files.size - 3} pages`);
}
