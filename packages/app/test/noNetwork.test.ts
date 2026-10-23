import { describe, expect, it } from 'vitest';
import { appSources } from './appSources';

// Local-first: the page makes no request of its own. The only network use is the browser loading the app's files; the
// service worker's `fetch` of a cache miss (same origin, GET) is the one allowed place.
const NETWORK_API = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|WebTransport)\b\s*[(.]?/;
const ABSOLUTE_URL = /(?:https?|wss?|ftp):\/\/|(?<![:\w])\/\/[a-z][\w.-]*\.[a-z]/i;

const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the app sources make no network request', () => {
  const sources = appSources('.ts').filter((file) => !file.path.startsWith('src/offline/'));

  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(sources.map((f) => [f.path, f.text]))('%s uses no network API and names no address', (_path, text) => {
    const body = code(text ?? '');
    expect(body.match(NETWORK_API)?.[0]).toBeUndefined();
    expect(body.match(ABSOLUTE_URL)?.[0]).toBeUndefined();
  });

  it('the service worker is the only place that fetches, and only through its own cache or the same origin', () => {
    const worker = appSources('.ts').find((f) => f.path === 'src/offline/sw.template.ts');
    expect(worker?.text).toContain('fetch(request)');
    expect(worker?.text).toContain('url.origin !== self.location.origin');
    expect(worker?.text).not.toMatch(/https?:\/\//);
  });

  it.each([
    'fetch("/a")',
    'new XMLHttpRequest()',
    'new WebSocket(url)',
    'navigator.sendBeacon(u)',
    'const u = "https://x.example/a"',
  ])('the matcher catches %s', (sample) => {
    const body = code(sample);
    expect(NETWORK_API.test(body) || ABSOLUTE_URL.test(body)).toBe(true);
  });
});
