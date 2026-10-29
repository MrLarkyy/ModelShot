import { loadBbmodel, loadGltf, loadObj } from '@modelshot/formats';
import { DEFAULT_LOOK, LOOK_PRESETS, type LookPreset } from '@modelshot/looks';
import { OrbitController } from '@modelshot/renderer-rt';
import { sceneBounds, type SceneCamera, type SceneDocument, type SceneMesh } from '@modelshot/scene';
import alphaPlaneSource from '../../../../packages/formats/test/fixtures/bbmodel/alpha-plane.bbmodel?raw';
import renderOrderSource from '../../../../packages/formats/test/fixtures/bbmodel/render-order.bbmodel?raw';
import contactShadowSource from '../../../../packages/formats/test/fixtures/gltf/contact-shadow.gltf?raw';
import sceneNodesSource from '../../../../packages/formats/test/fixtures/gltf/scene-nodes.gltf?raw';
import shapesMtlSource from '../../../../packages/formats/test/fixtures/obj/shapes.mtl?raw';
import shapesObjSource from '../../../../packages/formats/test/fixtures/obj/shapes.obj?raw';
import shapesPngUri from '../../../../packages/formats/test/fixtures/obj/shapes.png?inline';
import flatSource from '../models/rt-flat.bbmodel?raw';
import alphaRampUri from '../models/rt-alpha-ramp.png?inline';
import outlineHullSource from '../models/outline-hull.bbmodel?raw';
import showcaseSource from '../models/rt-showcase.bbmodel?raw';
import { benchScene } from './benchScene';
import { cutoutChecker } from './cutoutChecker';
import { cutoutEdge } from './cutoutEdge';
import { edgesBbmodel, edgesHostileScene, edgesLoadScene, edgesScene, edgesWeldScene } from './edgesScene';
import { MODEL_VIEW_LOOK, type Point3 } from './modelViewCamera';
import { holdingCube, playerScene, posedPlayer } from './playerScenes';
import { textureWrapScene } from './textureWrapScene';
import { worldLoadScene } from './worldLoadScene';

/**
 * Named scenes and camera presets of the realtime fixture. The path-tracer fixture renders the same scenes and
 * cameras (`rtCamera`) so its goldens pair with these.
 */
export const RT_SCENE_NAMES = [
  'showcase',
  'flat',
  'bench',
  'bench-order',
  'hostile-corrupt',
  'hostile-corrupt-data',
  'hostile-missing',
  'hostile-mismatch',
  'hostile-huge-header',
  'empty',
  'alpha-plane',
  'render-order',
  'coincident-double',
  'closed-cube',
  'closed-cube-order',
  'alpha-ramp-blend',
  'alpha-ramp-mask',
  'alpha-ramp-opaque',
  'large-order',
  'closed-cube-open',
  'closed-cube-order-open',
  'closed-cube-cutout',
  'closed-cube-inverted',
  'tie-pair',
  'tie-single',
  'tie-pair-double',
  'tie-single-double',
  'step',
  'step-open',
  'step-order',
  'step-order-open',
  'gltf-nodes',
  'obj-shapes',
  'player-classic',
  'player-slim',
  'player-legacy',
  'player-legacy-opaque-hat',
  'player-hold',
  'player-walk-hold',
  'player-wave',
  'coincident-cubes',
  'grass-field',
  'cutout-checker',
  'cutout-edge',
  'lightmap-overflow',
  'edges',
  'edges-200k',
  'edges-hostile',
  'edges-weld',
  'outline-hull',
  'outline-hull-board',
  'gltf-contact',
  'world-200k',
  'texture-wrap',
] as const;
export type RtSceneName = (typeof RT_SCENE_NAMES)[number];

export function isRtSceneName(name: string): name is RtSceneName {
  return (RT_SCENE_NAMES as readonly string[]).includes(name);
}

export interface RtView {
  readonly scene: RtSceneName;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly projection: 'perspective' | 'orthographic';
  readonly fovYDeg: number;
  /** Multiplies the frame-to-fit distance (perspective) or height (orthographic); clamped to the orbit limits. */
  readonly zoom: number;
  /** Blockbench isometric view (orthographic, 45°, 35.264°); overrides the angles and projection. */
  readonly isometric: boolean;
  /** No-float path. */
  readonly fallback: boolean;
  /** Texel anti-aliasing; false samples plain nearest texels. */
  readonly texelAntialias: boolean;
  /** Draw meshes in reverse order (the transparency result must not change). */
  readonly reverse: boolean;
  /** A fixed camera instead of the orbit (`LOOKS`), with the clip planes of `depth`. */
  readonly look: RtLook | null;
  /**
   * `framed`: clip planes around the content (the raster depth key holds); `inside`: near = far × 1e-4, as for a
   * camera inside the bounding sphere (the renderer switches to the exact depth key).
   */
  readonly depth: 'framed' | 'inside';
  /** Hides every mesh of this name (it must exist in the scene); null hides nothing. */
  readonly hide: string | null;
  /** Realtime fixture: bake the light with this many samples before the first frame; 0 draws unbaked. */
  readonly bake: number;
  /** The shadow catcher: baked with the light in the realtime fixture, traced by the path tracer. */
  readonly catcher: boolean;
  /** Rounded-edge width (`EdgeLook.width`, `edges=<width>`, 0 none); null keeps the look's edges. */
  readonly edges: number | null;
  /** The look preset by id (`preset=<id>`, `LOOK_PRESETS`), shared by the preview, the bake and the render. */
  readonly preset: string;
  /** `rim=0`: the preset with its rim light black, to see what the rim adds. */
  readonly rim: boolean;
}

