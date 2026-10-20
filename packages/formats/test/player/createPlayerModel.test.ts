import {
  mat4Identity,
  mat4TransformDirection,
  mat4TransformPoint,
  PLAYER_BONES,
  worldMatrices,
  type SceneDocument,
} from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { createPlayerModel, loadSkin, type PlayerArms } from '../../src/index';
import { serializeResult } from '../bbmodel/serializeScene';
import { skinBytes, type SkinFixture } from './skins';

function player(skin: SkinFixture, arms: PlayerArms, showOuterLayer?: boolean): SceneDocument {
  const options = showOuterLayer === undefined ? { arms } : { arms, showOuterLayer };
  return createPlayerModel(loadSkin(skinBytes(skin)), options);
}

function mesh(doc: SceneDocument, name: string) {
  const found = doc.meshes.find((m) => m.name === name);
  if (!found) throw new Error(`no mesh ${name}`);
  return found;
}

/** Face rectangles of a mesh in skin pixels `[u0, v0, u1, v1]`, one per face (four vertices each). */
function faceRects(doc: SceneDocument, name: string): number[][] {
  const m = mesh(doc, name);
  const texture = doc.textures[0];
  const width = texture?.uvWidth ?? 64;
  const height = texture?.uvHeight ?? 64;
  const rects: number[][] = [];
  for (let v = 0; v < m.uvRects.length / 4; v += 4) {
    const r = Array.from(m.uvRects.subarray(v * 4, v * 4 + 4));
    rects.push([(r[0] ?? 0) * width, (r[1] ?? 0) * height, (r[2] ?? 0) * width, (r[3] ?? 0) * height]);
  }
  return rects.map((r) => r.map((x) => Math.round(x * 1e4) / 1e4));
}

/** UV (skin pixels) of the corner of a face whose normal is `normal`, at the vertex nearest `corner`. */
function cornerUv(doc: SceneDocument, name: string, normal: readonly number[], corner: readonly number[]): number[] {
  const m = mesh(doc, name);
  const height = doc.textures[0]?.uvHeight ?? 64;
  let best: { distance: number; uv: number[] } | undefined;
  for (let v = 0; v < m.positions.length / 3; v++) {
    const n = Array.from(m.normals.subarray(v * 3, v * 3 + 3));
    if (n.some((x, k) => Math.abs(x - (normal[k] ?? 0)) > 1e-6)) continue;
    const p = Array.from(m.positions.subarray(v * 3, v * 3 + 3));
    const distance = Math.hypot(...p.map((x, k) => x - (corner[k] ?? 0)));
    if (!best || distance < best.distance) {
      best = { distance, uv: [(m.uvs[v * 2] ?? 0) * 64, (m.uvs[v * 2 + 1] ?? 0) * height] };
    }
  }
  if (!best) throw new Error(`no face with normal ${normal.join(',')}`);
  return best.uv.map((x) => Math.round(x * 1e4) / 1e4);
}

/** Skin region of each part (2·(x + z) wide, z + y high from its offset). */
const REGIONS: Record<string, number[]> = {
  head: [0, 0, 32, 16],
  hat: [32, 0, 64, 16],
  body: [16, 16, 40, 32],
  jacket: [16, 32, 40, 48],
  right_arm: [40, 16, 56, 32],
  right_sleeve: [40, 32, 56, 48],
  left_arm: [32, 48, 48, 64],
  left_sleeve: [48, 48, 64, 64],
  right_leg: [0, 16, 16, 32],
  right_pants: [0, 32, 16, 48],
  left_leg: [16, 48, 32, 64],
  left_pants: [0, 48, 16, 64],
};

