import { expect, siteUrl, test } from './deployTest.ts';

const PAGES = [
  { name: 'landing', path: './', frame: false },
  { name: 'app', path: 'app/', frame: false },
  // The frame fetches the model URL its host page names, so its connect-src allows https: (docs/embed.md).
  { name: 'embed frame', path: 'embed/v1/', frame: true },
];

for (const { name, path, frame } of PAGES) {
  test(`the ${name} CSP blocks a script, an image and a fetch from another origin`, async ({
    page,
    context,
    baseURL,
    observed,
  }) => {
    let hits = 0;
    await context.route('https://blocked.invalid/**', async (route) => {
      hits += 1;
      await route.abort();
    });
    await page.goto(siteUrl(baseURL, path));
    await page.evaluate(() => {
      void fetch('https://blocked.invalid/x').catch(() => undefined);
      new Image().src = 'https://blocked.invalid/x.png';
      const script = document.createElement('script');
      script.src = 'https://blocked.invalid/x.js';
      document.head.append(script);
    });
    await expect
      .poll(async () => (await observed.violations()).some((v) => /^img-src https:\/\/blocked\.invalid/.test(v)))
      .toBe(true);
    const violations = await observed.violations();
    expect(
      violations.some((v) => /^script-src\S* https:\/\/blocked\.invalid/.test(v)),
      violations.join(),
    ).toBe(true);
    expect(
      violations.some((v) => /^connect-src https:\/\/blocked\.invalid/.test(v)),
      violations.join(),
    ).toBe(!frame);
    // Only the frame's fetch may leave.
    expect(hits).toBe(frame ? 1 : 0);
  });
}