export type RtLook =
  | 'model-view'
  | 'above'
  | 'below'
  | 'grazing-above'
  | 'grazing-below'
  | 'cube'
  | 'cube-grazing-1'
  | 'cube-grazing-5'
  | 'cube-inside'
  | 'ramp'
  | 'flat-shadow'
  | 'checker'
  | 'contact'
  | 'edge'
  | 'wrap';

/** Fixed cameras: the model-view fixture's (same image positions as its probes) and two views of a horizontal pair. */
const LOOKS: Readonly<Record<RtLook, { eye: Point3; target: Point3; near: number; far: number }>> = {
  'model-view': { eye: MODEL_VIEW_LOOK.eye, target: MODEL_VIEW_LOOK.target, near: 20, far: 120 },
  above: { eye: [0, 10, 14], target: [0, 0, 0], near: 5, far: 40 },
  below: { eye: [0, -10, 14], target: [0, 0, 0], near: 5, far: 40 },
  // About 8 degrees above and below the quads: depth changes fast across a pixel, the hard case for interpolated depth.
  'grazing-above': { eye: [-4, 3, 20], target: [-4, 0, 0], near: 5, far: 40 },
  'grazing-below': { eye: [-4, -3, 20], target: [-4, 0, 0], near: 5, far: 40 },
  // Sees the south, east and up faces of a cube around the origin.
  cube: { eye: [10, 8, 14], target: [0, 0, 0], near: 5, far: 40 },
  // The east face (x = 4) about 1 and 5 degrees from edge-on: its extended plane runs far behind the box.
  'cube-grazing-1': { eye: [4.5, 3, 30], target: [0, 0, 0], near: 20, far: 40 },
  'cube-grazing-5': { eye: [6.6, 3, 30], target: [0, 0, 0], near: 20, far: 40 },
  // Inside the cube, towards the back side of its east face; the clip planes keep the raster depth key.
  'cube-inside': { eye: [0, 1, 1], target: [4, 0, 0], near: 0.5, far: 20 },
  // Square onto the 16 x 16 alpha ramp at z = 0 with a backdrop border: one texel is about 15 pixels at 256 px.
  ramp: {
    eye: [0, 0, 8.5 / Math.tan((MODEL_VIEW_LOOK.fovYDegrees * Math.PI) / 360)],
    target: [0, 0, 0],
    near: 5,
    far: 40,
  },
  // From the north, above: the ground north of alpha-plane's flat cube, where the key light casts its shadow.
  'flat-shadow': { eye: [10, 40, -30], target: [10, 0, 6], near: 5, far: 120 },
  // The cut-out checker from behind its left half, above: no texel hides the ground its shadows fall on.
  checker: { eye: [-15.5, 25.4, -3], target: [-2, 2, -2.25], near: 5, far: 120 },
  // The contact-shadow glTF from the shadow side: the key light (from +x +z) casts the box's shadow toward the camera.
  contact: { eye: [-70, 62, -78], target: [-4, 0, -14], near: 20, far: 260 },
  // The cutout-edge quad from yaw 20, pitch 15 at about 24 pixels per texel (256 px): 14.65 = 5.33 / tan(20 deg).
  edge: { eye: [4.84, 3.79, 13.3], target: [0, 0, 0], near: 5, far: 40 },
  // The texture-wrap boxes' south faces from 10 degrees above, columns vertical: about 5 pixels per texel at 256 px.
  wrap: { eye: [-2, 26.7, 66.3], target: [-2, 15, 0], near: 40, far: 150 },
};

export const DEFAULT_RT_VIEW: RtView = {
  scene: 'showcase',
  yawDeg: 30,
  pitchDeg: 20,
  projection: 'perspective',
  fovYDeg: 35,
  zoom: 1,
  isometric: false,
  fallback: false,
  texelAntialias: true,
  reverse: false,
  look: null,
  depth: 'framed',
  hide: null,
  bake: 0,
  catcher: true,
  edges: null,
  preset: DEFAULT_LOOK.id,
  rim: true,
};

