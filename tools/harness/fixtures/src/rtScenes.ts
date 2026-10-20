import { loadBbmodel } from '@modelshot/formats';
import { OrbitController } from '@modelshot/renderer-rt';
import { sceneBounds, type SceneCamera, type SceneDocument } from '@modelshot/scene';
import flatSource from '../models/rt-flat.bbmodel?raw';
import showcaseSource from '../models/rt-showcase.bbmodel?raw';
import { benchScene } from './benchScene';

/**
 * Named scenes and camera presets of the realtime fixture. The path-tracer fixture renders the same scenes and
 * cameras (`rtCamera`) so its goldens pair with these.
 */
export const RT_SCENE_NAMES = [
  'showcase',
  'flat',
  'bench',
  'hostile-corrupt',
  'hostile-corrupt-data',
  'hostile-missing',
  'hostile-mismatch',
  'hostile-huge-header',
  'empty',
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
}

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
};

function load(source: string): SceneDocument {
  return loadBbmodel(source).scene;
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
  }
}

/** The camera of a view for a viewport of `aspect`, through the orbit controller the app uses. */
export function rtCamera(doc: SceneDocument, view: RtView, aspect: number): SceneCamera {
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
  return view;
}
