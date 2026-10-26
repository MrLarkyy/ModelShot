import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DEPLOY_LAYOUT } from './layout.ts';

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/** Copies the built site, app and embed into `out` as the hosted layout; `out` is emptied first. */
export async function assemble(options: { readonly root: string; readonly out: string }): Promise<void> {
  const { root, out } = options;
  for (const { source } of DEPLOY_LAYOUT) {
    if (!(await isDirectory(join(root, source)))) {
      throw new Error(`${source} is missing: build it first (pnpm -r build).`);
    }
  }
  const siteDist = join(root, DEPLOY_LAYOUT[0]!.source);
  const entries = await readdir(siteDist);
  for (const name of ['app', 'embed']) {
    if (entries.includes(name)) {
      throw new Error(
        `${DEPLOY_LAYOUT[0]!.source}/${name} exists: it is left over from build:with-app, rebuild the site (pnpm --filter @modelshot/site run build).`,
      );
    }
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const { source, target } of DEPLOY_LAYOUT) {
    await cp(join(root, source), join(out, target), { recursive: true });
  }
}