/** Golden presets, selected by the `variant` URL parameter. */
export const RT_VARIANTS: Readonly<Record<string, Partial<RtView>>> = {
  'turntable-y000': { yawDeg: 0 },
  'turntable-y030': { yawDeg: 30 },
  'turntable-y060': { yawDeg: 60 },
  'turntable-y090': { yawDeg: 90 },
  iso: { isometric: true },
  closeup: { yawDeg: 30, zoom: 0.5 },
  // Three times the fit distance: the 64x64 brick face is minified to about 0.45 px per texel while the model still
  // covers enough pixels to show shimmer; at the 8x limit the model is a 16 px speck.
  far: { yawDeg: 30, zoom: 3 },
  fallback: { yawDeg: 30, fallback: true },
  'fit-flat-cube': { scene: 'flat', yawDeg: 30, pitchDeg: 20 },
  'gltf-nodes-y030': { scene: 'gltf-nodes', yawDeg: 30 },
  'obj-shapes-y030': { scene: 'obj-shapes', yawDeg: 30 },
  // The model-view scenes and the alpha ramp under their fixed cameras (path-tracer goldens and preview pairs).
  'alpha-plane': { scene: 'alpha-plane', look: 'model-view' },
  'render-order': { scene: 'render-order', look: 'model-view' },
  'alpha-ramp-blend': { scene: 'alpha-ramp-blend', look: 'ramp' },
  // The player faces -Z: yaw 180 looks at its front, yaw 0 at its back, yaw 210 from its front left.
  'player-classic-front': { scene: 'player-classic', yawDeg: 180, pitchDeg: 10 },
  'player-classic-back': { scene: 'player-classic', yawDeg: 0, pitchDeg: 10 },
  'player-slim-34': { scene: 'player-slim', yawDeg: 210, pitchDeg: 20 },
  'player-legacy-34': { scene: 'player-legacy', yawDeg: 210, pitchDeg: 20 },
  'player-legacy-opaque-hat-34': { scene: 'player-legacy-opaque-hat', yawDeg: 210, pitchDeg: 20 },
  'player-hold-34': { scene: 'player-hold', yawDeg: 210, pitchDeg: 20 },
  'player-walk-hold-34': { scene: 'player-walk-hold', yawDeg: 210, pitchDeg: 20 },
  'player-slim-fallback': { scene: 'player-slim', yawDeg: 210, pitchDeg: 20, fallback: true },
  'player-wave-front': { scene: 'player-wave', yawDeg: 180, pitchDeg: 10 },
  // Baked light (realtime) and the path tracer's shadows of cut-out texels, MS-16.
  'cutout-checker': { scene: 'cutout-checker', look: 'checker' },
  'bake-cutout-checker': { scene: 'cutout-checker', look: 'checker', bake: 64 },
  'bake-cutout-checker-fallback': { scene: 'cutout-checker', look: 'checker', bake: 64, fallback: true },
  // MS-30: anti-aliased cutout seams on the MSAA path; `-inside` is the same image position under the exact depth
  // key (near = far x 1e-4), whose frames draw single-sampled.
  'cutout-edge': { scene: 'cutout-edge', look: 'edge' },
  'cutout-edge-inside': { scene: 'cutout-edge', look: 'edge', depth: 'inside' },
  'bake-alpha-plane': { scene: 'alpha-plane', look: 'model-view', bake: 64 },
  'bake-turntable-y030': { yawDeg: 30, bake: 64 },
  // Edge rounding (MS-15): sharp-edged cube and wedge beside a plane, a card and a smooth sphere.
  edges: { scene: 'edges', yawDeg: 30, pitchDeg: 35 },
  // Look presets (MS-19) on the held-cube player, baked; paired with the path tracer's renders of the same look.
  'preset-marketplace': { scene: 'player-hold', yawDeg: 210, pitchDeg: 20, preset: 'marketplace', bake: 64 },
  'preset-rim': { scene: 'player-hold', yawDeg: 210, pitchDeg: 20, preset: 'rim', bake: 64 },
  // The app's default orbit yaw: the view-relative rim lights the screen-left silhouettes from here too.
  'preset-marketplace-yaw30': { scene: 'player-hold', yawDeg: 30, pitchDeg: 20, preset: 'marketplace', bake: 64 },
  'preset-marketplace-fallback': {
    scene: 'player-hold',
    yawDeg: 210,
    pitchDeg: 20,
    preset: 'marketplace',
    bake: 64,
    fallback: true,
  },
  // MS-41: an image-less glTF ground and smooth box, baked at world-density charts; paired with pt-gltf-contact. The
  // ground is the scene's lowest surface, so no shadow catcher (it would lie in the ground's plane).
  'gltf-contact': { scene: 'gltf-contact', look: 'contact', catcher: false },
  'bake-gltf-contact': { scene: 'gltf-contact', look: 'contact', catcher: false, bake: 64 },
  // MS-50: a board inside an inverted-hull outline (a Blockbench cube with from > to), seen from above its side.
  'outline-hull': { scene: 'outline-hull', yawDeg: 30, pitchDeg: 30 },
  // MS-52: faces past their texture or strip frame, clamped (Hytale default, free default) and repeated (stored
  // wrap_mode); `-inside` is the same image position under the exact depth key, whose mesh pass has the most varyings.
  'texture-wrap': { scene: 'texture-wrap', look: 'wrap' },
  'texture-wrap-inside': { scene: 'texture-wrap', look: 'wrap', depth: 'inside' },
};

/** The look of a view: its preset, with the rim light black under `rim=0`. */
export function rtLook(view: RtView): LookPreset {
  const look = Object.hasOwn(LOOK_PRESETS, view.preset) ? LOOK_PRESETS[view.preset] : undefined;
  if (!look) throw new Error(`unknown preset "${view.preset}"`);
  if (view.rim) return look;
  return { ...look, lights: { ...look.lights, rim: { ...look.lights.rim, color: [0, 0, 0] } } };
}

