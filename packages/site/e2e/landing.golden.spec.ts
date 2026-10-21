import { expect, openLanding, test, WIDTHS } from './siteTest';

// Full-page goldens with animations stopped (playwright.config.ts). Update deliberately: pnpm golden:update:site,
// then review the images beside the WebC canvas at the same widths.
for (const width of WIDTHS) {
  test(`landing page at ${width} px matches its golden`, async ({ page }) => {
    await openLanding(page, width);
    await expect(page).toHaveScreenshot(`landing-${width}.png`, { fullPage: true });
  });
}
