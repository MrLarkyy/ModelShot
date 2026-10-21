# Brand

The Block Party brand lives in one package, `packages/brand` (`@modelshot/brand`): design tokens, self-hosted fonts,
the logo and icon set and the hero illustration. The app, the landing page (`packages/site`, see
[site.md](site.md)) and later the embed consume it; none of them keeps its own copy of a colour, a font or a logo.

## Tokens

The single source is `src/tokens.ts` (`tokens`, type `Tokens`). Everything else is generated from it or checked
against it:

| file                   | what it holds                                                                            | who loads it     |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| `css/tokens.css`       | core custom properties: colour, shadow, font, weight, size, radius, space, motion, focus | app, site, embed |
| `css/illustration.css` | illustration palette (`--ms-ill-*`) and the class rules that colour the hero island      | site only        |
| `css/fonts.css`        | the six `@font-face` rules (hand-written, checked by `test/fonts.test.ts`)               | app, site        |

Both generated files are Vitest file snapshots (`test/tokens.test.ts`): change `tokens.ts`, run
`pnpm golden:update:data`, review the CSS diff, commit both. A hand edit of a generated file fails the test.

Custom properties are named `--ms-<group>-<name>` in kebab case: `--ms-color-shot-blue`, `--ms-space-5` (24 px),
`--ms-radius-card`, `--ms-motion-float` (6000 ms), `--ms-focus-on-dark`. In TypeScript use `tokens.color.shotBlue`.

Consuming them:

```ts
import '@modelshot/brand/tokens.css';
import '@modelshot/brand/fonts.css';
import { tokens } from '@modelshot/brand';
```

```css
.panel {
  background: var(--ms-color-paper);
  color: var(--ms-color-ink);
  border-radius: var(--ms-radius-tile);
}
```

Pages use tokens only: the landing page has no raw `#hex`, `rgb()` or named colour in its CSS and no inline style
(`packages/site/test/noRawColours.test.ts`).

### Colour roles

| token                             | value     | role                                                              |
| --------------------------------- | --------- | ----------------------------------------------------------------- |
| `cloud`                           | `#EEF0F4` | page ground                                                       |
| `paper`                           | `#FFFFFF` | cards, text on ink and blue                                       |
| `ink`                             | `#121318` | text, dark surfaces, focus ring                                   |
| `slate`                           | `#4E5361` | secondary text                                                    |
| `shotBlue`                        | `#2F4BFF` | primary action, links, hero                                       |
| `flash`                           | `#FF6A3D` | accent; ink text only                                             |
| `sun`                             | `#FFD23F` | CTA on ink, highlights, focus ring on dark grounds; ink text only |
| `blueHover`                       | `#1A33D6` | hovered primary button and links                                  |
| `blueTint`, `blueMid`, `blueDeep` |           | logo cube faces, drop zone border, island shadow                  |
| `dropGround`                      | `#F5F6FF` | drop zone ground                                                  |
| `hairline`, `border`              |           | card outline, secondary button outline                            |
| `mutedOnInk`                      | `#C9CCD6` | secondary text on ink                                             |

### Contrast

`src/contrastPairs.ts` lists every text colour on every ground the site and the app use, with its use: `body`
(4.5:1), `large` (24 px and up, 3:1) or `ring` (focus ring against the ground around it, 3:1).
`test/contrast.test.ts` checks every pair with the WCAG 2.x formula (`src/contrastRatio.ts`). Rules:

- Never white (paper) text on flash or sun; both get ink.
- The focus ring is 3 px ink with a 3 px offset. On ink and shot blue grounds it switches to sun
  (`--ms-focus-on-dark`): a page puts `.on-dark` on such a panel.
- Translucent layers are checked at their strongest point: the render sweep (`illustration.sweep`, white at 12 %)
  composited over shot blue (`compositeOver`) still gives paper text 4.74:1. axe reports text over a gradient only as
  incomplete, so this test is the check.
