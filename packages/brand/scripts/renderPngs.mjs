// Renders the PNG favicons, app icons and the social preview from the committed SVGs and social/social-preview.html
// in the pinned Playwright Chromium. Brand files are served from disk under a fake origin; every other request is
// aborted, so the render needs no network. Run: pnpm --filter @modelshot/brand icons:render
/* global document */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const brandRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(brandRoot, 'assets', 'public');
const ORIGIN = 'https://brand.invalid';

const ICONS = [
  { out: 'favicon-16.png', svg: 'assets/logo/favicon-16.svg', size: 16 },
  { out: 'favicon-32.png', svg: 'assets/logo/favicon-32.svg', size: 32 },
  { out: 'apple-touch-icon.png', svg: 'assets/logo/app-icon.svg', size: 180 },
  { out: 'icon-192.png', svg: 'assets/logo/mark.svg', size: 192 },
  { out: 'icon-512.png', svg: 'assets/logo/mark.svg', size: 512 },
];

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function inlineSlots(html) {
  const slots = { mark: 'assets/logo/mark.svg', 'hero-island': 'assets/illustrations/hero-island.svg' };
  return html.replace(/<!-- brand:([a-z-]+) -->/g, (_match, name) => {
    if (!(name in slots)) throw new Error(`unknown brand slot ${name}`);
    return readFileSync(join(brandRoot, slots[name]), 'utf8').trim();
  });
}

const browser = await chromium.launch({
  args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
});
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const path = resolve(brandRoot, `.${decodeURIComponent(url.pathname)}`);
    if (url.origin !== ORIGIN || !relative(brandRoot, path) || relative(brandRoot, path).startsWith(`..${sep}`)) {
      await route.abort();
      return;
    }
    const type = TYPES[extname(path)] ?? 'application/octet-stream';
    const body = type === 'text/html' ? inlineSlots(readFileSync(path, 'utf8')) : readFileSync(path);
    await route.fulfill({ status: 200, contentType: type, body });
  });
  const page = await context.newPage();

  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<html><body style="margin:0"><img src="${ORIGIN}/${icon.svg}" width="${icon.size}" height="${icon.size}" style="display:block"></body></html>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    writeFileSync(join(publicDir, icon.out), await page.screenshot({ omitBackground: true }));
    console.log(`assets/public/${icon.out}`);
  }

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(`${ORIGIN}/social/social-preview.html`);
  await page.evaluate(() => document.fonts.ready);
  const fontLoaded = await page.evaluate(() =>
    [...document.fonts].some(
      (f) => f.family.replaceAll('"', '') === 'Unbounded' && f.weight === '800' && f.status === 'loaded',
    ),
  );
  if (!fontLoaded) throw new Error('Unbounded 800 did not load; the social preview would show a fallback font');
  writeFileSync(join(publicDir, 'social-preview.png'), await page.screenshot());
  console.log('assets/public/social-preview.png');
} finally {
  await browser.close();
}

copyFileSync(join(brandRoot, 'assets', 'logo', 'favicon-32.svg'), join(publicDir, 'favicon.svg'));
console.log('assets/public/favicon.svg');
