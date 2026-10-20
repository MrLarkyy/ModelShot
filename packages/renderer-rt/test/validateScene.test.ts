import { attachModel, poseScene, type SceneDocument, type SceneMesh } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { RendererError, validateScene } from '../src/index';
import { quadScene } from './testScene';

function withMesh(change: (mesh: SceneMesh) => Partial<SceneMesh>): SceneDocument {
  const doc = quadScene();
  const mesh = doc.meshes[0]!;
  return { ...doc, meshes: [{ ...mesh, ...change(mesh) }] };
}

function expectInvalid(doc: SceneDocument, path: string): void {
  let caught: unknown;
  try {
    validateScene(doc);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RendererError);
  expect(caught).toMatchObject({ code: 'INVALID_SCENE', path });
  expect((caught as Error).message).toContain(path);
}

describe('validateScene', () => {
  it('accepts a well-formed document', () => {
    expect(() => validateScene(quadScene())).not.toThrow();
  });

  it('rejects an index past the vertex count', () => {
    expectInvalid(
      withMesh(() => ({ indices: new Uint32Array([0, 1, 2, 0, 2, 4]) })),
      'meshes[0].indices[5]',
    );
  });

  it('rejects short per-vertex arrays', () => {
    expectInvalid(
      withMesh(() => ({ uvRects: new Float32Array(12) })),
      'meshes[0].uvRects',
    );
    expectInvalid(
      withMesh(() => ({ uvs: new Float32Array(6) })),
      'meshes[0].uvs',
    );
    expectInvalid(
      withMesh(() => ({ normals: new Float32Array(13) })),
      'meshes[0].normals',
    );
    expectInvalid(
      withMesh(() => ({ positions: new Float32Array(10) })),
      'meshes[0].positions',
    );
  });

  it('rejects plain arrays where typed arrays are expected', () => {
    expectInvalid(
      withMesh((m) => ({ uvs: [...m.uvs] as unknown as Float32Array })),
      'meshes[0].uvs',
    );
    expectInvalid(
      withMesh((m) => ({ indices: [...m.indices] as unknown as Uint32Array })),
      'meshes[0].indices',
    );
  });

  it('rejects a material out of range', () => {
    expectInvalid(
      withMesh(() => ({ groups: [{ material: 99, start: 0, count: 6 }] })),
      'meshes[0].groups[0].material',
    );
  });

  it('rejects a texture index below -1', () => {
    const doc = quadScene();
    expectInvalid({ ...doc, materials: [{ name: 'm', texture: -2 }] }, 'materials[0].texture');
  });

  it('rejects a group past the end or not on whole triangles', () => {
    expectInvalid(
      withMesh(() => ({ groups: [{ material: 0, start: 3, count: 6 }] })),
      'meshes[0].groups[0]',
    );
    expectInvalid(
      withMesh(() => ({ groups: [{ material: 0, start: 0, count: 4 }] })),
      'meshes[0].groups[0]',
    );
  });

  it('rejects broken node references', () => {
    const doc = quadScene();
    const node = doc.nodes[0]!;
    expectInvalid({ ...doc, nodes: [{ ...node, parent: 0 }] }, 'nodes[0].parent');
    expectInvalid({ ...doc, nodes: [{ ...node, meshes: [3] }] }, 'nodes[0].meshes[0]');
    expectInvalid({ ...doc, rootNodes: [7] }, 'rootNodes[0]');
    expectInvalid(
      withMesh(() => ({ node: 5 })),
      'meshes[0].node',
    );
  });

  it.each<[string, number]>([
    ['a fraction', 0.5],
    ['beyond 1024', 2000],
    ['beyond -1024', -1025],
    ['NaN', NaN],
  ])('rejects a renderOrder that is %s', (_name, renderOrder) => {
    expectInvalid(
      withMesh(() => ({ renderOrder })),
      'meshes[0].renderOrder',
    );
  });

  it('accepts renderOrder ±1024 and absent', () => {
    expect(() => validateScene(withMesh(() => ({ renderOrder: 1024 })))).not.toThrow();
    expect(() => validateScene(withMesh(() => ({ renderOrder: -1024 })))).not.toThrow();
  });

  it('rejects a doubleSided that is not a boolean', () => {
    const groups = [{ material: 0, start: 0, count: 6, doubleSided: 'yes' as unknown as boolean }];
    expectInvalid(
      withMesh(() => ({ groups })),
      'meshes[0].groups[0].doubleSided',
    );
  });
  it.each([
    ['rotation', 1, NaN],
    ['pivot', 0, Infinity],
    ['translation', 2, -Infinity],
    ['restRotation', 1, NaN],
  ] as const)('rejects a non-finite node %s', (key, k, value) => {
    const doc = quadScene();
    const node = doc.nodes[0]!;
    const triple: [number, number, number] = [0, 0, 0];
    triple[k] = value;
    expectInvalid({ ...doc, nodes: [{ ...node, [key]: triple }] }, `nodes[0].${key}[${k}]`);
  });

  it('rejects a node rotation with a hole', () => {
    const doc = quadScene();
    // eslint-disable-next-line no-sparse-arrays
    const rotation = [0, , 0] as unknown as [number, number, number];
    expectInvalid({ ...doc, nodes: [{ ...doc.nodes[0]!, rotation }] }, 'nodes[0].rotation[1]');
  });

  it('accepts a posed document with models attached, nested', () => {
    const once = attachModel(quadScene(), quadScene(), { bone: 'root', offset: [1, 0, 0], scale: 0.5 });
    const twice = attachModel(once, once, { bone: once.nodes.length - 1, rotation: [0, 90, 0] });
    const posed = poseScene(twice, { name: 'p', bones: [{ bone: 'root', rotation: [10, 20, 30] }] }).document;
    expect(() => validateScene(posed)).not.toThrow();
    expect(posed.meshes).toHaveLength(4);
  });
});
