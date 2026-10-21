import { describe, expect, it } from 'vitest';
import { loadBbmodel } from '../../src/index';
import { cube, fixture, model, type FixtureName } from './fixtures';

interface FaceCheck {
  /** Corner UVs in uv units. */
  corners: number[][];
  /** Face rect in uv units. */
  rect: number[];
  /** The normalised rect as stored (Float32). */
  stored: number[];
}

/** Every face (4 consecutive vertices) of every mesh, scaled back to uv units of `uvWidth` × `uvHeight`. */
function faces(json: string, uvWidth: number, uvHeight: number): FaceCheck[] {
  const { scene } = loadBbmodel(json);
  const out: FaceCheck[] = [];
  for (const mesh of scene.meshes) {
    for (let f = 0; f < mesh.uvs.length / 8; f++) {
      const corners = [0, 1, 2, 3].map((c) => [
        (mesh.uvs[(f * 4 + c) * 2] ?? NaN) * uvWidth,
        (mesh.uvs[(f * 4 + c) * 2 + 1] ?? NaN) * uvHeight,
      ]);
      const stored = [...mesh.uvRects.slice(f * 16, f * 16 + 4)];
      const rect = stored.map((x, k) => x * (k % 2 ? uvHeight : uvWidth));
      out.push({ corners, rect, stored });
    }
  }
  return out;
}

describe('texel-exact UVs', () => {
  it.each<[FixtureName, number]>([
    ['single-cube', 16],
    ['uv-rotation-mirror', 16],
    ['nested-groups', 16],
    ['hi-res-texture', 16],
  ])('%s: corners land exactly on whole uv units and span the face rect', (name, uvSize) => {
    for (const face of faces(fixture(name), uvSize, uvSize)) {
      for (const [u = NaN, v = NaN] of face.corners) {
        expect(Number.isInteger(u) && Number.isInteger(v)).toBe(true);
      }
      const us = face.corners.map(([u = NaN]) => u);
      const vs = face.corners.map(([, v = NaN]) => v);
      expect(face.rect).toEqual([Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)]);
    }
  });

  it.each<[FixtureName, number, number]>([
    ['single-cube', 16, 16],
    ['hi-res-texture', 16, 32],
  ])(
    '%s: every texel centre in a face is strictly inside its rect and samples back to the same texel',
    (name, uvSize, pixels) => {
      for (const { stored } of faces(fixture(name), uvSize, uvSize)) {
        const [uMin = NaN, vMin = NaN, uMax = NaN, vMax = NaN] = stored;
        const firstX = Math.round(uMin * pixels);
        const lastX = Math.round(uMax * pixels);
        const firstY = Math.round(vMin * pixels);
        const lastY = Math.round(vMax * pixels);
        if (name === 'hi-res-texture') expect((lastX - firstX) % 2).toBe(0); // 1 uv unit = 2 texels
        for (let x = firstX; x < lastX; x++) {
          const u = (x + 0.5) / pixels;
          expect(u > uMin && u < uMax).toBe(true);
          expect(Math.floor(u * pixels)).toBe(x);
        }
        for (let y = firstY; y < lastY; y++) {
          const v = (y + 0.5) / pixels;
          expect(v > vMin && v < vMax).toBe(true);
          expect(Math.floor(v * pixels)).toBe(y);
        }
      }
    },
  );

  it('hi-res-texture: a 2×2 uv face covers exactly 4×4 texels of the 32×32 image', () => {
    const up = faces(fixture('hi-res-texture'), 16, 16).find(({ rect }) => rect[0] === 3 && rect[1] === 3);
    expect(up?.stored.map((x) => x * 32)).toEqual([6, 6, 10, 10]);
  });

  it('a non power-of-two uv size (48) stays within 1e-7 of the exact fraction', () => {
    const face = { uv: [5, 7, 41, 47], texture: 0 };
    const json = JSON.stringify(
      model({
        elements: [cube({ faces: { north: face, east: face, south: face, west: face, up: face, down: face } })],
        textures: [{ name: 't', uv_width: 48, uv_height: 48 }],
      }),
    );
    for (const { corners, stored } of faces(json, 1, 1)) {
      for (const [u = NaN, v = NaN] of corners) {
        expect([5, 41].some((x) => Math.abs(u - x / 48) <= 1e-7)).toBe(true);
        expect([7, 47].some((x) => Math.abs(v - x / 48) <= 1e-7)).toBe(true);
      }
      [5, 7, 41, 47].forEach((x, k) => expect(Math.abs((stored[k] ?? NaN) - x / 48)).toBeLessThanOrEqual(1e-7));
    }
  });

  it('frame-strip: strip faces scaled back by uv height × 4 frames give the authored corners and rect exactly', () => {
    const text = fixture('frame-strip');
    const authored = Object.values(
      (JSON.parse(text) as { elements: { faces: Record<string, { uv: number[]; texture: number }> }[] }).elements[0]!
        .faces,
    );
    const rectKey = (r: readonly number[]) =>
      [Math.min(r[0]!, r[2]!), Math.min(r[1]!, r[3]!), Math.max(r[0]!, r[2]!), Math.max(r[1]!, r[3]!)].join();
    const strip = new Set(authored.filter((f) => f.texture === 0).map((f) => rectKey(f.uv)));
    const still = new Set(authored.filter((f) => f.texture === 1).map((f) => rectKey(f.uv)));
    const { scene } = loadBbmodel(text);
    const mesh = scene.meshes[0]!;
    const seen: string[] = [];
    for (const group of mesh.groups) {
      const frames = scene.textures[group.material]?.frames?.count ?? 1;
      for (let f = group.start / 6; f < (group.start + group.count) / 6; f++) {
        const stored = [...mesh.uvRects.slice(f * 16, f * 16 + 4)];
        const rect = stored.map((x, k) => x * 16 * (k % 2 ? frames : 1));
        expect(rect.every(Number.isInteger)).toBe(true);
        expect((frames === 4 ? strip : still).has(rect.join())).toBe(true);
        if (frames === 4) expect(stored[3]).toBeLessThanOrEqual(0.25);
        for (let c = 0; c < 4; c++) {
          const u = mesh.uvs[(f * 4 + c) * 2]! * 16;
          const v = mesh.uvs[(f * 4 + c) * 2 + 1]! * 16 * frames;
          expect(u === rect[0] || u === rect[2]).toBe(true);
          expect(v === rect[1] || v === rect[3]).toBe(true);
        }
        seen.push(rect.join());
      }
    }
    expect(seen).toHaveLength(6);
  });

  it.each<FixtureName>(['mesh-plane', 'alpha-plane'])(
    '%s: mesh UV corners land exactly on texel edges of the 16×16 UV space',
    (name) => {
      const { scene } = loadBbmodel(fixture(name));
      for (const mesh of scene.meshes) {
        for (const value of [...mesh.uvs, ...mesh.uvRects]) {
          expect(Number.isInteger(value * 16)).toBe(true);
          expect(value >= 0 && value <= 1).toBe(true);
        }
      }
    },
  );
});