function load(source: string): SceneDocument {
  return loadBbmodel(source).scene;
}

/** A copy of `doc` with every mesh named `name` hidden; throws when the scene has no such mesh. */
export function hideMeshes(doc: SceneDocument, name: string): SceneDocument {
  if (!doc.meshes.some((mesh) => mesh.name === name)) throw new Error(`unknown mesh "${name}"`);
  return { ...doc, meshes: doc.meshes.map((mesh) => (mesh.name === name ? { ...mesh, visible: false } : mesh)) };
}

/** A copy of `doc` whose meshes are stored, and so drawn, in reverse order. */
export function reverseMeshOrder(doc: SceneDocument): SceneDocument {
  const last = doc.meshes.length - 1;
  return {
    ...doc,
    meshes: [...doc.meshes].reverse(),
    nodes: doc.nodes.map((node) => ({ ...node, meshes: node.meshes.map((m) => last - m).reverse() })),
  };
}

function withTexture(doc: SceneDocument, index: number, change: Partial<SceneDocument['textures'][number]>) {
  return {
    ...doc,
    textures: doc.textures.map((texture, i) => (i === index ? { ...texture, ...change } : texture)),
  };
}

export function rtScene(name: RtSceneName): SceneDocument {
  switch (name) {
    case 'showcase':
      return load(showcaseSource);
    case 'flat':
      return load(flatSource);
    case 'bench':
      return benchScene(load(showcaseSource));
    case 'bench-order': {
      const bench = benchScene(load(showcaseSource));
      return { ...bench, meshes: bench.meshes.map((mesh, i) => (i === 0 ? { ...mesh, renderOrder: 1 } : mesh)) };
    }
    case 'hostile-corrupt': {
      // A PNG signature followed by bytes that are no valid chunk: rejected at the header check, never decoded.
      const bytes = new Uint8Array(64).map((_, i) => (i < 8 ? [137, 80, 78, 71, 13, 10, 26, 10][i]! : (i * 37) & 255));
      return withTexture(load(showcaseSource), 0, { bytes });
    }
    case 'hostile-corrupt-data': {
      // Signature and IHDR intact (33 bytes), every later byte scrambled: passes the header check, fails to decode.
      const doc = load(showcaseSource);
      const bytes = new Uint8Array(doc.textures[0]?.bytes ?? new Uint8Array(0)).map((value, i) =>
        i < 33 ? value : value ^ ((i * 151) & 255) ^ 0x5a,
      );
      return withTexture(doc, 0, { bytes });
    }
    case 'hostile-missing':
      return withTexture(load(showcaseSource), 0, { bytes: null, missing: true, width: 0, height: 0 });
    case 'hostile-mismatch':
      // The header claims 16x16; the image is 32x32.
      return withTexture(load(showcaseSource), 0, { width: 16, height: 16 });
    case 'hostile-huge-header': {
      // The scene declares 16x16; the PNG header claims 16384x16384 (never decoded, so its CRC does not matter).
      const doc = load(showcaseSource);
      const bytes = new Uint8Array(doc.textures[0]?.bytes ?? new Uint8Array(24));
      new DataView(bytes.buffer).setUint32(16, 16384);
      new DataView(bytes.buffer).setUint32(20, 16384);
      return withTexture(doc, 0, { bytes, width: 16, height: 16 });
    }
    case 'empty':
      return { ...load(showcaseSource), meshes: [], nodes: [], rootNodes: [] };
    case 'alpha-plane':
      return load(alphaPlaneSource);
    case 'render-order':
      return load(renderOrderSource);
    case 'coincident-double':
      return coincidentDouble(load(alphaPlaneSource));
    case 'closed-cube':
      return closedCube(0, false);
    case 'closed-cube-order':
      return closedCube(1, false);
    case 'closed-cube-open':
      return closedCube(0, true);
    case 'closed-cube-order-open':
      return closedCube(1, true);
    case 'closed-cube-cutout':
      return closedCube(0, false, true);
    case 'closed-cube-inverted':
      return invertFaces(closedCube(0, false));
    case 'step':
      return step(0, false);
    case 'step-open':
      return step(0, true);
    case 'step-order':
      return step(1, false);
    case 'step-order-open':
      return step(1, true);
    case 'tie-pair':
      return tiePair(load(alphaPlaneSource), true);
    case 'tie-single':
      return tiePair(load(alphaPlaneSource), false);
    case 'tie-pair-double':
      return tiePair(load(alphaPlaneSource), true, true);
    case 'tie-single-double':
      return tiePair(load(alphaPlaneSource), false, true);
    case 'alpha-ramp-blend':
      return alphaRamp({ alphaMode: 'blend', alphaCutoff: 0.01 });
    case 'alpha-ramp-mask':
      return alphaRamp({ alphaMode: 'mask', alphaCutoff: 128 / 255 });
    case 'alpha-ramp-opaque':
      return alphaRamp({ alphaMode: 'opaque' });
    case 'large-order':
      return largeOrderScene(load(showcaseSource));
    case 'gltf-nodes':
      return loadGltf(sceneNodesSource).scene;
    case 'obj-shapes':
      return loadObj(shapesObjSource, { fileName: 'shapes.obj', files: shapesFiles() }).scene;
    case 'coincident-cubes':
      return coincidentCubes(load(showcaseSource));
    case 'grass-field':
      return grassField(load(alphaPlaneSource));
    case 'cutout-checker':
      return cutoutChecker(load(showcaseSource));
    case 'cutout-edge':
      return cutoutEdge(load(showcaseSource));
    case 'lightmap-overflow':
      return lightmapOverflow(load(showcaseSource));
    case 'edges-200k':
      return edgesLoadScene(load(showcaseSource));
    case 'edges-weld':
      return edgesWeldScene(load(showcaseSource));
    case 'edges-hostile':
      return edgesHostileScene(load(showcaseSource));
    case 'edges':
      return edgesScene(load(edgesBbmodel((JSON.parse(alphaPlaneSource) as { textures: unknown[] }).textures[0])));
    case 'player-classic':
      return playerScene('classic', 'classic');
    case 'player-slim':
      return playerScene('slim', 'slim');
    case 'player-legacy':
      return playerScene('legacy', 'classic');
    case 'player-legacy-opaque-hat':
      return playerScene('legacy-opaque-hat', 'classic');
    case 'player-hold':
      return holdingCube(playerScene('classic', 'classic'), 'hold');
    case 'player-walk-hold':
      return holdingCube(playerScene('classic', 'classic'), 'walk');
    case 'player-wave':
      return posedPlayer(playerScene('classic', 'classic'), 'wave');
    case 'outline-hull':
      return load(outlineHullSource);
    case 'gltf-contact':
      return loadGltf(contactShadowSource).scene;
    case 'world-200k':
      return worldLoadScene(load(showcaseSource));
    case 'texture-wrap':
      return textureWrapScene();
    case 'outline-hull-board': {
      // The shell keeps its vertices, so the camera fits the same bounds as outline-hull, but draws no triangle.
      const doc = load(outlineHullSource);
      const drop = (mesh: SceneMesh) =>
        mesh.name === 'shell' ? { ...mesh, indices: new Uint32Array(0), groups: [] } : mesh;
      return { ...doc, meshes: doc.meshes.map(drop) };
    }
  }
}

