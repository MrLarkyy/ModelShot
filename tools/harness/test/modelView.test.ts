import { loadBbmodel } from '@modelshot/formats';
import { describe, expect, it } from 'vitest';
import alphaPlane from '../../../packages/formats/test/fixtures/bbmodel/alpha-plane.bbmodel?raw';
import meshShapes from '../../../packages/formats/test/fixtures/bbmodel/mesh-shapes.bbmodel?raw';
import precision from '../fixtures/shaders/include/precision.glsl?raw';
import {
  MODEL_VIEW_LOOK,
  invert,
  lightViewProjection,
  viewAxis,
  cameraViewProjection,
  multiply,
  projectToPixel,
} from '../fixtures/src/modelViewCamera';
import { parseModelViewVariant } from '../fixtures/src/modelViewVariant';
import { sceneTriangles } from '../fixtures/src/sceneTriangles';
import { BACK_SIDE_RENDER_ORDER, RENDER_ORDER_TIE_DISTANCE, type SceneDocument } from '@modelshot/scene';
import texelAlpha from '../fixtures/shaders/include/texelAlpha.glsl?raw';
import raycast from '../fixtures/shaders/raycast.frag.glsl?raw';
import cameraRay from '../fixtures/shaders/include/cameraRay.glsl?raw';
import modelFragment from '../fixtures/shaders/model.frag.glsl?raw';
import { MODEL_SHADER_DEFINES } from '../fixtures/src/modelShaderDefines';
import { checkTableLimits, drawnMaterials, MAX_MATERIALS, MODE_CODES } from '../fixtures/src/sceneUpload';
import { modelViewScene } from '../fixtures/src/modelViewScenes';
import { buildShader } from '../fixtures/src/shaderSource';

describe('buildShader', () => {
  it('puts the version line first, then the includes in order, then the stage body', () => {
    const shader = buildShader('#version 300 es\nvoid main() {}\n', ['// a', '// b']);
    expect(shader.split('\n')).toEqual(['#version 300 es', '// a', '// b', 'void main() {}', '']);
  });

  it('joins the real precision include before the body', () => {
    const shader = buildShader('#version 300 es\nout vec4 c;', [precision]);
    expect(shader.startsWith('#version 300 es\nprecision highp float;')).toBe(true);
  });

  it('puts #defines right after the version line, ints as ints and floats with a decimal point', () => {
    const shader = buildShader('#version 300 es\nvoid main() {}', ['// a'], {
      COUNT: { int: 8 },
      ONE: { float: 1 },
      TIE: { float: 1e-3 },
    });
    expect(shader.split('\n').slice(0, 5)).toEqual([
      '#version 300 es',
      '#define COUNT 8',
      '#define ONE 1.0',
      '#define TIE 0.001',
      '// a',
    ]);
  });

  it('rejects a bad define name or value', () => {
    expect(() => buildShader('#version 300 es\n', [], { lower: { int: 1 } })).toThrow(/must match/);
    expect(() => buildShader('#version 300 es\n', [], { X: { int: 1.5 } })).toThrow(/integer/);
    expect(() => buildShader('#version 300 es\n', [], { X: { float: NaN } })).toThrow(/finite/);
  });

  it('the model shaders take their shared constants only from the defines', () => {
    expect(MODEL_SHADER_DEFINES).toEqual({
      MAX_MATERIALS: { int: MAX_MATERIALS },
      MODE_OPAQUE: { int: MODE_CODES.opaque },
      MODE_MASK: { int: MODE_CODES.mask },
      MODE_BLEND: { int: MODE_CODES.blend },
      RENDER_ORDER_TIE: { float: RENDER_ORDER_TIE_DISTANCE },
      BACK_SIDE_RENDER_ORDER: { float: BACK_SIDE_RENDER_ORDER },
      SHADOW_NORMAL_OFFSET: { float: MODEL_VIEW_LOOK.shadowNormalOffset },
      DEPTH_RANGE: { float: MODEL_VIEW_LOOK.far + 1 },
    });
    for (const source of [texelAlpha, raycast, modelFragment, cameraRay]) {
      for (const name of Object.keys(MODEL_SHADER_DEFINES)) {
        expect(source, name).not.toMatch(new RegExp(`(const\\s+\\w+\\s+${name}\\b|#define\\s+${name}\\b)`));
      }
    }
    expect(texelAlpha).toMatch(/MAX_MATERIALS/);
    expect(cameraRay).toMatch(/RENDER_ORDER_TIE/);
    expect(modelFragment).toMatch(/SHADOW_NORMAL_OFFSET/);
    expect(raycast).toMatch(/SHADOW_NORMAL_OFFSET/);
  });

  it('rejects a stage without the version line and an include that declares one', () => {
    expect(() => buildShader('void main() {}', [])).toThrow(/must start with/);
    expect(() => buildShader('\n#version 300 es\n', [])).toThrow(/must start with/);
    expect(() => buildShader('#version 300 es\n', ['#version 300 es'])).toThrow(/must not declare/);
  });
});

