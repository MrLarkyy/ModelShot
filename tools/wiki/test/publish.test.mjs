import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { gitEnv, publishWiki, PublishError, redact } from '../publish.mjs';

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();

/** A bare repository standing in for the wiki, with GitHub's placeholder first page on master. */
function wiki(initial = { 'Home.md': 'Welcome to the wiki!\n' }) {
  const bare = path.join(tmp('wiki-remote-'), 'wiki.git');
  fs.mkdirSync(bare);
  git(bare, 'init', '--bare', '--quiet', '--initial-branch=master');
  if (initial) {
    const seed = tmp('wiki-seed-');
    git(seed, 'init', '--quiet', '--initial-branch=master');
    for (const [name, text] of Object.entries(initial)) fs.writeFileSync(path.join(seed, name), text);
    git(seed, 'add', '--all');
    git(seed, 'commit', '--quiet', '-m', 'Initial Home page');
    git(seed, 'push', '--quiet', bare, 'master');
  }
  return bare;
}

const pagesOf = (bare) => {
  const check = tmp('wiki-check-');
  git(check, '-c', 'core.autocrlf=false', 'clone', '--quiet', bare, '.');
  return Object.fromEntries(
    fs
      .readdirSync(check)
      .filter((f) => f !== '.git')
      .map((f) => [f, fs.readFileSync(path.join(check, f), 'utf8')]),
  );
};
const headOf = (bare) => git(bare, 'rev-parse', 'master');
const cleanEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  SystemRoot: process.env.SystemRoot,
};
const run = (files, bare, extra = {}) =>
  publishWiki({ files: new Map(Object.entries(files)), remote: bare, env: cleanEnv, ...extra });

describe('publishWiki', () => {
  test('publishes the pages over what the wiki held', () => {
    const bare = wiki();
    expect(run({ 'Home.md': 'Home\n', 'Guide.md': '# Guide\n' }, bare).status).toBe('published');
    expect(pagesOf(bare)).toEqual({ 'Home.md': 'Home\n', 'Guide.md': '# Guide\n' });
    expect(git(bare, 'log', '-1', '--format=%an', 'master')).toBe('github-actions[bot]');
  });

  test('running it again changes nothing', () => {
    const bare = wiki();
    run({ 'Home.md': 'Home\n' }, bare);
    const head = headOf(bare);
    expect(run({ 'Home.md': 'Home\n' }, bare).status).toBe('unchanged');
    expect(headOf(bare)).toBe(head);
  });

  test('a page removed from the build is deleted from the wiki, and a page typed in the web UI is not kept', () => {
    const bare = wiki({ 'Home.md': 'x\n', 'Typed-in-browser.md': 'y\n' });
    run({ 'Home.md': 'Home\n', 'Old.md': 'old\n' }, bare);
    expect(Object.keys(pagesOf(bare)).sort()).toEqual(['Home.md', 'Old.md']);
    expect(run({ 'Home.md': 'Home\n' }, bare).status).toBe('published');
    expect(Object.keys(pagesOf(bare))).toEqual(['Home.md']);
  });

  test('an empty wiki repository gets its first commit on master', () => {
    const bare = wiki(null);
    expect(run({ 'Home.md': 'Home\n' }, bare).status).toBe('published');
    expect(git(bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe('master');
  });

  test('refuses without Home.md and leaves the wiki alone', () => {
    const bare = wiki();
    const head = headOf(bare);
    expect(() => run({ 'Guide.md': 'x\n' }, bare)).toThrow(PublishError);
    expect(() => run({ 'Guide.md': 'x\n' }, bare)).toThrow(/no Home\.md/);
    expect(headOf(bare)).toBe(head);
  });

  test('refuses a file name with a path', () => {
    expect(() => run({ 'Home.md': 'h', '../x.md': 'x' }, wiki())).toThrow(/plain page name/);
  });

  test('a dry run reports the change and pushes nothing', () => {
    const bare = wiki();
    const head = headOf(bare);
    const lines = [];
    expect(run({ 'Home.md': 'Home\n' }, bare, { dryRun: true, log: (m) => lines.push(m) }).status).toBe('dry-run');
    expect(lines.join('\n')).toMatch(/Would publish 1 changed files/);
    expect(headOf(bare)).toBe(head);
  });

  test('a wiki that does not exist is reported, not an error', () => {
    const lines = [];
    const missing = path.join(tmp('wiki-none-'), 'nothing.git');
    expect(run({ 'Home.md': 'Home\n' }, missing, { log: (m) => lines.push(m) }).status).toBe('missing-wiki');
    expect(lines.join('\n')).toMatch(/create its first page/);
  });
});

describe('token handling', () => {
  test('the token reaches git only as an environment header', () => {
    const env = gitEnv({ GITHUB_TOKEN: 'ghs_secret123' }, 'https://github.com/o/r.wiki.git');
    expect(env.GIT_CONFIG_VALUE_2).toMatch(/^AUTHORIZATION: basic /);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(gitEnv({ GITHUB_TOKEN: 'x' }, '/some/local/path').GIT_CONFIG_COUNT).toBe('2');
  });

  test('redact removes the token and its header form', () => {
    const basic = Buffer.from('x-access-token:ghs_secret123').toString('base64');
    expect(redact(`fail ghs_secret123 and ${basic}`, { GITHUB_TOKEN: 'ghs_secret123' })).toBe('fail *** and ***');
  });

  test('a rejected update never shows the token', () => {
    const bare = wiki();
    const hook = path.join(bare, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\necho "rejected for ghs_secret123" >&2\nexit 1\n', { mode: 0o755 });
    let message = '';
    try {
      publishWiki({
        files: new Map([['Home.md', 'h']]),
        remote: bare,
        env: { ...cleanEnv, GITHUB_TOKEN: 'ghs_secret123' },
        attempts: 1,
      });
    } catch (e) {
      message = e.message;
    }
    expect(message).toMatch(/git push failed/);
    expect(message).not.toContain('ghs_secret123');
  });
});
