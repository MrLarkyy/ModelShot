import { describe, expect, it } from 'vitest';
import {
  attachModel,
  mat4Identity,
  mat4Rotation,
  mat4TransformPoint,
  poseScene,
  worldMatrices,
  type AttachOptions,
  type SceneDocument,
  type ScenePose,
  type Vec3,
} from '../src/index';
import { playerRig, testDoc, testMesh, testNode } from './sceneDocs';

const TEXTURE = {
  mimeType: 'image/png',
  bytes: null,
  width: 0,
  height: 0,
  uvWidth: 16,
  uvHeight: 16,
  missing: true,
} as const;

/** A host rig with one material and texture, so the item's indices must shift. */
function host(): SceneDocument {
  return {
    ...playerRig(),
    materials: [{ name: 'skin', texture: 0 }],
    textures: [{ ...TEXTURE, name: 'skin.png' }],
  };
}

/** A stick: a root mesh, a rotated node with a rotated child, a mesh on each; two materials, one texture. */
function item(): SceneDocument {
  const groups = (material: number) => [{ material, start: 0, count: 3 }];
  return {
    ...testDoc(
      [
        testNode(-1, { name: 'stick', pivot: [1, 2, 0], rotation: [0, 0, 20], children: [1], meshes: [1] }),
        testNode(0, { name: 'tip', pivot: [1, 6, 0], rotation: [10, 0, 0], meshes: [2] }),
      ],
      [
        testMesh(
          -1,
          [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          { name: 'base', indices: new Uint32Array([0, 1, 2]), groups: groups(-1) },
        ),
        testMesh(
          0,
          [
            [1, 1, 1],
            [2, 4, 0],
            [0, 3, -1],
          ],
          { name: 'shaft', indices: new Uint32Array([0, 1, 2]), groups: groups(0) },
        ),
        testMesh(
          1,
          [
            [1, 7, 0],
            [2, 8, 1],
            [0, 8, -2],
          ],
          { name: 'gem', indices: new Uint32Array([0, 1, 2]), groups: groups(1) },
        ),
      ],
    ),
    materials: [
      { name: 'wood', texture: 0 },
      { name: 'gem', texture: -1 },
    ],
    textures: [{ ...TEXTURE, name: 'wood.png' }],
  };
}

function point(mesh: SceneDocument['meshes'][number] | undefined, v: number): Vec3 {
  const p = mesh?.positions ?? new Float32Array(0);
  return [p[v * 3] ?? NaN, p[v * 3 + 1] ?? NaN, p[v * 3 + 2] ?? NaN];
}

function worldPoint(doc: SceneDocument, meshIndex: number, v: number): Vec3 {
  const mesh = doc.meshes[meshIndex];
  const world = mesh && mesh.node >= 0 ? worldMatrices(doc.nodes)[mesh.node] : mat4Identity();
  return mat4TransformPoint(world ?? mat4Identity(), point(mesh, v));
}

function nodeWorld(doc: SceneDocument, name: string) {
  const index = doc.nodes.findIndex((n) => n.name === name);
  const world = worldMatrices(doc.nodes)[index];
  if (!world) throw new Error(`no node ${name}`);
  return world;
}

/** world(bone) · T(anchor) · R · (scale · x + offset), x the item vertex in the item's own world. */
function expected(
  doc: SceneDocument,
  bone: string,
  anchor: Vec3,
  options: Required<Omit<AttachOptions, 'bone' | 'name'>>,
  x: Vec3,
) {
  const local = mat4TransformPoint(mat4Rotation(options.rotation), [
    options.scale * x[0] + options.offset[0],
    options.scale * x[1] + options.offset[1],
    options.scale * x[2] + options.offset[2],
  ]);
  return mat4TransformPoint(nodeWorld(doc, bone), [local[0] + anchor[0], local[1] + anchor[1], local[2] + anchor[2]]);
}

function expectClose(actual: readonly number[], wanted: readonly number[], what: string): void {
  actual.forEach((value, k) => expect(Math.abs(value - (wanted[k] ?? NaN)), `${what}[${k}]`).toBeLessThan(1e-4));
}

const OPTIONS = { offset: [0.5, -3, 1] as Vec3, rotation: [0, 45, 10] as Vec3, scale: 0.5 };
const POSES: (ScenePose | null)[] = [
  null,
  { name: 'hold', bones: [{ bone: 'right_arm', rotation: [40, 0, 0] }] },
  {
    name: 'up',
    bones: [
      { bone: 'right_arm', rotation: [90, 0, 0] },
      { bone: 'body', rotation: [0, 30, 0] },
    ],
  },
  { name: 'twist', bones: [{ bone: 'right_arm', rotation: [-35, 20, 70] }] },
];

describe('attachModel', () => {
  it('appends the attachment node and the item with every index remapped, parents before children', () => {
    const merged = attachModel(host(), item(), { bone: 'right_hand', name: 'stick', ...OPTIONS });
    const bone = 6;
    const attach = 8;
    expect(merged.nodes).toHaveLength(8 + 1 + 2);
    merged.nodes.forEach((node, i) => expect(node.parent).toBeLessThan(i));
    expect(merged.nodes[bone]?.children).toEqual([attach]);
    expect(merged.nodes[attach]).toMatchObject({
      name: 'stick',
      parent: bone,
      children: [9],
      pivot: [6, 12, 0],
      rotation: OPTIONS.rotation,
      restRotation: OPTIONS.rotation,
      meshes: [0],
    });
    expect(merged.nodes[9]).toMatchObject({ name: 'stick', parent: attach, children: [10], meshes: [1] });
    expect(merged.nodes[10]).toMatchObject({ name: 'tip', parent: 9, children: [], meshes: [2] });
    expect(merged.meshes.map((m) => [m.name, m.node, m.groups[0]?.material])).toEqual([
      ['base', attach, -1],
      ['shaft', 9, 1],
      ['gem', 10, 2],
    ]);
    expect(merged.materials.map((m) => [m.name, m.texture])).toEqual([
      ['skin', 0],
      ['wood', 1],
      ['gem', -1],
    ]);
    expect(merged.textures.map((t) => t.name)).toEqual(['skin.png', 'wood.png']);
    expect(merged.rootNodes).toEqual(host().rootNodes);
    expect(merged.attachments).toEqual([{ name: 'stick', bone, node: attach, ...OPTIONS, source: item().source }]);
  });

  it('places every item vertex at world(hand) · T(anchor) · R · (s · x + offset), in every pose', () => {
    const itemDoc = item();
    const attached = attachModel(host(), itemDoc, { bone: 'right_hand', ...OPTIONS });
    for (const pose of POSES) {
      const doc = poseScene(attached, pose).document;
      itemDoc.meshes.forEach((_, m) => {
        for (let v = 0; v < 3; v++) {
          const wanted = expected(doc, 'right_hand', [6, 12, 0], OPTIONS, worldPoint(itemDoc, m, v));
          expectClose(worldPoint(doc, m, v), wanted, `${pose?.name ?? 'rest'} mesh ${m} vertex ${v}`);
        }
      });
    }
  });

  it('moves the item origin exactly as the hand anchor', () => {
    const origin = testDoc([], [testMesh(-1, [[0, 0, 0]])]);
    const attached = attachModel(host(), origin, { bone: 'right_hand' });
    for (const pose of POSES) {
      const doc = poseScene(attached, pose).document;
      const hand = mat4TransformPoint(nodeWorld(doc, 'right_hand'), [6, 12, 0]);
      expectClose(worldPoint(doc, 0, 0), hand, pose?.name ?? 'rest');
    }
  });

  it('stays attached when the posed host is posed again, and keeps the host pose when attaching', () => {
    const posed = poseScene(host(), POSES[1] ?? null).document;
    const attached = attachModel(posed, item(), { bone: 'right_hand', ...OPTIONS });
    expect(attached.pose?.name).toBe('hold');
    const again = poseScene(attached, POSES[2] ?? null).document;
    const wanted = expected(again, 'right_hand', [6, 12, 0], OPTIONS, worldPoint(item(), 2, 1));
    expectClose(worldPoint(again, 2, 1), wanted, 're-posed gem');
    expect(again.nodes[8]?.rotation).toEqual(OPTIONS.rotation);
  });

  it('attaches to a node of an attached model (nested)', () => {
    const first = attachModel(host(), item(), { bone: 'right_hand', ...OPTIONS });
    const inner = { offset: [0, 1, 0] as Vec3, rotation: [0, 0, 90] as Vec3, scale: 2 };
    const tip = first.nodes.findIndex((n) => n.name === 'tip');
    const second = attachModel(first, item(), { bone: tip, name: 'inner', ...inner });
    expect(second.attachments?.map((a) => [a.name, a.bone, a.node])).toEqual([
      ['attachment', 6, 8],
      ['inner', tip, 11],
    ]);
    const doc = poseScene(second, POSES[3] ?? null).document;
    const tipPivot = doc.nodes[tip]?.pivot ?? [0, 0, 0];
    const wanted = expected(doc, 'tip', tipPivot, inner, worldPoint(item(), 1, 2));
    expectClose(worldPoint(doc, 4, 2), wanted, 'nested shaft');
    // Attaching the merged model somewhere else carries its records along, remapped.
    const third = attachModel(host(), first, { bone: 'left_hand' });
    expect(third.attachments?.map((a) => [a.bone, a.node])).toEqual([
      [7, 8],
      [6 + 9, 8 + 9],
    ]);
  });

  it('never mutates its inputs', () => {
    const hostDoc = host();
    const itemDoc = item();
    const before = [structuredClone(hostDoc), structuredClone(itemDoc)];
    attachModel(hostDoc, itemDoc, { bone: 'right_hand', ...OPTIONS });
    expect([hostDoc, itemDoc]).toEqual(before);
  });

  it.each<[string, AttachOptions, string]>([
    ['an unknown bone name', { bone: 'tail' }, 'options.bone'],
    ['a bone index out of range', { bone: 8 }, 'options.bone'],
    ['a fractional bone index', { bone: 1.5 }, 'options.bone'],
    ['scale 0', { bone: 0, scale: 0 }, 'options.scale'],
    ['scale 17', { bone: 0, scale: 17 }, 'options.scale'],
    ['scale NaN', { bone: 0, scale: NaN }, 'options.scale'],
    ['a NaN offset', { bone: 0, offset: [0, NaN, 0] }, 'options.offset[1]'],
    ['a rotation of 361', { bone: 0, rotation: [0, 0, 361] }, 'options.rotation[2]'],
    ['a name of 1025 characters', { bone: 0, name: 'x'.repeat(1025) }, 'options.name'],
  ])('rejects %s with a RangeError naming the path', (_name, options, path) => {
    let caught: unknown;
    try {
      attachModel(host(), item(), options);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as Error).message.startsWith(`${path}`)).toBe(true);
  });

  it('accepts scale 16', () => {
    expect(attachModel(host(), item(), { bone: 0, scale: 16 }).attachments?.[0]?.scale).toBe(16);
  });
});