describe('parseModelViewVariant', () => {
  it('knows the eight variants', () => {
    expect(parseModelViewVariant('?variant=alpha-plane-raster')).toEqual({ model: 'alpha-plane', mode: 'raster' });
    expect(parseModelViewVariant('?variant=alpha-plane-raycast')).toEqual({ model: 'alpha-plane', mode: 'raycast' });
    expect(parseModelViewVariant('?variant=mesh-shapes-raster')).toEqual({ model: 'mesh-shapes', mode: 'raster' });
    expect(parseModelViewVariant('?variant=mesh-shapes-raycast')).toEqual({ model: 'mesh-shapes', mode: 'raycast' });
    expect(parseModelViewVariant('?variant=render-order-raster')).toEqual({ model: 'render-order', mode: 'raster' });
    expect(parseModelViewVariant('?variant=render-order-raycast')).toEqual({ model: 'render-order', mode: 'raycast' });
    expect(parseModelViewVariant('?variant=gltf-nodes-raster')).toEqual({ model: 'gltf-nodes', mode: 'raster' });
    expect(parseModelViewVariant('?variant=gltf-nodes-raycast')).toEqual({ model: 'gltf-nodes', mode: 'raycast' });
  });

  it.each(['?variant=constructor', '?variant=__proto__', '?variant=toString', '?variant=', '', '?model=alpha-plane'])(
    'rejects %j',
    (search) => {
      expect(() => parseModelViewVariant(search)).toThrow(/unknown variant/);
    },
  );
});

describe('model-view camera', () => {
  it('inverts its view-projections', () => {
    for (const m of [cameraViewProjection(1), lightViewProjection()]) {
      const product = multiply(m, invert(m));
      product.forEach((value, i) => expect(value).toBeCloseTo(i % 5 === 0 ? 1 : 0, 4));
    }
  });

  it('DEPTH_RANGE holds the largest key: view depth at the far frustum corners plus one order step', () => {
    const inverse = invert(cameraViewProjection(1));
    const axis = viewAxis();
    let largest = 0;
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const p = [0, 1, 2, 3].map(
        (r) => (inverse[r] ?? 0) * x + (inverse[4 + r] ?? 0) * y + (inverse[8 + r] ?? 0) + (inverse[12 + r] ?? 0),
      );
      const w = p[3] ?? 1;
      const d = [0, 1, 2].map((k) => (p[k] ?? 0) / w - (MODEL_VIEW_LOOK.eye[k] ?? 0));
      largest = Math.max(largest, d[0]! * axis[0] + d[1]! * axis[1] + d[2]! * axis[2]);
    }
    const range = (MODEL_SHADER_DEFINES['DEPTH_RANGE'] as { float: number }).float;
    expect(largest + RENDER_ORDER_TIE_DISTANCE).toBeLessThanOrEqual(range);
  });

  it('projects the target to the image centre, y down', () => {
    const [x = NaN, y = NaN] = projectToPixel(cameraViewProjection(1), [0, 4, 0], 256, 256) ?? [];
    expect(Math.abs(x - 128) <= 1 && Math.abs(y - 128) <= 1).toBe(true);
    const [, above = NaN] = projectToPixel(cameraViewProjection(1), [0, 10, 0], 256, 256) ?? [];
    expect(above).toBeLessThan(128);
  });
});

