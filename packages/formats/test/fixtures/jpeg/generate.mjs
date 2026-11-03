// Writes the JPEG-textured test models next to this file: node packages/formats/test/fixtures/jpeg/generate.mjs
// Deterministic, no dependencies; test/jpeg/fixtures.test.ts checks the committed files equal buildJpegFixtures().
// crate.jpg is 32x32, 4x4 flat 8x8 blocks of 16 saturated colours (CRATE_COLOURS, row by row from the top left), on a
// unit cube standing on y = 0 whose every face maps the whole image: crate.gltf + crate.bin (external crate.jpg),
// crate.glb (the JPEG in a buffer view; faces +y, -y and +z under a MASK material, as a JPEG has no alpha every texel
// is opaque) and crate.obj + crate.mtl. wide-exif6.jpg is 16x8 (left block red, right blue) tagged Exif orientation 6,
// drawn in stored order. big-sof.jpg is headers only, a frame of 4097x16: over the side limit, never decodable.
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';
import { encodeFlatJpeg, rgbToYcc, yccToRgb } from './encodeFlatJpeg.mjs';

function hsv(hueDeg, s, v) {
  const f = (n) => {
    const k = (n + hueDeg / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

const CRATE_YCC = Array.from({ length: 16 }, (_, i) => rgbToYcc(hsv(i * 22.5, 0.8, i % 2 === 0 ? 0.95 : 0.7)));

/** The RGB a decoder gives for each crate.jpg block (JFIF conversion of the stored YCbCr), row by row. */
export const CRATE_COLOURS = CRATE_YCC.map(yccToRgb);

const WIDE_YCC = [rgbToYcc([220, 40, 40]), rgbToYcc([40, 60, 220])];

/** The RGB of wide-exif6.jpg's left and right block. */
export const WIDE_COLOURS = WIDE_YCC.map(yccToRgb);

/** A unit cube standing on y = 0, 4 corners per face, each face's UVs over the whole image (glTF v down). */
function cube() {
  const faces = [
    { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
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
        positions.push(0.5 * (normal[axis] + su * u[axis] + sv * v[axis]) + (axis === 1 ? 0.5 : 0));
      }
      normals.push(...normal);
      uvs.push((su + 1) / 2, (1 - sv) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices };
}

const pad4 = (n) => Math.ceil(n / 4) * 4;

/** The binary buffer (positions, normals, UVs, indices, then optional image bytes) and its views. */
function buffer(mesh, image) {
  const parts = [
    new Uint8Array(new Float32Array(mesh.positions).buffer),
    new Uint8Array(new Float32Array(mesh.normals).buffer),
    new Uint8Array(new Float32Array(mesh.uvs).buffer),
    new Uint8Array(new Uint16Array(mesh.indices).buffer),
  ];
  if (image) parts.push(image);
  const views = [];
  let offset = 0;
  for (const part of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: part.byteLength });
    offset += pad4(part.byteLength);
  }
  const bin = new Uint8Array(offset);
  parts.forEach((part, index) => bin.set(part, views[index].byteOffset));
  return { bin, views };
}

function gltfDocument(mesh, views, binLength, embedded) {
  const count = mesh.positions.length / 3;
  // The GLB splits the cube: faces +x, -x, -z opaque (indices 0..17), faces +y, -y, +z masked (18..35).
  const halves = embedded
    ? [
        { indices: 3, material: 0 },
        { indices: 4, material: 1 },
      ]
    : [{ indices: 3, material: 0 }];
  const accessors = [
    { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
  ];
  const half = mesh.indices.length / 2;
  if (embedded) {
    accessors.push(
      { bufferView: 3, byteOffset: 0, componentType: 5123, count: half, type: 'SCALAR' },
      { bufferView: 3, byteOffset: half * 2, componentType: 5123, count: half, type: 'SCALAR' },
    );
  } else accessors.push({ bufferView: 3, componentType: 5123, count: mesh.indices.length, type: 'SCALAR' });
  const materials = [{ name: 'crate', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  if (embedded) {
    materials.push({
      name: 'crate masked',
      alphaMode: 'MASK',
      alphaCutoff: 0.5,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
    });
  }
  return {
    asset: { version: '2.0', generator: 'ModelShot test fixture (jpeg/generate.mjs)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'crate', mesh: 0 }],
    meshes: [
      {
        name: 'crate',
        primitives: halves.map(({ indices, material }) => ({
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices,
          material,
        })),
      },
    ],
    materials,
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [embedded ? { bufferView: 4, mimeType: 'image/jpeg' } : { uri: 'crate.jpg' }],
    accessors,
    bufferViews: views,
    buffers: [embedded ? { byteLength: binLength } : { uri: 'crate.bin', byteLength: binLength }],
  };
}

function glb(doc, bin) {
  const text = new TextEncoder().encode(JSON.stringify(doc));
  const json = new Uint8Array(pad4(text.length)).fill(0x20);
  json.set(text);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  view.setUint32(20 + json.length, bin.length, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  out.set(bin, 28 + json.length);
  return out;
}

function obj(mesh) {
  const out = ['# ModelShot test fixture (jpeg/generate.mjs)', 'mtllib crate.mtl', 'o crate'];
  for (let i = 0; i < mesh.positions.length; i += 3) out.push(`v ${mesh.positions.slice(i, i + 3).join(' ')}`);
  for (let i = 0; i < mesh.uvs.length; i += 2) out.push(`vt ${mesh.uvs[i]} ${1 - mesh.uvs[i + 1]}`);
  for (let i = 0; i < mesh.normals.length; i += 3) out.push(`vn ${mesh.normals.slice(i, i + 3).join(' ')}`);
  out.push('usemtl crate');
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const corners = [0, 1, 2].map((k) => mesh.indices[i + k] + 1).map((n) => `${n}/${n}/${n}`);
    out.push(`f ${corners.join(' ')}`);
  }
  return `${out.join('\n')}\n`;
}

const MTL = ['# ModelShot test fixture (jpeg/generate.mjs)', 'newmtl crate', 'Kd 1 1 1', 'map_Kd crate.jpg', ''].join(
  '\n',
);

const LICENSE = `The JPEG images (*.jpg), glTF models (*.gltf, *.glb), buffers (*.bin), OBJ models (*.obj) and material libraries
(*.mtl) in this directory, including the images embedded in them, were made for ModelShot tests from our own geometry
and pixel data by generate.mjs and encodeFlatJpeg.mjs, and are dedicated to the public domain under CC0-1.0.

To the extent possible under law, the ModelShot authors have waived all copyright and related or neighboring rights
to these files. See https://creativecommons.org/publicdomain/zero/1.0/
`;

/** Every fixture file by name, as bytes. */
export function buildJpegFixtures() {
  const encoder = new TextEncoder();
  const crate = encodeFlatJpeg(32, 32, CRATE_YCC);
  const mesh = cube();
  const external = buffer(mesh, null);
  const embedded = buffer(mesh, crate);
  const gltfText = `${JSON.stringify(gltfDocument(mesh, external.views, external.bin.length, false), null, 2)}\n`;
  return new Map([
    ['crate.jpg', crate],
    ['crate.bin', external.bin],
    ['crate.gltf', encoder.encode(gltfText)],
    ['crate.glb', glb(gltfDocument(mesh, embedded.views, embedded.bin.length, true), embedded.bin)],
    ['crate.obj', encoder.encode(obj(mesh))],
    ['crate.mtl', encoder.encode(MTL)],
    ['wide-exif6.jpg', encodeFlatJpeg(16, 8, WIDE_YCC, { exifOrientation: 6 })],
    ['big-sof.jpg', encodeFlatJpeg(4097, 16, [], { headerOnly: true })],
    ['LICENSE', encoder.encode(LICENSE)],
  ]);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, bytes] of buildJpegFixtures()) writeFileSync(new URL(name, import.meta.url), bytes);
}
