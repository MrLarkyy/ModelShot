import { loadBbmodel } from '@modelshot/formats';
import alphaPlaneSource from '../../../../packages/formats/test/fixtures/bbmodel/alpha-plane.bbmodel?raw';
import meshShapesSource from '../../../../packages/formats/test/fixtures/bbmodel/mesh-shapes.bbmodel?raw';
import renderOrderSource from '../../../../packages/formats/test/fixtures/bbmodel/render-order.bbmodel?raw';
import { createContext, readDrawingBufferBase64 } from './context';
import type { MsFixture } from './fixtureApi';
import { computeProbes, type ProbeRequest } from './modelProbes';
import { renderRaster } from './modelRaster';
import { renderRaycast } from './modelRaycast';
import { cameraViewProjection } from './modelViewCamera';
import { parseModelViewVariant, type ModelViewModel } from './modelViewVariant';
import { sceneTriangles } from './sceneTriangles';
import { uploadTextures } from './sceneUpload';

const SIZE = 256;

// Static imports only: the page never loads a model named by the URL.
const MODELS: Readonly<Record<ModelViewModel, string>> = {
  'alpha-plane': alphaPlaneSource,
  'mesh-shapes': meshShapesSource,
  'render-order': renderOrderSource,
};

// Block centres of cutout.png (4×4-texel blocks, holes where bx + by is odd, red left half): on the bottom row of the
// cutout plane, in front of the ground, block (1, 3) is red and block (0, 3) a hole; on the back plane, block (0, 0)
// is red and its mirror image, block (3, 0), a hole. On the flat cube, the south face (toward the light) casts the
// shadow: block (3, 1) is opaque, block (3, 0) a hole that the coincident north face must not fill.
const PROBES: Readonly<Record<ModelViewModel, readonly ProbeRequest[]>> = {
  'alpha-plane': [
    { name: 'opaque-texel', mesh: 'cutout-plane', uv: [6, 14] },
    { name: 'transparent-texel', mesh: 'cutout-plane', uv: [2, 14] },
    { name: 'shadow-of-opaque-texel', mesh: 'cutout-plane', uv: [6, 14], groundY: 0 },
    { name: 'shadow-of-transparent-texel', mesh: 'cutout-plane', uv: [2, 14], groundY: 0 },
    { name: 'back-side-texel', mesh: 'back-plane', uv: [2, 2] },
    { name: 'flat-shadow-of-opaque-texel', mesh: 'flat-plane', uv: [14, 6], groundY: 0, facesLight: true },
    { name: 'flat-shadow-of-transparent-texel', mesh: 'flat-plane', uv: [14, 2], groundY: 0, facesLight: true },
  ],
  'mesh-shapes': [],
  // Texel (3, 1): yellow in checker.png, blue in uv-grid.png. Each pair is coincident; the probe names the winner.
  'render-order': [
    { name: 'in-front', mesh: 'in-front', uv: [3.5, 1.5] },
    { name: 'under-in-front', mesh: 'under-in-front', uv: [3.5, 1.5] },
    { name: 'over-behind', mesh: 'over-behind', uv: [3.5, 1.5] },
    { name: 'behind', mesh: 'behind', uv: [3.5, 1.5] },
    // Facing the eye, in_front farther by 2 x RENDER_ORDER_TIE_DISTANCE (the nearer shows) and by 0.5 x (in_front shows).
    { name: 'gap-near', mesh: 'gap-near', uv: [3.5, 1.5] },
    { name: 'gap-far-in-front', mesh: 'gap-far-in-front', uv: [3.5, 1.5] },
    { name: 'tie-near', mesh: 'tie-near', uv: [3.5, 1.5] },
    { name: 'tie-far-in-front', mesh: 'tie-far-in-front', uv: [3.5, 1.5] },
  ],
};

const api: MsFixture = {
  ready: Promise.resolve(),
  renderer: '',
  floatRenderTargets: false,
  width: SIZE,
  height: SIZE,
  samplesDone: 0,
  readRGBA: () => {
    throw new Error('the fixture did not render');
  },
};
window.__msFixture = api;

async function start(): Promise<void> {
  const variant = parseModelViewVariant(location.search);
  const ctx = createContext(SIZE);
  const { gl } = ctx;
  api.renderer = ctx.renderer;
  api.floatRenderTargets = ctx.floatRenderTargets;
  const { scene } = loadBbmodel(MODELS[variant.model]);
  const textures = await uploadTextures(gl, scene);
  const triangles = sceneTriangles(scene);
  if (variant.mode === 'raster') renderRaster(gl, triangles, textures, SIZE);
  else renderRaycast(gl, triangles, textures, SIZE);
  api.probes = computeProbes(scene, triangles, textures, PROBES[variant.model], cameraViewProjection(1), SIZE);
  api.readRGBA = () => readDrawingBufferBase64(gl, SIZE, SIZE);
}

api.ready = start();
api.ready.catch(() => undefined);
