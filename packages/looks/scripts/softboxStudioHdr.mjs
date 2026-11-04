// Writes the bundled environment image src/environments/softbox-studio.hdr and its preview harmonics
// softbox-studio.sh.json: node packages/looks/scripts/softboxStudioHdr.mjs
// Deterministic and procedural, authored for ModelShot (CC0-1.0, src/environments/LICENSE); test/softboxAsset.test.ts
// checks both committed files equal what this writes. 32 x 16 is enough for Lambert-only renderers that see the image
// through cosine integrals only, and keeps its two inlined copies (the path tracer and the bake worker) within the app's
// bundle budget; the preview reads only the 27 harmonics. A small studio: a navy-grey floor, a sky darkening toward the
// zenith, a broad warm softbox upper front left and a cool panel behind. Every feature is broad (Gaussian lobes of 42
// and 46 degrees, a horizon blended over 20 degrees) and every pixel at least 0.02, so its L2 spherical-harmonic
// irradiance (the preview's fill) stays within 1 % of the exact one (test/environmentLighting.test.ts).
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { encodeRadianceHdr, rgbe } from '../../formats/test/fixtures/hdr/encodeRadianceHdr.mjs';

export const WIDTH = 32;
export const HEIGHT = 16;

const FLOOR = [0.045, 0.05, 0.07];
const SKY = [0.16, 0.18, 0.24];
/** sin of the horizon's half blend width (about 10 degrees). */
const HORIZON = 0.17;

const unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
};

const LOBES = [
  { centre: unit([-0.55, 0.6, -0.6]), sigmaDeg: 42, color: [1.45, 1.28, 1.02] },
  { centre: unit([0.5, 0.35, 0.8]), sigmaDeg: 46, color: [0.33, 0.42, 0.63] },
];

/**
 * The unit direction of equirect position (u, v), as environmentLighting.ts and environmentMap.glsl map it: v 0 the
 * zenith (+y), u 0.5 the front (−z), u 0.75 +x.
 */
export function equirectDirection(u, v) {
  const theta = Math.PI * v;
  const phi = 2 * Math.PI * u - Math.PI;
  return [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
}

/** Scene-linear radiance of the studio along unit direction d. */
export function softboxStudioRadiance(d) {
  const t = Math.max(-1, Math.min(1, d[1] / HORIZON));
  // Odd in y, so the blend adds no even harmonics the cosine lobe would keep beyond L2.
  const sky = 0.5 + 0.25 * t * (3 - t * t);
  const fade = 1 - 0.2 * d[1] * d[1];
  const out = [0, 1, 2].map((c) => (FLOOR[c] + (SKY[c] - FLOOR[c]) * sky) * fade);
  for (const lobe of LOBES) {
    const cos = Math.max(-1, Math.min(1, d[0] * lobe.centre[0] + d[1] * lobe.centre[1] + d[2] * lobe.centre[2]));
    const angle = Math.acos(cos) / ((lobe.sigmaDeg * Math.PI) / 180);
    const weight = Math.exp(-0.5 * angle * angle);
    for (let c = 0; c < 3; c++) out[c] += lobe.color[c] * weight;
  }
  return out;
}

/** The studio at WIDTH x HEIGHT, each pixel the radiance at its centre, row 0 the zenith. */
export function softboxStudioImage() {
  const rgb = new Float64Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const radiance = softboxStudioRadiance(equirectDirection((x + 0.5) / WIDTH, (y + 0.5) / HEIGHT));
      rgb.set(radiance, (y * WIDTH + x) * 3);
    }
  }
  return { width: WIDTH, height: HEIGHT, rgb };
}

/** The bytes of softbox-studio.hdr: new-style run-length RGBE. */
export function softboxStudioHdr() {
  return encodeRadianceHdr(softboxStudioImage(), {
    headerLines: [
      '# softbox-studio: procedural, CC0-1.0, packages/looks/scripts/softboxStudioHdr.mjs',
      'FORMAT=32-bit_rle_rgbe',
    ],
  });
}

const SH_BANDS = [1, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25];

function shBasis([x, y, z]) {
  return [
    0.282095,
    0.488603 * y,
    0.488603 * z,
    0.488603 * x,
    1.092548 * x * y,
    1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ];
}

/**
 * The preview's L2 irradiance over pi of the stored image at intensity 1: 27 float32 values, computed from the pixels
 * as decodeRadianceHdr reads them, in the order and arithmetic of environmentLighting.ts (imageIrradianceSh).
 */
export function softboxStudioSh() {
  const { rgb } = softboxStudioImage();
  const sums = new Float64Array(27);
  for (let y = 0; y < HEIGHT; y++) {
    const solidAngle =
      ((2 * Math.PI) / WIDTH) * (Math.cos((Math.PI * y) / HEIGHT) - Math.cos((Math.PI * (y + 1)) / HEIGHT));
    for (let x = 0; x < WIDTH; x++) {
      const basis = shBasis(equirectDirection((x + 0.5) / WIDTH, (y + 0.5) / HEIGHT));
      const i = (y * WIDTH + x) * 3;
      const stored = rgbe(rgb[i], rgb[i + 1], rgb[i + 2]);
      const pixel = [0, 1, 2].map((c) =>
        stored[3] === 0 ? 0 : Math.fround((stored[c] + 0.5) * 2 ** (stored[3] - 136)),
      );
      for (let k = 0; k < 9; k++) {
        const w = basis[k] * solidAngle;
        for (let c = 0; c < 3; c++) sums[k * 3 + c] = sums[k * 3 + c] + pixel[c] * w;
      }
    }
  }
  return Array.from(sums, (value, j) => Math.fround(value * SH_BANDS[Math.floor(j / 3)] * 1));
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const target = new URL('../src/environments/softbox-studio.hdr', import.meta.url);
  const bytes = softboxStudioHdr();
  writeFileSync(target, bytes);
  console.log(`wrote ${fileURLToPath(target)} (${bytes.length} bytes)`);
  const sh = new URL('../src/environments/softbox-studio.sh.json', import.meta.url);
  writeFileSync(
    sh,
    `${JSON.stringify(softboxStudioSh())}
`,
  );
  console.log(`wrote ${fileURLToPath(sh)}`);
}
