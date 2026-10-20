// Writes the test skins next to this file: node packages/formats/test/fixtures/skins/generate.mjs
// Deterministic, no dependencies. Every face of every part has its own colour (hues 0-75 base, 90-165 outer layer,
// blue never above green so no mix of them reads as the magenta sentinel), with its top-left texel darker to show
// orientation. Texels outside every face region are the sentinel magenta (255, 0, 255). Outer-layer faces are an
// opaque one-texel ring around alpha-0 holes. Probes: head front texels (2..3, 2..3) are alpha 0 with RGB (0, 200, 200)
// (the base layer must still show them opaque); in skin-slim.png hat front texels (4..5, 4..5) and jacket front texels
// (3..4, 5..6) are green at alpha 128.
import { writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const SENTINEL = [255, 0, 255, 255];
const PROBE = [0, 200, 200, 0];
const PARTIAL = [0, 255, 0, 128];
const FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
const FACE_SHADES = {
  north: [0.75, 1],
  east: [0.75, 0.8],
  south: [0.5, 0.9],
  west: [0.5, 0.7],
  up: [1, 0.95],
  down: [1, 0.6],
};

/** Texel rectangles [u0, v0, u1, v1) of a box-UV part of size [x, y, z] at offset [u, v]. */
function faceRegions([x, y, z], [u, v]) {
  return {
    east: [u, v + z, u + z, v + z + y],
    north: [u + z, v + z, u + z + x, v + z + y],
    west: [u + z + x, v + z, u + 2 * z + x, v + z + y],
    south: [u + 2 * z + x, v + z, u + 2 * z + 2 * x, v + z + y],
    up: [u + z, v, u + z + x, v + z],
    down: [u + z + x, v, u + z + 2 * x, v + z],
  };
}

function hsv(hueDeg, s, v) {
  const f = (n) => {
    const k = (n + hueDeg / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

function parts(arms, legacy) {
  const armWidth = arms === 'slim' ? 3 : 4;
  const base = [
    ['head', [8, 8, 8], [0, 0]],
    ['body', [8, 12, 4], [16, 16]],
    ['right_arm', [armWidth, 12, 4], [40, 16]],
    ['right_leg', [4, 12, 4], [0, 16]],
  ];
  const outer = [['hat', [8, 8, 8], [32, 0]]];
  if (!legacy) {
    base.push(['left_arm', [armWidth, 12, 4], [32, 48]], ['left_leg', [4, 12, 4], [16, 48]]);
    outer.push(
      ['jacket', [8, 12, 4], [16, 32]],
      ['right_sleeve', [armWidth, 12, 4], [40, 32]],
      ['left_sleeve', [armWidth, 12, 4], [48, 48]],
      ['right_pants', [4, 12, 4], [0, 32]],
      ['left_pants', [4, 12, 4], [0, 48]],
    );
  }
  return [
    ...base.map(([name, size, uv], p) => ({ name, size, uv, outer: false, hue: p * 15 })),
    ...outer.map(([name, size, uv], p) => ({ name, size, uv, outer: true, hue: 90 + p * 15 })),
  ];
}

function skinPixels(arms, legacy, partial) {
  const width = 64;
  const height = legacy ? 32 : 64;
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set(SENTINEL, i * 4);
  const put = (u, v, rgba) => pixels.set(rgba, (v * width + u) * 4);
  for (const part of parts(arms, legacy)) {
    const regions = faceRegions(part.size, part.uv);
    for (const face of FACES) {
      const [u0, v0, u1, v1] = regions[face];
      const [s, v] = FACE_SHADES[face];
      const colour = hsv(part.hue, s, v);
      const marker = hsv(part.hue, s, v * 0.45);
      for (let y = v0; y < v1; y++) {
        for (let x = u0; x < u1; x++) {
          const i = x - u0;
          const j = y - v0;
          const ring = i === 0 || j === 0 || x === u1 - 1 || y === v1 - 1;
          const rgb = i === 0 && j === 0 ? marker : colour;
          put(x, y, [...rgb, part.outer && !ring ? 0 : 255]);
        }
      }
    }
  }
  const head = faceRegions([8, 8, 8], [0, 0]).north;
  for (const [i, j] of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
  ])
    put(head[0] + i, head[1] + j, PROBE);
  if (partial) {
    const hat = faceRegions([8, 8, 8], [32, 0]).north;
    for (const [i, j] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ])
      put(hat[0] + i, hat[1] + j, PARTIAL);
    const jacket = faceRegions([8, 12, 4], [16, 32]).north;
    for (const [i, j] of [
      [3, 5],
      [4, 5],
      [3, 6],
      [4, 6],
    ])
      put(jacket[0] + i, jacket[1] + j, PARTIAL);
  }
  return { width, height, pixels };
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(
    Uint8Array.from(type, (c) => c.charCodeAt(0)),
    4,
  );
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng({ width, height, pixels }) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

const skins = {
  'skin-classic.png': skinPixels('classic', false, false),
  'skin-slim.png': skinPixels('slim', false, true),
  'skin-legacy.png': skinPixels('classic', true, false),
};
for (const [name, skin] of Object.entries(skins)) writeFileSync(new URL(name, import.meta.url), encodePng(skin));
