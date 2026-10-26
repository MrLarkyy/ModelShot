import { CUBE, addViewer, expect, openHost, pixel, shot, test, viewerFrame, waitLit } from './embedTest';

// The page colour comes out as written under every look: the frame solves the look's view transform (docs/embed.md).
const PAGE_COLOUR = [0x1b, 0x2a, 0x4a] as const;

for (const look of ['studio', 'marketplace', 'rim']) {
  test(`background #1b2a4a shows as that colour behind the model under the ${look} look`, async ({ page }) => {
    await openHost(page);
    await addViewer(page, { model: CUBE, look, background: '#1b2a4a' });
    await waitLit(viewerFrame(page));
    const image = await shot(page);
    for (const [x, y] of [
      [4, 4],
      [295, 4],
    ] as const) {
      const shown = pixel(image, x, y);
      for (let c = 0; c < 3; c++) {
        expect(
          Math.abs(shown[c]! - PAGE_COLOUR[c]!),
          `pixel ${x},${y} channel ${c}: ${shown.join(',')}`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });
}
