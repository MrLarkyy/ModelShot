import { loadGltf } from '@modelshot/formats';
import type { SceneDocument } from '@modelshot/scene';
import { encodeRgbaPng } from './encodeRgbaPng';
import {
  FILTER_QUADS,
  FILTER_SENTINEL,
  FILTER_TEXELS,
  FILTER_COLORS,
  checkerColor,
  inCutoutBlock,
  repeatColumnColor,
  type FilterQuad,
} from './textureFilterLayout';

type Rgba = readonly [number, number, number, number];

const GL_NEAREST = 9728;
const GL_LINEAR = 9729;
const GL_LINEAR_MIPMAP_LINEAR = 9987;

/** An 8 x 8 PNG data URI, texel (x, y) in `color(x, y)`. */
function image(color: (x: number, y: number) => Rgba): { uri: string } {
  const rgba = new Uint8Array(FILTER_TEXELS * FILTER_TEXELS * 4);
  for (let i = 0; i < FILTER_TEXELS * FILTER_TEXELS; i++) {
    rgba.set(color(i % FILTER_TEXELS, Math.floor(i / FILTER_TEXELS)), i * 4);
  }
  const png = encodeRgbaPng(FILTER_TEXELS, FILTER_TEXELS, rgba);
  let binary = '';
  for (const byte of png) binary += String.fromCharCode(byte);
  return { uri: `data:image/png;base64,${btoa(binary)}` };
}

const opaque = ([r, g, b]: readonly number[]): Rgba => [r ?? 0, g ?? 0, b ?? 0, 255];

/** One embedded buffer of every quad's positions, normals, UVs (normalised) and indices, with their accessors. */
function quadBuffers(quads: readonly FilterQuad[]) {
  const floats: number[] = [];
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const view = (values: readonly number[], type: 'VEC3' | 'VEC2', extra: Record<string, unknown> = {}) => {
    bufferViews.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: values.length * 4 });
    floats.push(...values);
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: values.length / (type === 'VEC3' ? 3 : 2),
      type,
      ...extra,
    });
    return accessors.length - 1;
  };
  const primitives = quads.map((quad) => {
    const [x0, x1] = quad.x;
    const [y0, y1] = quad.y;
    const [u0, v0, u1, v1] = quad.uv.map((t) => t / FILTER_TEXELS) as [number, number, number, number];
    // Top left, top right, bottom right, bottom left.
    const positions = [x0, y1, 0, x1, y1, 0, x1, y0, 0, x0, y0, 0];
    const position = view(positions, 'VEC3', { min: [x0, y0, 0], max: [x1, y1, 0] });
    const normal = view([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 'VEC3');
    const uv = view([u0, v0, u1, v0, u1, v1, u0, v1], 'VEC2');
    return { position, normal, uv };
  });
  // Both triangles counter-clockwise from +z: 0 3 2 and 0 2 1 (top left, bottom left, bottom right, top right).
  const indexBytes = new Uint8Array(new Uint16Array([0, 3, 2, 0, 2, 1]).buffer);
  const floatBytes = new Uint8Array(new Float32Array(floats).buffer);
  bufferViews.push({ buffer: 0, byteOffset: floatBytes.byteLength, byteLength: indexBytes.byteLength });
  accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: 6, type: 'SCALAR' });
  const indices = accessors.length - 1;
  const bytes = new Uint8Array(floatBytes.byteLength + indexBytes.byteLength);
  bytes.set(floatBytes);
  bytes.set(indexBytes, floatBytes.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const buffer = { byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(binary)}` };
  return { buffer, bufferViews, accessors, primitives, indices };
}

/**
 * The filter scene (textureFilterLayout.ts) as a glTF document built here (images generated, no asset file), loaded
 * through `loadGltf`, so the filters come from its samplers: LINEAR for the linear quads, NEAREST beside it on the
 * same checker image for the nearest one (two scene textures sharing bytes). Materials without a mesh hold sentinel
 * images so that, in the path tracer's texture layers (shelf-packed in document order), one lies right of every linear
 * texture; a tap that left its image would show it. glTF wrap is not mapped, so the repeat quads' textures get
 * `wrap: 'repeat'` on the loaded document.
 */
export function textureFilterScene(): SceneDocument {
  const checker = image((x, y) => opaque(checkerColor(x, y)));
  const images = [
    checker,
    image((x, y) => (inCutoutBlock(x, y) ? [0, 0, 0, 0] : opaque(FILTER_COLORS.mask))),
    image((x) => opaque(repeatColumnColor(x))),
    checker,
  ];
  const sampler = { linear: 0, nearest: 1, sentinel: 2 } as const;
  const samplers = [
    { magFilter: GL_LINEAR, minFilter: GL_LINEAR_MIPMAP_LINEAR },
    { magFilter: GL_NEAREST, minFilter: GL_NEAREST },
    { magFilter: GL_NEAREST },
  ];
  const textures: { source: number; sampler: number }[] = [
    { source: 0, sampler: sampler.linear },
    { source: 1, sampler: sampler.linear },
    { source: 2, sampler: sampler.linear },
    { source: 3, sampler: sampler.linear },
    { source: 0, sampler: sampler.nearest },
  ];
  // A sentinel per linear texture: its own image entry, so each is a scene texture of its own.
  const sentinelTexture = (): number => {
    images.push(image(() => opaque(FILTER_SENTINEL)));
    textures.push({ source: images.length - 1, sampler: sampler.sentinel });
    return textures.length - 1;
  };
  const textured = (index: number, alphaMode: 'OPAQUE' | 'MASK' = 'OPAQUE') => ({
    pbrMetallicRoughness: { baseColorTexture: { index } },
    alphaMode,
  });
  // Scene textures follow the materials: each linear one, then a sentinel; the nearest one last.
  const materials = [
    textured(0),
    textured(sentinelTexture()),
    textured(1, 'MASK'),
    textured(sentinelTexture()),
    textured(2),
    textured(sentinelTexture()),
    textured(3),
    textured(sentinelTexture()),
    textured(4),
  ];
  const materialOf: Readonly<Record<FilterQuad['name'], number>> = {
    linear: 0,
    cutout: 2,
    repeat: 4,
    minified: 6,
    nearest: 8,
  };
  const { buffer, bufferViews, accessors, primitives, indices } = quadBuffers(FILTER_QUADS);
  const gltf = {
    asset: { version: '2.0', generator: 'modelshot harness textureFilterScene' },
    scene: 0,
    scenes: [{ nodes: FILTER_QUADS.map((_, k) => k) }],
    nodes: FILTER_QUADS.map((quad, k) => ({ name: quad.name, mesh: k })),
    meshes: FILTER_QUADS.map((quad, k) => ({
      name: quad.name,
      primitives: [
        {
          attributes: {
            POSITION: primitives[k]!.position,
            NORMAL: primitives[k]!.normal,
            TEXCOORD_0: primitives[k]!.uv,
          },
          indices,
          material: materialOf[quad.name],
        },
      ],
    })),
    materials,
    textures,
    samplers,
    images,
    buffers: [buffer],
    bufferViews,
    accessors,
  };
  // Scene units as written: the layout's coordinates are those of the views.
  const doc = loadGltf(JSON.stringify(gltf), { unitScale: 1 }).scene;
  const repeated = new Set(
    FILTER_QUADS.filter((quad) => quad.wrap === 'repeat').map((quad) => doc.materials[materialOf[quad.name]]?.texture),
  );
  return {
    ...doc,
    textures: doc.textures.map((texture, t) => (repeated.has(t) ? { ...texture, wrap: 'repeat' as const } : texture)),
  };
}
