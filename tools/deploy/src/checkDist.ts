import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { EMBED_PATH_MAJOR } from './layout.ts';

const EMBED_FRAME = `embed/v${EMBED_PATH_MAJOR}/index.html`;
const REQUIRED_FILES = [
  'index.html',
  'app/index.html',
  'app/sw.js',
  EMBED_FRAME,
  `embed/v${EMBED_PATH_MAJOR}/modelshot-embed.js`,
];
const CSP_META = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi;
const SUBRESOURCE_TAG = /<(?:script|link|style)\b/i;
const ROOT_ABSOLUTE_ATTRIBUTE = /\b(?:href|src|action|poster|srcset|content)\s*=\s*["']\s*\/(?!\/)/gi;
const ROOT_ABSOLUTE_URL = /url\(\s*["']?\/(?!\/)/gi;
const OFF_ORIGIN = /^\s*(?:[a-z][a-z\d+.-]*:)?\/\//i;

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(path)));
    else found.push(path);
  }
  return found;
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(String.raw`<${name}\b[^>]*>`, 'gi')) ?? [];
}

function attribute(tag: string, name: string): string | null {
  return (
    new RegExp(String.raw`\b${name}\s*=\s*"([^"]*)"|\b${name}\s*=\s*'([^']*)'`, 'i')
      .exec(tag)
      ?.slice(1)
      .find(Boolean) ?? null
  );
}

function policyProblems(file: string, policy: string): string[] {
  const problems: string[] = [];
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  const problem = (text: string): number => problems.push(`${file}: ${text}`);
  if (!directives.get('default-src')?.includes("'self'")) problem("CSP lacks default-src 'self'");
  if (directives.get('object-src')?.join(' ') !== "'none'") problem("CSP lacks object-src 'none'");
  if (directives.get('base-uri')?.join(' ') !== "'none'") problem("CSP lacks base-uri 'none'");
  if (directives.has('frame-ancestors'))
    problem('CSP sets frame-ancestors, which would stop the page from being embedded');
  for (const [name, sources] of directives) {
    for (const source of sources) {
      const lower = source.toLowerCase();
      if (lower === "'unsafe-inline'" || lower === "'unsafe-eval'") problem(`CSP ${name} allows ${source}`);
      else if (lower.includes('*')) problem(`CSP ${name} has the wildcard source ${source}`);
      else if (lower.startsWith("'")) continue;
      else if (lower.endsWith(':')) {
        const frameException =
          file === EMBED_FRAME && name === 'connect-src' && (lower === 'https:' || lower === 'http:');
        if (!frameException) problem(`CSP ${name} allows the scheme ${source}`);
      } else problem(`CSP ${name} has the host source ${source}`);
    }
  }
  return problems;
}

function htmlProblems(file: string, html: string): string[] {
  const problems: string[] = [];
  const metas = html.match(CSP_META) ?? [];
  if (metas.length === 0) problems.push(`${file}: no Content-Security-Policy meta`);
  else if (metas.length > 1) problems.push(`${file}: ${metas.length} Content-Security-Policy metas, expected one`);
  else {
    if (html.search(SUBRESOURCE_TAG) !== -1 && html.search(SUBRESOURCE_TAG) < html.indexOf(metas[0]!)) {
      problems.push(`${file}: the CSP meta comes after a script, link or style, which it then does not cover`);
    }
    problems.push(...policyProblems(file, attribute(metas[0]!, 'content') ?? ''));
  }
  for (const tag of [...tags(html, 'script'), ...tags(html, 'link')]) {
    const url = attribute(tag, tag.toLowerCase().startsWith('<script') ? 'src' : 'href');
    if (url !== null && OFF_ORIGIN.test(url)) problems.push(`${file}: ${tag.slice(0, 60)} loads from another origin`);
  }
  return problems;
}

/** What is wrong with the assembled site in `out`; empty when it may be deployed. */
export async function checkDist(out: string): Promise<string[]> {
  const files = (await listFiles(out)).map((path) => relative(out, path).split(sep).join('/'));
  const problems: string[] = [];
  for (const required of REQUIRED_FILES) {
    if (!files.includes(required)) problems.push(`${required} is missing`);
  }
  for (const file of files) {
    const isHtml = file.endsWith('.html');
    if (!isHtml && !file.endsWith('.css')) continue;
    const text = await readFile(join(out, file), 'utf8');
    if (isHtml) problems.push(...htmlProblems(file, text));
    for (const match of text.matchAll(ROOT_ABSOLUTE_ATTRIBUTE)) {
      problems.push(`${file}: root-absolute URL ${match[0].trim()}, which breaks under a sub-path`);
    }
    for (const match of text.matchAll(ROOT_ABSOLUTE_URL)) {
      problems.push(`${file}: root-absolute URL ${match[0].trim()}, which breaks under a sub-path`);
    }
  }
  return problems;
}
