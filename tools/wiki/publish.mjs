#!/usr/bin/env node
// @ts-check
// Publishes the built wiki pages to the repository's GitHub wiki (a separate git repository, <repo>.wiki.git). docs/ is
// the truth: the wiki is a mirror, so a page that is not built is deleted there, and running the script again without a
// change pushes nothing.
//
//   node tools/wiki/publish.mjs [--remote <git url>] [--dry-run]
//
// The remote defaults to https://github.com/$GITHUB_REPOSITORY.wiki.git. In GitHub Actions the token comes from
// GITHUB_TOKEN (the job needs `contents: write`); it reaches git through environment variables only, never an argument,
// a URL or a log line. A wiki that does not exist yet is reported and is not an error (exit 0 with a warning).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWiki, repoUrlFromEnv } from './build.mjs';

const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };
// The wording differs between git versions.
const MISSING = /repository .*(not found|does not exist)|does not appear to be a git repository/i;

export class PublishError extends Error {}

/**
 * The environment git runs in: no prompts, no CRLF conversion, and the token (if any) as an Authorization header.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} remote
 */
export function gitEnv(env, remote) {
  /** @type {[string, string][]} */
  const config = [
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
  ];
  const token = env.GITHUB_TOKEN;
  if (token && /^https:\/\/github\.com\//.test(remote)) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    config.push(['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${basic}`]);
  }
  /** @type {NodeJS.ProcessEnv} */
  const out = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: String(config.length) };
  config.forEach(([k, v], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = k;
    out[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  Object.assign(out, {
    GIT_AUTHOR_NAME: BOT.name,
    GIT_AUTHOR_EMAIL: BOT.email,
    GIT_COMMITTER_NAME: BOT.name,
    GIT_COMMITTER_EMAIL: BOT.email,
  });
  return out;
}

/**
 * `text` with the token and its Authorization-header form removed.
 * @param {string} text
 * @param {NodeJS.ProcessEnv} env
 */
export function redact(text, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) return text;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return text.split(token).join('***').split(basic).join('***');
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env: NodeJS.ProcessEnv, remoteEnv: NodeJS.ProcessEnv }} opts
 */
function git(args, { cwd, env, remoteEnv }) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: remoteEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const err = /** @type {{ stderr?: unknown, message: string }} */ (e);
    const stderr = redact(String(err.stderr ?? err.message), env).trim();
    const error = Object.assign(new PublishError(`git ${args[0]} failed: ${stderr}`), { stderr });
    throw error;
  }
}

/**
 * Mirrors `files` (page file name -> text) into the wiki repository at `remote`. Throws PublishError when the files are
 * unusable or git fails.
 * @param {{ files: Map<string, string>, remote?: string, env?: NodeJS.ProcessEnv, dryRun?: boolean, log?: (m: string) => void, attempts?: number }} options
 * @returns {{ status: 'published' | 'unchanged' | 'dry-run' | 'missing-wiki', files: number, changed: boolean }}
 */
export function publishWiki({ files, remote, env = process.env, dryRun = false, log = () => {}, attempts = 3 }) {
  if (!files.has('Home.md')) throw new PublishError('the wiki has no Home.md: refusing to publish');
  if (!remote) throw new PublishError('no remote: set GITHUB_REPOSITORY or pass --remote');
  for (const name of files.keys()) {
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
      throw new PublishError(`wiki file name ${name} is not a plain page name`);
    }
  }
  const remoteEnv = gitEnv(env, remote);
  const sha = (env.GITHUB_SHA ?? '').slice(0, 7);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-publish-'));
    try {
      try {
        git(['clone', '--quiet', remote, work], { env, remoteEnv });
      } catch (e) {
        if (MISSING.test(/** @type {{ stderr?: string }} */ (e).stderr ?? '')) {
          log(
            'The wiki repository does not exist yet. Enable the wiki in the repository settings and create its first page once ' +
              'in the web UI (Wiki, "Create the first page"); the next publish then fills it.',
          );
          return { status: 'missing-wiki', files: files.size, changed: false };
        }
        throw e;
      }
      const opts = { cwd: work, env, remoteEnv };
      let branch = 'master';
      try {
        git(['rev-parse', '--verify', '--quiet', 'HEAD'], opts);
        branch = git(['symbolic-ref', '--short', 'HEAD'], opts);
      } catch {
        // An empty wiki repository: GitHub's wiki branch is master.
        git(['symbolic-ref', 'HEAD', 'refs/heads/master'], opts);
      }

      for (const entry of fs.readdirSync(work)) {
        if (entry !== '.git') fs.rmSync(path.join(work, entry), { recursive: true, force: true });
      }
      for (const [name, text] of files) fs.writeFileSync(path.join(work, name), text);
      git(['add', '--all'], opts);
      const changes = git(['status', '--porcelain'], opts).split('\n').filter(Boolean);
      if (changes.length === 0) {
        log(`The wiki is up to date (${files.size} files).`);
        return { status: 'unchanged', files: files.size, changed: false };
      }
      if (dryRun) {
        log(`Would publish ${changes.length} changed files of ${files.size}:\n${changes.join('\n')}`);
        return { status: 'dry-run', files: files.size, changed: true };
      }
      git(['commit', '--quiet', '-m', sha ? `Publish docs from ${sha}` : 'Publish docs'], opts);
      try {
        git(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`], opts);
      } catch (e) {
        if (
          attempt < attempts &&
          /rejected|fetch first|non-fast-forward/i.test(/** @type {{ stderr?: string }} */ (e).stderr ?? '')
        ) {
          log('The wiki moved meanwhile; trying again.');
          continue;
        }
        throw e;
      }
      log(`Published ${changes.length} changed files of ${files.size} to the wiki.`);
      return { status: 'published', files: files.size, changed: true };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  throw new PublishError('the wiki kept moving; gave up');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  /** @param {string} name */
  const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const remote =
    opt('remote') ??
    (process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}.wiki.git` : undefined);
  try {
    const { files, problems } = buildWiki({ repoUrl: repoUrlFromEnv() });
    if (problems.length > 0) throw new PublishError(`refusing to publish:\n${problems.join('\n')}`);
    const result = publishWiki({ files, remote, dryRun: args.includes('--dry-run'), log: (m) => console.log(m) });
    if (result.status === 'missing-wiki' && process.env.GITHUB_ACTIONS) {
      console.log(
        "::warning title=Wiki repository missing::Create the wiki's first page once in the web UI, then re-run this workflow.",
      );
    }
  } catch (e) {
    const err = /** @type {Error} */ (e);
    console.error(redact(e instanceof PublishError ? err.message : String(err.stack ?? err), process.env));
    process.exit(1);
  }
}
