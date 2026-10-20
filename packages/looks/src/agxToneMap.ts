/*
 * AgX by Troy Sobotka. The Rec.709 inset/outset matrices, the log2 range and the contrast polynomial fit follow
 * Benjamin Wrensch, "Minimal AgX Implementation" (iolite engine blog, 2024,
 * https://iolite-engine.com/blog_posts/minimal_agx_implementation); the same polynomial ships in three.js
 * AgXToneMapping (MIT) and Filament.
 */

// Column-major like a GLSL mat3: column c holds entries 3c..3c + 2.
const INSET = [
  0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104,
];
const OUTSET = [
  1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417,
  -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116,
];
const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

export type Rgb = readonly [number, number, number];

function multiply(m: readonly number[], v: Rgb): [number, number, number] {
  const row = (r: number): number => (m[r] ?? 0) * v[0] + (m[3 + r] ?? 0) * v[1] + (m[6 + r] ?? 0) * v[2];
  return [row(0), row(1), row(2)];
}

function contrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

function curve(value: number): number {
  const ev = Math.min(MAX_EV, Math.max(MIN_EV, Math.log2(Math.max(value, 1e-10))));
  return contrast((ev - MIN_EV) / (MAX_EV - MIN_EV));
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The AgX view transform of `glsl/agx.glsl` in double precision: scene-linear Rec.709 in, display-encoded sRGB in 0..1
 * out. For tests and CPU-side colours; the GPU result may differ in the last bit.
 */
export function agxToneMap(linear: Rgb): [number, number, number] {
  const inset = multiply(INSET, [Math.max(0, linear[0]), Math.max(0, linear[1]), Math.max(0, linear[2])]);
  const out = multiply(OUTSET, [curve(inset[0]), curve(inset[1]), curve(inset[2])]);
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}
