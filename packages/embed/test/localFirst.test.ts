import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const sources = walk(join(ROOT, 'src'))
  .filter((path) => /\.(ts|css)$/.test(path))
  .map((path) => ({ path: relative(ROOT, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf8') }));

// The app's matchers (packages/app/test/noNetwork.test.ts, localFirst.test.ts).
const NETWORK_API = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|WebTransport)\b\s*[(.]?/;
const ABSOLUTE_URL = /(?:https?|wss?|ftp):\/\/|(?<![:\w])\/\/[a-z][\w.-]*\.[a-z]/i;
const OFF_ORIGIN = /(?:\b[a-z][a-z\d+.-]*:)?\/\/[^\s"'<>)]*/gi;
/** The model download and its CORS probe: the embed's only requests of its own. */
const NETWORK_FILES = ['src/frame/fetchModel.ts', 'src/frame/explainFetchFailure.ts'];
/** They name `fetch` only to hand it to the download (a test passes a fake). */
const PLUMBING_FILES = ['src/frame/main.ts', 'src/frame/showEmbed.ts'];

const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the embed sources make no request but the model download', () => {
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(sources.filter((f) => ![...NETWORK_FILES, ...PLUMBING_FILES].includes(f.path)).map((f) => [f.path, f.text]))(
    '%s uses no network API',
    (_path, text) => {
      expect(code(text ?? '').match(NETWORK_API)?.[0]).toBeUndefined();
    },
  );

  it.each(sources.map((f) => [f.path, f.text]))('%s names no address', (_path, text) => {
    expect(code(text ?? '').match(ABSOLUTE_URL)?.[0]).toBeUndefined();
  });

  it('fetches only in the model download and the probe, without credentials or referrer', () => {
    for (const path of NETWORK_FILES) {
      const text = sources.find((f) => f.path === path)?.text ?? '';
      expect(text, path).toContain("credentials: 'omit'");
      expect(text, path).toContain("referrerPolicy: 'no-referrer'");
    }
  });

  it('the frame page references no off-origin URL and sends no referrer', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html.match(OFF_ORIGIN) ?? []).toEqual([]);
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
  });
});
