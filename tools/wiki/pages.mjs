// @ts-check
// The one table of wiki pages. The order is the sidebar order. A docs/*.md file that is not listed here fails the check.

/** @typedef {{ file: string, page: string, title: string, description: string }} WikiPage */
/** @typedef {{ name: string, pages: WikiPage[] }} WikiGroup */

/** @type {WikiGroup[]} */
export const groups = [
  {
    name: 'Formats',
    pages: [
      {
        file: 'scene-format.md',
        page: 'Scene-format',
        title: 'Scene format',
        description: 'what every loader produces',
      },
      {
        file: 'bbmodel.md',
        page: 'Blockbench-loader',
        title: 'Blockbench loader',
        description: 'supported features, limits, error codes',
      },
      {
        file: 'gltf.md',
        page: 'glTF-loader',
        title: 'glTF / GLB loader',
        description: 'supported features, limits, error codes',
      },
      {
        file: 'obj.md',
        page: 'OBJ-loader',
        title: 'OBJ loader',
        description: 'supported features, limits, error codes',
      },
      {
        file: 'player.md',
        page: 'Player-skins-and-posing',
        title: 'Player skins and posing',
        description: 'the player model from a skin, poses and held models',
      },
    ],
  },
  {
    name: 'Rendering',
    pages: [
      {
        file: 'realtime-renderer.md',
        page: 'Realtime-renderer',
        title: 'Realtime renderer',
        description: 'passes, pixel-art sampling, transparency, context loss',
      },
      {
        file: 'path-tracer.md',
        page: 'Path-tracer',
        title: 'Path tracer',
        description: 'API, determinism, alpha, sides and order on every ray, lighting',
      },
      {
        file: 'camera.md',
        page: 'Camera',
        title: 'Camera',
        description: 'the shared camera, frame-to-fit, controls',
      },
    ],
  },
  {
    name: 'Project',
    pages: [
      {
        file: 'brand.md',
        page: 'Brand',
        title: 'Brand',
        description: 'tokens, contrast rules, fonts, logo and icons, licences',
      },
      {
        file: 'site.md',
        page: 'Landing-page',
        title: 'Landing page',
        description: 'layout, hosting at / and /app/, the local file handoff, motion, tests',
      },
      {
        file: 'testing.md',
        page: 'Testing',
        title: 'Testing',
        description: 'unit and browser layers, goldens, budgets, CI',
      },
    ],
  },
];

/** docs file name -> page, in sidebar order. */
export const table = new Map(groups.flatMap((g) => g.pages).map((p) => [p.file, p]));
