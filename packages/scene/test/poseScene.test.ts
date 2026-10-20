import { describe, expect, it } from 'vitest';
import { poseScene, type SceneDocument, type ScenePose } from '../src/index';
import { playerRig, testDoc, testNode } from './sceneDocs';

const A: ScenePose = {
  name: 'a',
  bones: [
    { bone: 'right_arm', rotation: [30, 5, -10], translation: [0, 1, 0] },
    { bone: 'head', rotation: [0, 45, 0] },
  ],
};
const B: ScenePose = {
  name: 'b',
  bones: [
    { bone: 'left_arm', rotation: [-20, 0, 7.25] },
    { bone: 'head', rotation: [10, 0, 0] },
  ],
};

function failure(doc: SceneDocument, pose: unknown): RangeError {
  try {
    poseScene(doc, pose as ScenePose);
  } catch (error) {
    if (error instanceof RangeError) return error;
    throw error;
  }
  throw new Error('expected a RangeError');
}

describe('poseScene', () => {
  it('adds the pose rotation to the rest rotation and sets the pose offset', () => {
    const rest = testDoc([testNode(-1, { name: 'arm', rotation: [10, 0, 0] }), testNode(0, { name: 'tip' })], []);
    const { document, unmatchedBones } = poseScene(rest, {
      name: 'p',
      bones: [{ bone: 'arm', rotation: [5, 20, -30], translation: [1, 2, 3] }],
    });
    expect(unmatchedBones).toEqual([]);
    expect(document.nodes[0]).toMatchObject({
      rotation: [15, 20, -30],
      translation: [1, 2, 3],
      restRotation: [10, 0, 0],
    });
    expect(document.nodes[1]).toMatchObject({ rotation: [0, 0, 0], translation: [0, 0, 0], restRotation: [0, 0, 0] });
    expect(document.pose).toEqual({
      name: 'p',
      bones: [{ bone: 'arm', rotation: [5, 20, -30], translation: [1, 2, 3] }],
    });
  });

  it('applying B after A equals B applied to rest, bit for bit', () => {
    const rest = playerRig();
    const afterA = poseScene(rest, A).document;
    const direct = poseScene(rest, B).document;
    const viaA = poseScene(afterA, B).document;
    expect(viaA).toEqual(direct);
    viaA.nodes.forEach((node, i) => {
      const other = direct.nodes[i];
      node.rotation.forEach((value, k) => expect(Object.is(value, other?.rotation[k])).toBe(true));
    });
  });

  it('restores rest with a null pose and removes the pose record', () => {
    const rest = playerRig();
    const back = poseScene(poseScene(rest, A).document, null).document;
    expect(back.pose).toBeUndefined();
    expect('pose' in back).toBe(false);
    back.nodes.forEach((node, i) => {
      expect(node.rotation).toEqual(rest.nodes[i]?.rotation);
      expect(node.translation).toEqual([0, 0, 0]);
    });
  });

  it('reports bones no node carries and poses the first node of a name', () => {
    const rest = testDoc([testNode(-1, { name: 'twin' }), testNode(-1, { name: 'twin' })], []);
    const { document, unmatchedBones } = poseScene(rest, {
      name: 'p',
      bones: [
        { bone: 'ghost', rotation: [1, 0, 0] },
        { bone: 'twin', rotation: [0, 9, 0] },
      ],
    });
    expect(unmatchedBones).toEqual(['ghost']);
    expect(document.nodes.map((n) => n.rotation)).toEqual([
      [0, 9, 0],
      [0, 0, 0],
    ]);
  });

  it('never mutates its input', () => {
    const rest = playerRig();
    const snapshot = structuredClone(rest);
    const pose = structuredClone(A);
    poseScene(rest, pose);
    expect(rest).toEqual(snapshot);
    expect(pose).toEqual(A);
  });

  it('keeps its own copy of the pose', () => {
    const pose = { name: 'p', bones: [{ bone: 'head', rotation: [1, 2, 3] as [number, number, number] }] };
    const { document } = poseScene(playerRig(), pose);
    pose.bones[0]!.rotation[0] = 99;
    expect(document.pose?.bones[0]?.rotation).toEqual([1, 2, 3]);
  });

  it('a __proto__ bone pollutes nothing', () => {
    const rest = testDoc([testNode(-1, { name: '__proto__' }), testNode(-1, { name: 'constructor' })], []);
    const pose = JSON.parse(
      '{"name":"p","bones":[{"bone":"__proto__","rotation":[1,0,0]},{"bone":"toString","rotation":[2,0,0]}]}',
    ) as ScenePose;
    const { document, unmatchedBones } = poseScene(rest, pose);
    expect(document.nodes[0]?.rotation).toEqual([1, 0, 0]);
    expect(document.nodes[1]?.rotation).toEqual([0, 0, 0]);
    expect(unmatchedBones).toEqual(['toString']);
    expect(({} as Record<string, unknown>)['rotation']).toBeUndefined();
  });

  it.each([
    ['a duplicate bone', { name: 'p', bones: [A.bones[1], A.bones[1]] }, 'pose.bones[1].bone'],
    [
      'a non-finite rotation',
      { name: 'p', bones: [{ bone: 'head', rotation: [0, NaN, 0] }] },
      'pose.bones[0].rotation[1]',
    ],
    [
      'an infinite translation',
      { name: 'p', bones: [{ bone: 'head', rotation: [0, 0, 0], translation: [0, 0, Infinity] }] },
      'pose.bones[0].translation[2]',
    ],
    [
      'a rotation of 361 degrees',
      { name: 'p', bones: [{ bone: 'head', rotation: [361, 0, 0] }] },
      'pose.bones[0].rotation[0]',
    ],
    [
      'a translation over 4096',
      { name: 'p', bones: [{ bone: 'head', rotation: [0, 0, 0], translation: [4097, 0, 0] }] },
      'pose.bones[0].translation[0]',
    ],
    ['a rotation of two numbers', { name: 'p', bones: [{ bone: 'head', rotation: [0, 0] }] }, 'pose.bones[0].rotation'],
    [
      'a bone name of 1025 characters',
      { name: 'p', bones: [{ bone: 'x'.repeat(1025), rotation: [0, 0, 0] }] },
      'pose.bones[0].bone',
    ],
    ['a pose name that is no string', { name: 7, bones: [] }, 'pose.name'],
    [
      '1025 bones',
      { name: 'p', bones: Array.from({ length: 1025 }, (_, i) => ({ bone: `b${i}`, rotation: [0, 0, 0] })) },
      'pose.bones',
    ],
    ['a bone that is null', { name: 'p', bones: [null] }, 'pose.bones[0]'],
    // Sparse arrays: forEach and map skip holes, so these once passed as NaN rotations or a TypeError.
    // eslint-disable-next-line no-sparse-arrays
    ['a hole in a rotation', { name: 'p', bones: [{ bone: 'head', rotation: [0, , 0] }] }, 'pose.bones[0].rotation[1]'],
    ['bones that are holes', { name: 'p', bones: new Array(2) }, 'pose.bones[0]'],
  ])('rejects %s with a RangeError naming the path', (_name, pose, path) => {
    expect(failure(playerRig(), pose).message.startsWith(`${path}:`)).toBe(true);
  });

  it('accepts 1024 bones and |rotation| 360', () => {
    const bones = Array.from({ length: 1024 }, (_, i) => ({ bone: `b${i}`, rotation: [360, -360, 0] as const }));
    expect(poseScene(playerRig(), { name: 'p', bones }).unmatchedBones).toHaveLength(1024);
  });
});
