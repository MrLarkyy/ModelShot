import type { ColorRole } from './tokens';

// body: text under 24 px (4.5:1); large: text of 24 px and more (3:1); ring: a focus ring against the ground
// around it (3:1, WCAG 1.4.11).
export type ContrastUse = 'body' | 'large' | 'ring';

export interface ContrastPair {
  readonly fg: ColorRole;
  readonly bg: ColorRole;
  readonly use: ContrastUse;
  readonly where: string;
}

export const MIN_CONTRAST: Record<ContrastUse, number> = { body: 4.5, large: 3, ring: 3 };

// Every text or focus-ring colour on every ground the site and the app use. test/contrast.test.ts checks the
// ratios and that each color/background pair declared together in packages/site/src/**/*.css is listed here.
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'ink', bg: 'cloud', use: 'body', where: 'page text, nav, footer links, look names' },
  { fg: 'slate', bg: 'cloud', use: 'body', where: 'hero copy, look notes, footer note' },
  { fg: 'shotBlue', bg: 'cloud', use: 'large', where: 'hero headline accent' },
  { fg: 'blueHover', bg: 'cloud', use: 'body', where: 'hovered link' },
  { fg: 'blueHover', bg: 'paper', use: 'body', where: 'hovered secondary button' },
  { fg: 'ink', bg: 'paper', use: 'body', where: 'tiles, steps, FAQ, secondary button' },
  { fg: 'slate', bg: 'paper', use: 'body', where: 'tile labels, step notes, FAQ answers' },
  { fg: 'shotBlue', bg: 'paper', use: 'body', where: 'step numbers, embed caption' },
  { fg: 'paper', bg: 'shotBlue', use: 'body', where: 'primary button, hero tile' },
  { fg: 'paper', bg: 'blueHover', use: 'body', where: 'hovered primary button' },
  { fg: 'paper', bg: 'ink', use: 'body', where: 'header button, lights tile, CTA panel' },
  { fg: 'sun', bg: 'ink', use: 'body', where: 'lights tile label' },
  { fg: 'mutedOnInk', bg: 'ink', use: 'body', where: 'secondary text on ink' },
  { fg: 'ink', bg: 'flash', use: 'body', where: 'pose tile' },
  { fg: 'ink', bg: 'sun', use: 'body', where: 'export tile, CTA button' },
  { fg: 'ink', bg: 'dropGround', use: 'body', where: 'drop zone' },
  { fg: 'slate', bg: 'dropGround', use: 'body', where: 'drop zone formats' },
  { fg: 'ink', bg: 'cloud', use: 'ring', where: 'focus ring on the page' },
  { fg: 'ink', bg: 'paper', use: 'ring', where: 'focus ring inside cards' },
  { fg: 'ink', bg: 'dropGround', use: 'ring', where: 'focus ring next to the drop zone' },
  { fg: 'sun', bg: 'ink', use: 'ring', where: 'focus ring on the ink CTA panel' },
  { fg: 'sun', bg: 'shotBlue', use: 'ring', where: 'focus ring on blue grounds' },
];