/** The files a user picks next to `shapes.obj`: its material library and texture (static imports, nothing fetched). */
function shapesFiles(): ReadonlyMap<string, Uint8Array> {
  const png = Uint8Array.from(atob(shapesPngUri.slice(shapesPngUri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  return new Map([
    ['shapes.mtl', new TextEncoder().encode(shapesMtlSource)],
    ['shapes.png', png],
  ]);
}

/** A horizontal quad over x, z in [x0, x0 + 8] × [−4, 4] at y = 0, its front up (+y) or down, split along a or c. */
function quad(name: string, x0: number, up: boolean, diagonal: 'a' | 'c', uv: [number, number], doubleSided: boolean) {
  const corners = [
    [x0, 0, 4],
    [x0 + 8, 0, 4],
    [x0 + 8, 0, -4],
    [x0, 0, -4],
  ];
  const order = up ? [0, 1, 2, 3] : [3, 2, 1, 0];
  const indices = diagonal === 'a' ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
  const mesh: SceneMesh = {
    name,
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(order.flatMap((i) => corners[i] ?? [0, 0, 0])),
    normals: new Float32Array(Array.from({ length: 4 }, () => [0, up ? 1 : -1, 0]).flat()),
    uvs: new Float32Array(Array.from({ length: 4 }, () => uv).flat()),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [uv[0], uv[1], uv[0], uv[1]]).flat()),
    indices: new Uint32Array(indices),
    groups: [{ material: 0, start: 0, count: 6, doubleSided }],
  };
  return mesh;
}

/**
 * Two coincident double-sided quads, one facing up (red texel of cutout.png), one facing down (blue texel), split
 * along different diagonals: from above the red one must show, from below the blue one. Beside them a single-sided
 * red quad facing up: from below it shows nothing.
 */
function coincidentDouble(alphaPlane: SceneDocument): SceneDocument {
  const red: [number, number] = [2.5 / 16, 2.5 / 16];
  const blue: [number, number] = [10.5 / 16, 2.5 / 16];
  return {
    ...alphaPlane,
    nodes: [],
    rootNodes: [],
    meshes: [
      quad('up', -10, true, 'a', red, true),
      quad('down', -10, false, 'c', blue, true),
      quad('single', 2, true, 'a', red, false),
    ],
  };
}

/** The camera of a view for a viewport of `aspect`: a fixed look, or the orbit controller the app uses. */
export function rtCamera(doc: SceneDocument, view: RtView, aspect: number): SceneCamera {
  if (view.look) {
    const { eye, target, near, far } = LOOKS[view.look];
    return {
      position: eye,
      target,
      up: [0, 1, 0],
      projection: { kind: 'perspective', fovYDeg: MODEL_VIEW_LOOK.fovYDegrees },
      near: view.depth === 'inside' ? far * 1e-4 : near,
      far,
    };
  }
  const controller = new OrbitController({
    damping: false,
    yawDeg: view.yawDeg,
    pitchDeg: view.pitchDeg,
    fovYDeg: view.fovYDeg,
    projection: view.projection,
  });
  controller.setAspect(aspect);
  controller.reset(sceneBounds(doc));
  if (view.isometric) controller.isometric();
  controller.zoom(view.zoom);
  return controller.camera();
}

/** Parses the fixture URL: `variant` picks a preset, explicit parameters override it. Unknown values throw. */
export function parseRtView(params: URLSearchParams): RtView {
  const variantName = params.get('variant');
  const variant =
    variantName === null ? {} : Object.hasOwn(RT_VARIANTS, variantName) ? RT_VARIANTS[variantName] : undefined;
  if (!variant) throw new Error(`unknown variant "${String(variantName)}"`);
  const view: { -readonly [K in keyof RtView]: RtView[K] } = { ...DEFAULT_RT_VIEW, ...variant };
  const number = (name: string, min: number, max: number): number | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    if (!/^-?\d+(\.\d+)?(e-?\d+)?$/.test(raw) || value < min || value > max) {
      throw new Error(`query parameter ${name} must be a number in ${min}..${max}`);
    }
    return value;
  };
  const flag = (name: string): boolean | undefined => {
    const raw = params.get(name);
    if (raw === null) return undefined;
    if (raw !== '0' && raw !== '1') throw new Error(`query parameter ${name} must be 0 or 1`);
    return raw === '1';
  };
  const scene = params.get('scene');
  if (scene !== null) {
    if (!isRtSceneName(scene)) throw new Error(`unknown scene "${scene}"`);
    view.scene = scene;
  }
  view.yawDeg = number('yaw', -3600, 3600) ?? view.yawDeg;
  view.pitchDeg = number('pitch', -90, 90) ?? view.pitchDeg;
  view.fovYDeg = number('fov', 1, 179) ?? view.fovYDeg;
  view.zoom = number('zoom', 1e-9, 1e9) ?? view.zoom;
  const projection = params.get('proj');
  if (projection !== null) {
    if (projection !== 'persp' && projection !== 'ortho')
      throw new Error('query parameter proj must be persp or ortho');
    view.projection = projection === 'ortho' ? 'orthographic' : 'perspective';
  }
  view.fallback = flag('fallback') ?? view.fallback;
  view.texelAntialias = flag('aa') ?? view.texelAntialias;
  view.reverse = flag('reverse') ?? view.reverse;
  view.isometric = flag('iso') ?? view.isometric;
  view.catcher = flag('catcher') ?? view.catcher;
  view.edges = number('edges', 0, 4) ?? view.edges;
  view.rim = flag('rim') ?? view.rim;
  const preset = params.get('preset');
  if (preset !== null) {
    if (!Object.hasOwn(LOOK_PRESETS, preset)) throw new Error(`unknown preset "${preset}"`);
    view.preset = preset;
  }
  const bake = params.get('bake');
  if (bake !== null) {
    if (!/^\d{1,4}$/.test(bake) || Number(bake) > 1024)
      throw new Error('query parameter bake must be an integer in 0..1024');
    view.bake = Number(bake);
  }
  const look = params.get('look');
  if (look !== null) {
    if (!Object.hasOwn(LOOKS, look)) throw new Error(`unknown look "${look}"`);
    view.look = look as RtLook;
  }
  const depth = params.get('depth');
  if (depth !== null) {
    if (depth !== 'framed' && depth !== 'inside') throw new Error('query parameter depth must be framed or inside');
    view.depth = depth;
  }
  const hide = params.get('hide');
  if (hide !== null) {
    if (!/^[\w-]{1,64}$/.test(hide)) throw new Error('query parameter hide must be a mesh name');
    view.hide = hide;
  }
  return view;
}