describe('createPlayerModel', () => {
  it.each([
    ['player-classic', 'classic', 'classic'],
    ['player-slim', 'slim', 'slim'],
    ['player-legacy', 'legacy', 'classic'],
  ] as const)('%s matches its data golden', async (golden, skin, arms) => {
    const scene = player(skin, arms);
    await expect(serializeResult({ scene, warnings: [] })).toMatchFileSnapshot(`__goldens__/${golden}.json`);
  });

  it('maps the head front (north, −Z) to skin texels 8..16 x 8..16, the player facing −Z', () => {
    const doc = player('classic', 'classic');
    expect(faceRects(doc, 'head')).toContainEqual([8, 8, 16, 16]);
    // Seen from the front the player's right side (+X) is on the viewer's left: u 8 there, u 16 at −X.
    expect(cornerUv(doc, 'head', [0, 0, -1], [4, 32, -4])).toEqual([8, 8]);
    expect(cornerUv(doc, 'head', [0, 0, -1], [-4, 24, -4])).toEqual([16, 16]);
    // The player's right side of the head (east, +X) is texels 0..8 x 8..16.
    expect(cornerUv(doc, 'head', [1, 0, 0], [4, 32, 4])).toEqual([0, 8]);
  });

  it('builds slim arms 3 wide, half a pixel lower, with the pivot at y 21.5', () => {
    const doc = player('slim', 'slim');
    const arm = mesh(doc, 'right_arm');
    const xs = Array.from(arm.positions.filter((_, i) => i % 3 === 0));
    const ys = Array.from(arm.positions.filter((_, i) => i % 3 === 1));
    expect(Math.max(...xs) - Math.min(...xs)).toBe(3);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([11.5, 23.5]);
    expect(doc.nodes.find((n) => n.name === 'right_arm')?.pivot).toEqual([5, 21.5, 0]);
    expect(doc.nodes.find((n) => n.name === 'left_arm')?.pivot).toEqual([-5, 21.5, 0]);
    expect(faceRects(doc, 'right_arm')).toContainEqual([44, 20, 47, 32]);
    expect(doc.source).toEqual({ format: 'player', formatVersion: '64x64', modelFormat: 'slim' });
  });

  it('draws the legacy left arm and leg from the right ones, mirrored, with only a hat as outer layer', () => {
    const doc = player('legacy', 'classic');
    expect(doc.textures[0]?.uvHeight).toBe(32);
    expect(doc.source.formatVersion).toBe('64x32');
    expect(doc.meshes.map((m) => m.name)).toEqual([
      'head',
      'hat',
      'body',
      'right_arm',
      'left_arm',
      'right_leg',
      'left_leg',
    ]);
    for (const [left, right] of [
      ['left_arm', 'right_arm'],
      ['left_leg', 'right_leg'],
    ] as const) {
      expect(new Set(faceRects(doc, left).map(String))).toEqual(new Set(faceRects(doc, right).map(String)));
      // Mirrored: the left limb's outer side (west, −X) shows the right limb's outer side (east) texels, flipped.
      const rightEast = faceRects(doc, right)[1];
      const leftWest = faceRects(doc, left)[3];
      expect(leftWest).toEqual(rightEast);
    }
    const rightTopFront = cornerUv(doc, 'right_arm', [0, 0, -1], [8, 24, -2]);
    const leftTopFront = cornerUv(doc, 'left_arm', [0, 0, -1], [-8, 24, -2]);
    expect(rightTopFront).toEqual([44, 20]);
    expect(leftTopFront).toEqual([44, 20]);
  });

  it('keeps the base layer opaque and makes the outer layer a double-sided 0.1 cutout blend', () => {
    const doc = player('classic', 'classic');
    expect(doc.materials).toEqual([
      { name: 'skin', texture: 0, alphaMode: 'opaque' },
      { name: 'skin outer layer', texture: 0, alphaMode: 'blend', alphaCutoff: 0.1 },
    ]);
    for (const m of doc.meshes) {
      const outer = !(m.name in { head: 1, body: 1, right_arm: 1, left_arm: 1, right_leg: 1, left_leg: 1 });
      expect(m.groups, m.name).toEqual([{ material: outer ? 1 : 0, start: 0, count: 36, doubleSided: outer }]);
    }
  });

  it('separates overlapping coplanar faces by render order, never by draw order', () => {
    const doc = player('classic', 'classic');
    const orders = Object.fromEntries(doc.meshes.map((m) => [m.name, m.renderOrder]));
    expect(orders).toEqual({
      head: 0,
      hat: 0,
      body: 0,
      jacket: 0,
      right_arm: 0,
      right_sleeve: 1,
      left_arm: 0,
      left_sleeve: 1,
      right_leg: 0,
      right_pants: 2,
      left_leg: 1,
      left_pants: 3,
    });
  });

  it.each([
    ['classic', 'classic'],
    ['slim', 'slim'],
    ['legacy', 'classic'],
  ] as const)(
    '%s: every pair of coplanar same-facing faces of two meshes that overlap differs in render order',
    (skin, arms) => {
      const doc = player(skin, arms);
      const world = worldMatrices(doc.nodes);
      // Axis-aligned world-space quads (four vertices per face, as cubeToMesh writes them): normal, bounds.
      const faces = doc.meshes.flatMap((mesh, m) => {
        const w = world[mesh.node] ?? mat4Identity();
        return Array.from({ length: mesh.positions.length / 12 }, (_, f) => {
          const at = (array: Float32Array, v: number) =>
            [0, 1, 2].map((k) => array[v * 3 + k] ?? NaN) as [number, number, number];
          const corners = [0, 1, 2, 3].map((c) => mat4TransformPoint(w, at(mesh.positions, f * 4 + c)));
          const normal = mat4TransformDirection(w, at(mesh.normals, f * 4));
          const axis = normal.findIndex((n) => Math.abs(Math.abs(n) - 1) < 1e-6);
          const min = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k] ?? NaN)));
          const max = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k] ?? NaN)));
          return { m, normal, axis, min, max };
        });
      });
      let ties = 0;
      for (const a of faces) {
        expect(a.axis, doc.meshes[a.m]?.name).toBeGreaterThanOrEqual(0);
        for (const b of faces) {
          if (b.m <= a.m || a.normal.some((n, k) => Math.abs(n - (b.normal[k] ?? NaN)) > 1e-6)) continue;
          if (Math.abs((a.min[a.axis] ?? 0) - (b.min[a.axis] ?? 0)) > 1e-6) continue;
          const inPlane = [0, 1, 2].filter((k) => k !== a.axis);
          const overlap = inPlane.every(
            (k) => Math.min(a.max[k] ?? 0, b.max[k] ?? 0) - Math.max(a.min[k] ?? 0, b.min[k] ?? 0) > 1e-6,
          );
          if (!overlap) continue;
          ties++;
          const [ma, mb] = [doc.meshes[a.m], doc.meshes[b.m]];
          expect(ma?.renderOrder, `${ma?.name} and ${mb?.name} overlap in the plane ${a.min[a.axis]}`).not.toBe(
            mb?.renderOrder,
          );
        }
      }
      // Without render orders these models would have coincident overlapping faces (the legs at least).
      expect(ties).toBeGreaterThan(0);
    },
  );

  it('hides only the outer layer when showOuterLayer is false', () => {
    const doc = player('classic', 'classic', false);
    expect(doc.meshes.filter((m) => !m.visible).map((m) => m.name)).toEqual([
      'hat',
      'jacket',
      'right_sleeve',
      'left_sleeve',
      'right_pants',
      'left_pants',
    ]);
    expect(player('classic', 'classic').meshes.every((m) => m.visible)).toBe(true);
  });

  it.each(['classic', 'slim'] as const)(
    'puts the %s hand anchors at the end of each arm, children of the arms',
    (arms) => {
      const doc = player('classic', arms);
      const index = (name: string) => doc.nodes.findIndex((n) => n.name === name);
      const x = arms === 'slim' ? 5.5 : 6;
      const y = arms === 'slim' ? 11.5 : 12;
      expect(doc.nodes[index('right_hand')]).toMatchObject({
        parent: index('right_arm'),
        pivot: [x, y, 0],
        meshes: [],
      });
      expect(doc.nodes[index('left_hand')]).toMatchObject({ parent: index('left_arm'), pivot: [-x, y, 0], meshes: [] });
      expect(doc.nodes[index('right_arm')]?.children).toEqual([index('right_hand')]);
      // The anchor is the centre of the arm's bottom face.
      const arm = mesh(doc, 'right_arm');
      const ys = Array.from(arm.positions.filter((_, i) => i % 3 === 1));
      expect(Math.min(...ys)).toBe(y);
      const world = worldMatrices(doc.nodes)[index('right_hand')];
      expect(world && mat4TransformPoint(world, [x, y, 0])).toEqual([x, y, 0]);
    },
  );

  it('names every node after PLAYER_BONES, parents first', () => {
    for (const [skin, arms] of [
      ['classic', 'classic'],
      ['slim', 'slim'],
      ['legacy', 'classic'],
    ] as const) {
      const doc = player(skin, arms);
      expect(doc.nodes.map((n) => n.name)).toEqual([...PLAYER_BONES]);
      doc.nodes.forEach((node, i) => expect(node.parent).toBeLessThan(i));
      expect(doc.rootNodes).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it('keeps every face rectangle inside its part’s skin region', () => {
    for (const [skin, arms] of [
      ['classic', 'classic'],
      ['slim', 'slim'],
      ['legacy', 'classic'],
    ] as const) {
      const doc = player(skin, arms);
      const legacy = skin === 'legacy';
      for (const m of doc.meshes) {
        const source =
          legacy && m.name === 'left_arm' ? 'right_arm' : legacy && m.name === 'left_leg' ? 'right_leg' : m.name;
        const [u0 = 0, v0 = 0, u1 = 0, v1 = 0] = REGIONS[source] ?? [];
        for (const rect of faceRects(doc, m.name)) {
          const [a = -1, b = -1, c = -1, d = -1] = rect;
          expect(a >= u0 && b >= v0 && c <= u1 && d <= v1, `${skin} ${m.name} ${rect.join(',')}`).toBe(true);
        }
      }
    }
  });

  it('rejects unknown arms', () => {
    const skin = loadSkin(skinBytes('classic'));
    expect(() => createPlayerModel(skin, { arms: 'wide' as PlayerArms })).toThrow(RangeError);
  });
});
