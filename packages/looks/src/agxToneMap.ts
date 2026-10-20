/*
 * Matrices, log2 range and contrast polynomial from Benjamin Wrensch's minimal AgX implementation
 * ("Minimal AgX Implementation", iolite engine / Missing Deadlines blog), used under the MIT License:
 *
 * MIT License
 *
 * Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
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