describe('sceneTriangles', () => {
  it('alpha-plane: every visible triangle in world space, single-sided runs first', () => {
    const triangles = sceneTriangles(loadBbmodel(alphaPlane).scene);
    // ground 12, cutout plane 2, back plane 2, flat-cube plane 4.
    expect(triangles.count).toBe(20);
    expect(triangles.runs.map((r) => [r.renderOrder, r.doubleSided, r.count])).toEqual([
      [0, false, 4],
      [0, true, 16],
    ]);
    // Slot 0 is untextured (the ground), slot 1 the cutout texture.
    expect(new Set(triangles.materials)).toEqual(new Set([0, 1]));
  });

  it('camera-only groups form their own runs and are flagged per triangle', () => {
    const { scene } = loadBbmodel(alphaPlane);
    const mesh = scene.meshes[0];
    if (!mesh) throw new Error('no mesh');
    const groups = mesh.groups.map((g, i) => (i === 0 ? { ...g, cameraOnly: true } : g));
    const marked = { ...scene, meshes: [{ ...mesh, groups }, ...scene.meshes.slice(1)] };
    const triangles = sceneTriangles(marked);
    expect(triangles.cameraOnly.reduce((a, b) => a + b, 0)).toBe((mesh.groups[0]?.count ?? 0) / 3);
    expect(triangles.runs.some((r) => r.cameraOnly)).toBe(true);
    expect(triangles.runs.every((r) => r.cameraOnly === (triangles.cameraOnly[r.first] === 1))).toBe(true);
  });

  it('a hidden parent hides the meshes of its child nodes', () => {
    const { scene } = loadBbmodel(meshShapes);
    const tilt = scene.nodes.findIndex((n) => n.name === 'tilt');
    const hidden: SceneDocument = {
      ...scene,
      nodes: scene.nodes.map((n, i) => (i === tilt ? { ...n, visible: false } : n)),
    };
    const turned = scene.meshes.findIndex((m) => m.name === 'turned');
    expect([...sceneTriangles(scene).meshes]).toContain(turned);
    expect([...sceneTriangles(hidden).meshes]).not.toContain(turned);
  });

  it('mesh-shapes: the turned mesh is placed by its group', () => {
    const { scene } = loadBbmodel(meshShapes);
    const triangles = sceneTriangles(scene);
    const turned = scene.meshes.findIndex((m) => m.name === 'turned');
    const ys: number[] = [];
    triangles.meshes.forEach((mesh, t) => {
      if (mesh === turned) for (let c = 0; c < 3; c++) ys.push(triangles.positions[t * 9 + c * 3 + 1] ?? NaN);
    });
    // e = (0, 19, −6) before the group's −20° about X: 19 cos 20°.
    expect(Math.max(...ys)).toBeCloseTo(19 * Math.cos(Math.PI / 9), 4);
  });

  it('maps normals of a non-uniformly scaled node with the inverse transpose', () => {
    const { scene } = loadBbmodel(meshShapes);
    const turned = scene.meshes.findIndex((m) => m.name === 'turned');
    const node = scene.meshes[turned]?.node ?? -1;
    expect(node).toBeGreaterThanOrEqual(0);
    const sloped = Math.SQRT1_2;
    const scaled: SceneDocument = {
      ...scene,
      // No rotation anywhere, so the node's scale is the whole linear part.
      nodes: scene.nodes.map((n, i) => ({ ...n, rotation: [0, 0, 0], ...(i === node ? { scale: [2, 1, 1] } : {}) })),
      meshes: scene.meshes.map((m, i) =>
        i === turned
          ? { ...m, normals: new Float32Array(m.normals.length).map((_, k) => [sloped, sloped, 0][k % 3] ?? 0) }
          : m,
      ),
    };
    const triangles = sceneTriangles(scaled);
    const t = [...triangles.meshes].indexOf(turned);
    const normal = [0, 1, 2].map((k) => triangles.normals[t * 9 + k] ?? NaN);
    const length = Math.hypot(...normal);
    // A plane with normal (1, 1, 0) stretched 2× along x tilts towards y: (1/2, 1, 0) normalised, not (2, 1, 0).
    const expected = [0.5, 1, 0].map((x) => x / Math.hypot(0.5, 1));
    normal.forEach((x, k) => expect(x / length).toBeCloseTo(expected[k] ?? NaN, 6));
  });
});

describe('gltf-nodes model', () => {
  const scene = modelViewScene('gltf-nodes');

  it('fits the tables, hides only the 50 % glass plane, and draws no partial-alpha material', () => {
    expect(() => checkTableLimits(scene)).not.toThrow();
    expect(scene.meshes.filter((m) => !m.visible).map((m) => m.name)).toEqual(['glass-plane']);
    const glass = scene.materials.findIndex((m) => m.name === 'glass');
    expect(drawnMaterials(scene).has(glass)).toBe(false);
    expect([...drawnMaterials(scene)].sort()).toEqual([0, 1, 3, 4, 5, 6]);
  });

  it('every visible triangle in world space, at half the default unit scale', () => {
    const triangles = sceneTriangles(scene);
    // ground 2, cube 12 twice, leaf 2, roof 4, cutout plane 2, panel 2.
    expect(triangles.count).toBe(2 + 24 + 2 + 4 + 2 + 2);
    expect(triangles.runs.map((r) => [r.doubleSided, r.count])).toEqual([
      [false, 34],
      [true, 2],
    ]);
    const ground = scene.meshes.find((m) => m.name === 'ground');
    expect(Math.max(...(ground?.positions ?? []))).toBeCloseTo(1.3 * 8, 4);
  });
});

describe('checkTableLimits', () => {
  const named = (count: number) => Array.from({ length: count }, (_, i) => ({ name: String(i) }));
  it('allows MAX_MATERIALS − 1 materials and MAX_MATERIALS textures', () => {
    const materials = named(MAX_MATERIALS - 1).map((m, i) => ({ ...m, texture: i }));
    const textures = named(MAX_MATERIALS) as never[];
    expect(() => checkTableLimits({ materials, textures })).not.toThrow();
  });

  it('rejects one material or one texture more, with a clear message', () => {
    const materials = named(MAX_MATERIALS).map((m, i) => ({ ...m, texture: i }));
    expect(() => checkTableLimits({ materials, textures: [] })).toThrow(/supports 7 materials, the model has 8/);
    const textures = named(MAX_MATERIALS + 1) as never[];
    expect(() => checkTableLimits({ materials: [], textures })).toThrow(/supports 8 textures, the model has 9/);
  });
});