/**
 * A closed 8-unit cube around the origin, every face double-sided (free format, render_sides auto): the faces the
 * `cube` look sees (south, east, up) are red, the others blue, so any blue pixel is a back side shown through a front
 * face. `renderOrder` 1 makes the renderer use the exact depth key. `open` leaves the hidden faces out: the image must
 * not change, at any sample. `cutout` gives the hidden faces a rectangle with a hole, so the cube is closed but not
 * opaque on every face and raster frames still draw its back sides.
 */
function closedCube(renderOrder: number, open: boolean, cutout = false): SceneDocument {
  return boxes(
    [
      [
        [-4, -4, -4],
        [4, 4, 4],
      ],
    ],
    renderOrder,
    open,
    cutout,
  );
}

/**
 * Every triangle wound the other way and every normal flipped, as Blockbench's Invert Faces leaves a model: a closed
 * mesh inside out, whose near walls are back sides.
 */
function invertFaces(doc: SceneDocument): SceneDocument {
  return {
    ...doc,
    meshes: doc.meshes.map((mesh) => {
      const indices = new Uint32Array(mesh.indices);
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const second = indices[t + 1] ?? 0;
        indices[t + 1] = indices[t + 2] ?? 0;
        indices[t + 2] = second;
      }
      return { ...mesh, indices, normals: mesh.normals.map((n) => -n) };
    }),
  };
}

/**
 * A step: a tall box (x −4..0) beside a low one (x 0..4, y −4..0), both closed and double-sided like `closedCube`.
 * The low box's up face ends at the tall box's east face (a T-junction), and its west face coincides with the lower
 * half of that east face, facing the other way: hidden blue faces at a T-junction and behind a coincident pair.
 */