- A new colour pair on a page is added to `CONTRAST_PAIRS` first. The site checks this twice: CSS rules that set both
  a colour and a ground (`packages/site/test/contrastCoverage.test.ts`) and every rendered text element in the browser
  (`landing.a11y.spec.ts`).

## Fonts

Unbounded 600/800 (headings and the wordmark only), Manrope 400/500/700 (everything read), IBM Plex Mono 500
(labels, numbers). All three are under the SIL Open Font License 1.1.

The files in `fonts/<family>/` are the latin subsets from the exact-pinned devDependencies `@fontsource/unbounded`,
`@fontsource/manrope` and `@fontsource/ibm-plex-mono`, copied byte for byte by `pnpm --filter @modelshot/brand
fonts:sync`, with the package licence beside them as `OFL.txt`. `test/fonts.test.ts` fails when a file differs from
the pinned package, a directory lacks `OFL.txt` or `fonts.css` points at a missing file. `font-display: block`: text
waits for the brand face instead of flashing a fallback. No page loads a font from another origin.

To change a font: bump the pinned version, run `fonts:sync`, update `css/fonts.css` if the file list changed.

## Logo

Generated by `src/logo/markSvg.ts` on the 132 grid of the logo system (tile radius 34, isometric cube, flash dot of
radius 12 at (104, 28)); written to `assets/logo/` by `test/logo.test.ts` (file snapshots, `pnpm golden:update:data`).

| file               | use                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------- |
| `mark.svg`         | primary, on light grounds and on ink                                                  |
| `mark-inverse.svg` | white tile, for shot blue grounds                                                     |
| `mark-mono.svg`    | one colour (`currentColor`): faces knocked out with 6-unit gaps, dot in a 4-unit ring |
| `favicon-32.svg`   | 32 px: the dot grows to radius 14                                                     |
| `favicon-16.svg`   | 16 px: no dot, larger cube, tile radius 30                                            |
| `app-icon.svg`     | full-bleed square for platforms that mask the corners                                 |

Every SVG is under 1 KB, has `viewBox` and `xmlns`, no metadata, no text and only token colours.

- The wordmark is lowercase `modelshot` in Unbounded 800, tracking −4% (`letter-spacing: -0.04em`), set as text
  next to the mark; there is no outlined lockup file. Gap between mark and word: one cube edge.
- Clear space: two flash diameters on every side.
- Never stretch, recolour or retype the mark.

## PNG icons and social preview

`pnpm --filter @modelshot/brand icons:render` (`scripts/renderPngs.mjs`) renders, in the pinned Playwright Chromium
and with no network (brand files are served from disk under a fake origin):

| `assets/public/`               | from                                     |
| ------------------------------ | ---------------------------------------- |
| `favicon.svg`                  | copy of `favicon-32.svg`                 |
| `favicon-16.png`               | `favicon-16.svg`                         |
| `favicon-32.png`               | `favicon-32.svg`                         |
| `apple-touch-icon.png`         | `app-icon.svg`, 180 px                   |
| `icon-192.png`, `icon-512.png` | `mark.svg`                               |
| `social-preview.png`           | `social/social-preview.html`, 1200 × 630 |

The script fails if Unbounded 800 did not load. `test/pngs.test.ts` pins sizes and key pixels (tile colour, flash dot
present from 32 px and absent at 16 px, the social preview's grounds), not bytes. `assets/public` is the `publicDir`
of the app and the site, so both serve the icons at their root. Run the script after changing a logo SVG, the
illustration or the social page, look at the images, commit them.

## Hero illustration

`src/illustration/heroIslandSvg.ts` writes `assets/illustrations/hero-island.svg`: the blocky tree, lantern and grass
island of the canvas. It has no colours of its own; `css/illustration.css` colours it through classes, so a page that
inlines it stays on the tokens. It is labelled as an illustration, not a render, until the path tracer produces real
sample renders.

## Licences

- Fonts: SIL Open Font License 1.1, `fonts/<family>/OFL.txt`.
- Marks, icons, illustration and social preview: our own work, all rights reserved until the repository chooses a
  licence (`assets/LICENSE`).
