import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

describe('local-first', () => {
  it('reads the whole package', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it.each(Object.entries(sources))('%s fetches nothing and loads no remote code', (_, source) => {
    expect(source).not.toMatch(/\bfetch\s*\(|importScripts|XMLHttpRequest|WebSocket|sendBeacon|new Worker\(/);
    expect(source).not.toMatch(/https?:\/\//);
  });
});