function step(renderOrder: number, open: boolean): SceneDocument {
  return boxes(
    [
      [
        [-4, -4, -4],
        [0, 4, 4],
      ],
      [
        [0, -4, -4],
        [4, 0, 4],
      ],
    ],
    renderOrder,
    open,
  );
}

/**
 * Closed boxes with every face double-sided (free format, render_sides auto): the faces the `cube` looks see (south,
 * east, up) red, the others blue; the first box at render order 1 when `renderOrder` is 1. `open` leaves the blue
 * faces out: the image must not change at any sample.
 */
function boxes(
  extents: readonly (readonly [number[], number[]])[],
  renderOrder: number,
  open: boolean,
  cutout = false,
): SceneDocument {
  const texture = (JSON.parse(alphaPlaneSource) as { textures: unknown[] }).textures[0];
  const red = { uv: [0, 0, 4, 4], texture: 0 };
  // `cutout`: the hidden faces' rectangle is half hole (texel columns 6-7, alpha 0), half blue (columns 8-9).
  const blue = { uv: cutout ? [6, 0, 10, 4] : [8, 0, 12, 4], texture: 0 };
  const model = {
    meta: { format_version: '4.10', model_format: 'free', box_uv: false },
    resolution: { width: 16, height: 16 },
    elements: extents.map(([from, to], i) => ({
      name: `box ${i}`,
      type: 'cube',
      uuid: `b${i}`,
      from,
      to,
      origin: [0, 0, 0],
      ...(renderOrder === 1 && i === 0 ? { render_order: 'in_front' } : {}),
      faces: open
        ? { east: red, south: red, up: red }
        : { north: blue, east: red, south: red, west: blue, up: red, down: blue },
    })),
    outliner: extents.map((_, i) => `b${i}`),
    textures: [texture],
  };
  return load(JSON.stringify(model));
}

/**
 * A 16 x 16 quad at z = 0 facing +z with `rt-alpha-ramp.png`: white texels whose alpha byte is their index
 * (row-major, 0 top-left to 255 bottom-right), under the given alpha rule.
 */
