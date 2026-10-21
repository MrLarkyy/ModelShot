import type { IslandMaterial } from './islandClasses';

// Placement in the canvas order (WebC hero, 40 x 23 isometric steps); later cubes paint over earlier ones.
const CUBES: readonly (readonly [IslandMaterial, number, number])[] = [
  ['grass', 0, 0],
  ['grass', 40, 23],
  ['grass', -40, 23],
  ['grass', 80, 46],
  ['grass', 0, 46],
  ['grass', -80, 46],
  ['grass', 40, 69],
  ['grass', -40, 69],
  ['wood', 0, 0],
  ['lantern', 80, 0],
  ['grass', 0, 92],
  ['wood', 0, -46],
  ['foliage', 40, -115],
  ['foliage', -40, -115],
  ['foliage', 0, -92],
  ['foliage', 40, -69],
  ['foliage', -40, -69],
  ['foliage', 0, -138],
];

const FACES =
  '<polygon class="t" points="0,0 40,-23 80,0 40,23"/>' +
  '<polygon class="l" points="0,0 40,23 40,69 0,46"/>' +
  '<polygon class="r" points="40,23 80,0 80,46 40,69"/>';

const LANTERN_POSTS =
  '<polygon class="isl-post" points="14,14 26,21 26,48 14,41"/>' +
  '<polygon class="isl-post" points="54,21 66,14 66,41 54,48"/>';

export const HERO_ISLAND_LABEL =
  'Illustration, not a render: a blocky autumn tree with a glowing lantern on a grass island';

function cube([material, x, y]: readonly [IslandMaterial, number, number]): string {
  const extra = material === 'lantern' ? LANTERN_POSTS : '';
  return `<g class="isl-${material}" transform="translate(${x} ${y})">${FACES}${extra}</g>`;
}

// Colours come from css/illustration.css through the classes, so the page that inlines it keeps to the tokens.
export function heroIslandSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="isl" viewBox="-110 -190 300 380" width="280" height="350" role="img" aria-label="${HERO_ISLAND_LABEL}">` +
    '<defs><radialGradient id="ms-hero-glow" cx="50%" cy="50%" r="50%">' +
    '<stop class="isl-stop-core" offset="0%"/><stop class="isl-stop-mid" offset="50%"/><stop class="isl-stop-edge" offset="100%"/>' +
    '</radialGradient></defs>' +
    '<ellipse class="isl-shadow" cx="40" cy="150" rx="150" ry="28"/>' +
    '<circle class="isl-glow" cx="120" cy="23" r="110" fill="url(#ms-hero-glow)"/>' +
    CUBES.map(cube).join('') +
    '</svg>\n'
  );
}
