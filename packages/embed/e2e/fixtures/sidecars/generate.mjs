// Writes the multi-file models of the embed sidecar tests (embed.sidecars.spec.ts, test/fetchSidecars.test.ts) from
// our own geometry and pixels, byte for byte the same on every run: a cube textured with a 4x4 checker of two
// saturated colours no look's backdrop has, as a .gltf with an external buffer and image and as an .obj with an .mtl.
// The texture's name has a space and the references climb a directory, as exported models often do.
// Usage: node packages/embed/e2e/fixtures/sidecars/generate.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The checker's two colours. */
const CHECKER_COLOURS = [
  [230, 20, 160],
  [20, 190, 230],
];

function write(path, data) {
  const target = join(HERE, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

function checkerPng() {
  const png = new PNG({ width: 4, height: 4, colorType: 6 });
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const [r, g, b] = CHECKER_COLOURS[(x + y) % 2];
      png.data.set([r, g, b, 255], (y * 4 + x) * 4);
    }
  }
  return PNG.sync.write(png, { colorType: 6 });
}

/** A unit cube centred on the origin, 4 corners per face, each face's UVs over the whole texture. */
function cube() {
  const faces = [
    { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const { normal, u, v } of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      for (let axis = 0; axis < 3; axis++) {
        positions.push(0.5 * (normal[axis] + su * u[axis] + sv * v[axis]));
      }
      normals.push(...normal);
      uvs.push((su + 1) / 2, (1 - sv) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices };
}

function gltf(mesh) {
  const parts = [
    new Float32Array(mesh.positions),
    new Float32Array(mesh.normals),
    new Float32Array(mesh.uvs),
    new Uint16Array(mesh.indices),
  ];
  const views = [];
  let offset = 0;
  for (const part of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: part.byteLength });
    offset += Math.ceil(part.byteLength / 4) * 4;
  }
  const bin = Buffer.alloc(offset);
  parts.forEach((part, index) => Buffer.from(part.buffer).copy(bin, views[index].byteOffset));
  const count = mesh.positions.length / 3;
  const doc = {
    asset: { version: '2.0', generator: 'ModelShot embed test fixture (generate.mjs)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'checker cube', mesh: 0 }],
    meshes: [
      {
        name: 'checker cube',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }],
      },
    ],
    materials: [{ name: 'checker', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ uri: '../textures/checker%20tile.png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: mesh.indices.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ uri: 'bin/scene.bin', byteLength: bin.byteLength }],
  };
  return { json: `${JSON.stringify(doc, null, 2)}\n`, bin };
}

function obj(mesh) {
  const out = ['# ModelShot embed test fixture (generate.mjs)', 'mtllib scene.mtl', 'o checker_cube'];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push(`v ${mesh.positions.slice(i, i + 3).join(' ')}`);
  for (let i = 0; i < mesh.uvs.length; i += 2) out.push(`vt ${mesh.uvs[i]} ${1 - mesh.uvs[i + 1]}`);
  for (let i = 0; i < mesh.normals.length; i += 3) out.push(`vn ${mesh.normals.slice(i, i + 3).join(' ')}`);
  out.push('usemtl checker');
  for (let i = 0; i < mesh.indices.length; i += 3) {
    out.push(
      `f ${[0, 1, 2]
        .map((k) => mesh.indices[i + k] + 1)
        .map((n) => `${n}/${n}/${n}`)
        .join(' ')}`,
    );
  }
  return `${out.join('\n')}\n`;
}

const MTL = [
  '# ModelShot embed test fixture (generate.mjs)',
  'newmtl checker',
  'Kd 1 1 1',
  'map_Kd -s 1 1 1 ../textures/checker tile.png',
  '',
].join('\n');

const mesh = cube();
const model = gltf(mesh);
write('textures/checker tile.png', checkerPng());
write('gltf/scene.gltf', model.json);
write('gltf/bin/scene.bin', model.bin);
write('obj/scene.obj', obj(mesh));
write('obj/scene.mtl', MTL);
