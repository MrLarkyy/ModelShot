import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const FRAME_CSP = CSP.replace("connect-src 'self'", "connect-src 'self' https: http:");

export function page(
  csp: string | null,
  body = '<script type="module" src="./assets/a-12345678.js"></script>',
): string {
  const meta = csp === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  return `<!doctype html><html><head><meta charset="utf-8" />${meta}${body}</head><body></body></html>`;
}

/** A site that passes checkDist: the files it needs, keyed by path. */
export function cleanSite(): Record<string, string> {
  return {
    'index.html': page(CSP),
    'app/index.html': page(CSP),
    'app/sw.js': 'self.addEventListener("fetch", () => {});',
    'embed/v1/index.html': page(FRAME_CSP),
    'embed/v1/modelshot-embed.js': 'export {};',
  };
}

export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** Runs `use` with a fresh temporary directory, removed afterwards. */
export async function withTemp<T>(use: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ms-deploy-'));
  try {
    return await use(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
