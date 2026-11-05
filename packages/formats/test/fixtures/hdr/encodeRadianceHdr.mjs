// A Radiance RGBE (.hdr) encoder, deterministic, no dependencies: the decoder's tests and the bundled environment
// image's generator (packages/looks/scripts/softboxStudioHdr.mjs) write their files with it. Pixels quantise as
// Radiance's setcolr does (mantissas truncated after frexp), scanlines are flat or new-style run-length.

/** The RGBE bytes of one scene-linear pixel. */
export function rgbe(r, g, b) {
  const max = Math.max(r, g, b);
  if (!(max >= 1e-32)) return [0, 0, 0, 0];
  let exponent = Math.floor(Math.log2(max)) + 1;
  let fraction = max / 2 ** exponent;
  if (fraction >= 1) {
    fraction /= 2;
    exponent += 1;
  } else if (fraction < 0.5) {
    fraction *= 2;
    exponent -= 1;
  }
  const d = (fraction * 256) / max;
  return [Math.floor(r * d), Math.floor(g * d), Math.floor(b * d), exponent + 128];
}

/** New-style run-length bytes of one channel plane: runs of 3 or more as count + 128, the rest as literals. */
function encodePlane(plane, out) {
  const width = plane.length;
  let i = 0;
  while (i < width) {
    let run = 1;
    while (i + run < width && run < 127 && plane[i + run] === plane[i]) run++;
    if (run >= 3) {
      out.push(128 + run, plane[i]);
      i += run;
      continue;
    }
    const start = i;
    while (i < width && i - start < 128) {
      let ahead = 1;
      while (i + ahead < width && ahead < 3 && plane[i + ahead] === plane[i]) ahead++;
      if (ahead >= 3) break;
      i++;
    }
    out.push(i - start);
    for (let k = start; k < i; k++) out.push(plane[k]);
  }
}

/**
 * The .hdr file of `image` ({ width, height, rgb: Float32Array | number[], row 0 at the top }). `rle`: new-style
 * run-length scanlines (width 8 .. 32767), else flat. `headerLines`: the lines between the signature and the blank
 * line (default the format line).
 */
export function encodeRadianceHdr(image, { rle = true, headerLines = ['FORMAT=32-bit_rle_rgbe'] } = {}) {
  const { width, height, rgb } = image;
  const out = [];
  const text = `#?RADIANCE\n${headerLines.map((line) => `${line}\n`).join('')}\n-Y ${height} +X ${width}\n`;
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
  for (let y = 0; y < height; y++) {
    const pixels = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels.push(rgbe(rgb[i], rgb[i + 1], rgb[i + 2]));
    }
    if (rle) {
      out.push(2, 2, width >> 8, width & 255);
      for (let channel = 0; channel < 4; channel++)
        encodePlane(
          pixels.map((p) => p[channel]),
          out,
        );
    } else {
      for (const p of pixels) out.push(...p);
    }
  }
  return Uint8Array.from(out);
}