function alphaRamp(alpha: Pick<SceneDocument['materials'][number], 'alphaMode' | 'alphaCutoff'>): SceneDocument {
  const base = load(showcaseSource);
  const bytes = Uint8Array.from(atob(alphaRampUri.slice(alphaRampUri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const mesh: SceneMesh = {
    name: 'ramp',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array([-8, -8, 0, 8, -8, 0, 8, 8, 0, -8, 8, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    uvRects: new Float32Array(Array.from({ length: 4 }, () => [0, 0, 1, 1]).flat()),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    groups: [{ material: 0, start: 0, count: 6 }],
  };
  return {
    ...base,
    nodes: [],
    rootNodes: [],
    meshes: [mesh],
    materials: [{ name: 'ramp', texture: 0, ...alpha }],
    textures: [
      {
        name: 'rt-alpha-ramp.png',
        mimeType: 'image/png',
        bytes,
        width: 16,
        height: 16,
        uvWidth: 16,
        uvHeight: 16,
        missing: false,
      },
    ],
  };
}

/**
 * A field of cut-out plants on a ground plane: 64 x 64 crossed pairs of double-sided 8 x 8 quads 6 units apart, each
 * showing alpha-plane's cutout.png (half its texels holes), 16 384 quads in all. Seen at a low angle, rays cross dozens
 * of plants and their holes before a hit: the realistic worst case for the path tracer's per-ray node cap.
 */
function grassField(alphaPlane: SceneDocument): SceneDocument {
  const side = 64;
  const spacing = 6;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (corners: readonly (readonly number[])[], normal: readonly number[], uv: readonly number[][]): void => {
    const base = positions.length / 3;
    corners.forEach((corner, i) => {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(...(uv[i] ?? [0, 0]));
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const extent = (side * spacing) / 2 + 8;
  const flat = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  quad(
    [
      [-extent, 0, extent],
      [extent, 0, extent],
      [extent, 0, -extent],
      [-extent, 0, -extent],
    ],
    [0, 1, 0],
    flat,
  );
  const groundIndices = indices.length;
  const full = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      const x = (i - side / 2 + 0.5) * spacing;
      const z = (j - side / 2 + 0.5) * spacing;
      quad(
        [
          [x - 4, 0, z],
          [x + 4, 0, z],
          [x + 4, 8, z],
          [x - 4, 8, z],
        ],
        [0, 0, 1],
        full,
      );
      quad(
        [
          [x, 0, z + 4],
          [x, 0, z - 4],
          [x, 8, z - 4],
          [x, 8, z + 4],
        ],
        [1, 0, 0],
        full,
      );
    }
  }
  const vertices = positions.length / 3;
  const mesh: SceneMesh = {
    name: 'field',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    uvRects: new Float32Array(Array.from({ length: vertices }, (_, v) => (v < 4 ? [0, 0, 0, 0] : [0, 0, 1, 1])).flat()),
    indices: new Uint32Array(indices),
    groups: [
      { material: -1, start: 0, count: groundIndices },
      { material: 0, start: groundIndices, count: indices.length - groundIndices, doubleSided: true },
    ],
  };
  return { ...alphaPlane, nodes: [], rootNodes: [], meshes: [mesh] };
}

/**
 * 10 000 coincident untextured 8-unit cubes (the bbmodel loader's element limit, 120 000 triangles) in one mesh: every
 * BVH node box is the same, so nothing prunes a traversal. The path tracer's per-ray node cap must keep a sample short.
 */
function coincidentCubes(showcase: SceneDocument): SceneDocument {
  const cubes = 10_000;
  const positions: number[] = [];
  const normals: number[] = [];
  const cube: number[] = [];
  for (const [axis, sign] of [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ] as const) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const base = positions.length / 3;
    for (const [a, b] of [
      [-4, -4],
      [4, -4],
      [4, 4],
      [-4, 4],
    ] as const) {
      const p = [0, 0, 0];
      p[axis] = 4 * sign;
      p[u] = a;
      p[v] = b;
      positions.push(...p);
      const n = [0, 0, 0];
      n[axis] = sign;
      normals.push(...n);
    }
    // Counter-clockwise seen from outside.
    cube.push(...(sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => base + i));
  }
  const indices = new Uint32Array(cubes * cube.length);
  for (let c = 0; c < cubes; c++) indices.set(cube, c * cube.length);
  const mesh: SceneMesh = {
    name: 'cubes',
    sourceId: '',
    node: -1,
    visible: true,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array((positions.length / 3) * 2),
    uvRects: new Float32Array((positions.length / 3) * 4),
    indices,
    groups: [{ material: -1, start: 0, count: indices.length }],
  };
  return { ...showcase, nodes: [], rootNodes: [], meshes: [mesh] };
}

/**
 * More double-sided untextured triangles, each with its own corners, than the lightmap has texels for their vertices
 * (two each, front and back): lightmapLayout must refuse it before allocating a lightmap.
 */
function lightmapOverflow(showcase: SceneDocument): SceneDocument {
  const triangles = 350_000;
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t++) {
    const x = t % 1000;
    const z = Math.floor(t / 1000);
    positions.set([x, 0, z, x + 1, 0, z, x, 0, z + 1], t * 9);
  }
  const normals = new Float32Array(triangles * 9);
  for (let v = 0; v < triangles * 3; v++) normals[v * 3 + 1] = 1;
  const mesh: SceneMesh = {
    name: 'overflow',
    sourceId: '',
    node: -1,
    visible: true,
    positions,
    normals,
    uvs: new Float32Array(triangles * 6),
    uvRects: new Float32Array(triangles * 12),
    indices: Uint32Array.from({ length: triangles * 3 }, (_, i) => i),
    groups: [{ material: -1, start: 0, count: triangles * 3, doubleSided: true }],
  };
  return { ...showcase, nodes: [], rootNodes: [], meshes: [mesh] };
}

/**
 * The loader's limits in one mesh: 100 000 quads (200 000 triangles, 400 000 vertices, each quad its own four, as the
 * loader writes faces) on a 316-wide grid, at render order 1, so the renderer builds the exact key's de-indexed
 * geometry at upload. For the load-and-first-frame budget.
 */
function largeOrderScene(showcase: SceneDocument): SceneDocument {
  const quads = 100_000;
  const side = 316;
  const positions = new Float32Array(quads * 12);
  const normals = new Float32Array(quads * 12);
  const uvs = new Float32Array(quads * 8);
  const uvRects = new Float32Array(quads * 16);
  const indices = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const x = (q % side) - side / 2;
    const z = Math.floor(q / side) - side / 2;
    positions.set([x, 0, z + 0.9, x + 0.9, 0, z + 0.9, x + 0.9, 0, z, x, 0, z], q * 12);
    normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], q * 12);
    uvs.set([0, 0.25, 0.25, 0.25, 0.25, 0, 0, 0], q * 8);
    for (let v = 0; v < 4; v++) uvRects.set([0, 0, 0.25, 0.25], q * 16 + v * 4);
    const b = q * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  const mesh: SceneMesh = {
    name: 'grid',
    sourceId: '',
    node: -1,
    visible: true,
    renderOrder: 1,
    positions,
    normals,
    uvs,
    uvRects,
    indices,
    groups: [{ material: 0, start: 0, count: indices.length, doubleSided: true }],
  };
  return { ...showcase, nodes: [], rootNodes: [], meshes: [mesh] };
}

/**
 * A red `in_front` quad over a coincident blue default quad split along the other diagonal (both single-sided, facing
 * up); `pair: false` keeps only the red quad. With the exact key the red quad wins every sample: the two images must be
 * identical. `doubleSided`: both quads double-sided, so seen from below the tie is between two back sides.
 */
function tiePair(alphaPlane: SceneDocument, pair: boolean, doubleSided = false): SceneDocument {
  const red: [number, number] = [2.5 / 16, 2.5 / 16];
  const blue: [number, number] = [10.5 / 16, 2.5 / 16];
  const front = { ...quad('in-front', -10, true, 'a', red, doubleSided), renderOrder: 1 };
  const under = quad('default', -10, true, 'c', blue, doubleSided);
  return { ...alphaPlane, nodes: [], rootNodes: [], meshes: pair ? [front, under] : [front] };
}
