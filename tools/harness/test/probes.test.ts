import type { SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { computeProbes } from '../fixtures/src/modelProbes';
import { locateProbe } from '../fixtures/src/ptProbes';
import type { SceneTriangles } from '../fixtures/src/sceneTriangles';
import type { UploadedTextures } from '../fixtures/src/sceneUpload';

const SIZE = 16;
const FRAMES = 4;
const POSITIONS = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 0];

function quad(vMax: number, frames: boolean): SceneDocument {
  const texture = {
    name: 'strip',
    mimeType: 'image/png',
    bytes: null,
    width: SIZE,
    height: SIZE * (frames ? FRAMES : 1),
    uvWidth: SIZE,
    uvHeight: SIZE,
    missing: false,
    ...(frames ? { frames: { count: FRAMES } } : {}),
  };
  return {
    nodes: [],
    meshes: [
      {
        name: 'quad',
        node: -1,
        positions: new Float32Array(POSITIONS),
        uvs: new Float32Array([0, 0, 1, 0, 1, vMax, 0, vMax]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        groups: [{ start: 0, count: 6, material: 0 }],
      },
    ],
    materials: [{ name: 'm', texture: 0 }],
    textures: [texture],
  } as unknown as SceneDocument;
}

describe('ptProbes locateProbe', () => {
  it('reads uv in the units of frame 0 of a frame strip', () => {
    const point = locateProbe(quad(1 / FRAMES, true), { name: 'p', mesh: 'quad', uv: [8, 8] });
    expect(point[0]).toBeCloseTo(1, 5);
    expect(point[1]).toBeCloseTo(1, 5);
  });

  it('still locates on a texture without frames', () => {
    const point = locateProbe(quad(1, false), { name: 'p', mesh: 'quad', uv: [8, 8] });
    expect(point[1]).toBeCloseTo(1, 5);
  });

  it('throws for a uv outside the frame-0 quad', () => {
    expect(() => locateProbe(quad(1 / FRAMES, true), { name: 'p', mesh: 'quad', uv: [8, 40] })).toThrow(/covers uv/);
  });
});

describe('modelProbes computeProbes', () => {
  const triangles = {
    count: 2,
    positions: new Float32Array([...POSITIONS.slice(0, 9), ...POSITIONS.slice(0, 3), ...POSITIONS.slice(6, 12)]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 0.25, 0, 0, 1, 0.25, 0, 0.25]),
    materials: new Int32Array([1, 1]),
    meshes: new Int32Array([0, 0]),
  } as unknown as SceneTriangles;
  const rows = SIZE * FRAMES;
  const pixels = new Uint8Array(SIZE * rows * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < SIZE; x++) pixels.set([y, 0, 0, 255], (y * SIZE + x) * 4);
  const textures = { sizes: [[SIZE, rows]], pixels: [pixels] } as unknown as UploadedTextures;
  // Orthographic-style view: clip x, y = world x, y over 4 units, so the quad's centre lands mid-image.
  const viewProjection = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 0, 1] as unknown as Parameters<
    typeof computeProbes
  >[4];

  it('samples the texel row of frame 0, not of the whole strip', () => {
    const [probe] = computeProbes(
      quad(0.25, true),
      triangles,
      textures,
      [{ name: 'p', mesh: 'quad', uv: [8, 8] }],
      viewProjection,
      64,
    );
    expect(probe?.texel[0]).toBe(8);
    expect(probe?.x).toBeGreaterThanOrEqual(0);
    expect(probe?.x).toBeLessThan(64);
    expect(probe?.y).toBeGreaterThanOrEqual(0);
    expect(probe?.y).toBeLessThan(64);
  });
});
