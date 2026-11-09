import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The package indexes pull in GLSL and the bundled images through Vite's ?raw and ?url, which Playwright cannot load:
// the plain modules directly, on the same files.
import { decodeRadianceHdr } from '../../../packages/formats/src/hdr/decodeRadianceHdr';
import { shIrradiance } from '../../../packages/looks/src/shIrradiance';
import { lookPresetFile } from './lookPresetFile';

const ENVIRONMENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'looks',
  'src',
  'environments',
);

const luminance = (c: readonly number[]): number => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

/**
 * Z / π of a bundled image at `intensity`: its cos-weighted mean luminance over the upper hemisphere, what a blocked
 * importance-sampled catcher fill ray loses (catcherFill chunk; catcherFillSampling.test.ts holds the mirror to it).
 */
function imageFillLoss(image: string, intensity: number): number {
  const { width, height, rgb } = decodeRadianceHdr(new Uint8Array(readFileSync(join(ENVIRONMENTS, `${image}.hdr`))));
  let sum = 0;
  for (let row = 0; row < Math.ceil(height / 2); row++) {
    const y0 = Math.cos((Math.PI * row) / height);
    const y1 = Math.max(0, Math.cos((Math.PI * (row + 1)) / height));
    let rowLuminance = 0;
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 3;
      rowLuminance += luminance([rgb[i] ?? 0, rgb[i + 1] ?? 0, rgb[i + 2] ?? 0]);
    }
    sum += (rowLuminance * intensity * ((2 * Math.PI) / width) * (y0 * y0 - y1 * y1)) / 2;
  }
  return sum / Math.PI;
}

/**
 * The four 8-bit coverages a 1-sample catcher sample of the preset takes inside the fade with opaque blockers
 * (`catcherShadeOfLoss` of shadowCatcher.glsl): nothing, the fill, the key, both blocked. The light weight W is
 * lum(hemisphereFill(up)) + the key's: the dome's sky, an image's L2 irradiance at +y (its preview reference).
 */
export function catcherLevels(presetId: string): readonly number[] {
  const look = lookPresetFile(presetId);
  const key = luminance(look.lights.key.color) * look.lights.key.direction[1];
  let fill: number;
  let up: number;
  if (look.environment.kind === 'dome') {
    fill = luminance(look.environment.sky);
    up = fill;
  } else {
    const { image, intensity } = look.environment;
    fill = imageFillLoss(image, intensity);
    const sh = (JSON.parse(readFileSync(join(ENVIRONMENTS, `${image}.sh.json`), 'utf8')) as number[]).map(
      (v) => v * intensity,
    );
    // +y is +y in the image's frame at any yaw.
    up = luminance(shIrradiance(sh, [0, 1, 0]).map((v) => Math.max(0, v)));
  }
  const weight = up + key;
  return [0, fill, key, fill + key].map((v) => (255 * look.catcher.strength * v) / weight);
}
