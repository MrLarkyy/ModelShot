import { loadBbmodel } from '@modelshot/formats';
import { describe, expect, it } from 'vitest';
import alphaPlane from '../../../packages/formats/test/fixtures/bbmodel/alpha-plane.bbmodel?raw';
import meshShapes from '../../../packages/formats/test/fixtures/bbmodel/mesh-shapes.bbmodel?raw';
import precision from '../fixtures/shaders/include/precision.glsl?raw';
import {
  invert,
  lightViewProjection,
  cameraViewProjection,
  multiply,
  projectToPixel,
} from '../fixtures/src/modelViewCamera';
import { parseModelViewVariant } from '../fixtures/src/modelViewVariant';
import { sceneTriangles } from '../fixtures/src/sceneTriangles';
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

  it('rejects a stage without the version line and an include that declares one', () => {
    expect(() => buildShader('void main() {}', [])).toThrow(/must start with/);
    expect(() => buildShader('\n#version 300 es\n', [])).toThrow(/must start with/);
    expect(() => buildShader('#version 300 es\n', ['#version 300 es'])).toThrow(/must not declare/);
  });
});

describe('parseModelViewVariant', () => {
  it('knows the three variants', () => {
    expect(parseModelViewVariant('?variant=alpha-plane-raster')).toEqual({ model: 'alpha-plane', mode: 'raster' });
    expect(parseModelViewVariant('?variant=alpha-plane-raycast')).toEqual({ model: 'alpha-plane', mode: 'raycast' });
    expect(parseModelViewVariant('?variant=mesh-shapes-raster')).toEqual({ model: 'mesh-shapes', mode: 'raster' });
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
});
