/** Column-major 4×4 matrix, as WebGL uniforms expect. */
export type Matrix = Float32Array;
export type Point3 = readonly [number, number, number];

/**
 * The one camera, light and look of the model-view fixture. The raster and the raycast variants both read these, so a
 * difference between their images comes from how they render, never from what they render.
 */
export const MODEL_VIEW_LOOK = Object.freeze({
  eye: [26, 24, 40] as Point3,
  target: [0, 4, 0] as Point3,
  fovYDegrees: 40,
  near: 1,
  far: 200,
  /** Unit direction from a surface toward the (directional) light. */
  toLight: normalize([-0.8, 1, 0.35]),
  /** Half the side of the light's orthographic view, centred on the origin; covers every fixture model. */
  lightHalfExtent: 32,
  lightDistance: 80,
  shadowMapSize: 1024,
  /**
   * Both renderers move a shadow receiver this far along its geometric normal (toward the viewer) before testing the
   * light: 1.5 shadow-map texels (2 · 32 / 1024 units each), enough to keep a curved or grazing surface from shadowing
   * itself in the shadow map, and far below the size of a texel of any fixture model.
   */
  shadowNormalOffset: 1.5 * ((2 * 32) / 1024),
  background: [0.1, 0.11, 0.14] as Point3,
  untextured: [0.78, 0.78, 0.76] as Point3,
  ambient: 0.35,
});

export function cameraViewProjection(aspect: number): Matrix {
  const { eye, target, fovYDegrees, near, far } = MODEL_VIEW_LOOK;
  return multiply(perspective(fovYDegrees, aspect, near, far), lookAt(eye, target, [0, 1, 0]));
}

/** Orthographic view along the light; depth grows away from the light. */
export function lightViewProjection(): Matrix {
  const { toLight, lightHalfExtent: h, lightDistance } = MODEL_VIEW_LOOK;
  const eye: Point3 = [toLight[0] * lightDistance, toLight[1] * lightDistance, toLight[2] * lightDistance];
  return multiply(orthographic(h, h, 1, lightDistance * 2), lookAt(eye, [0, 0, 0], [0, 0, -1]));
}

export function lookAt(eye: Point3, target: Point3, up: Point3): Matrix {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  // prettier-ignore
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function perspective(fovYDegrees: number, aspect: number, near: number, far: number): Matrix {
  const f = 1 / Math.tan((fovYDegrees * Math.PI) / 360);
  const range = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, 2 * near * far * range, 0,
  ]);
}

export function orthographic(halfWidth: number, halfHeight: number, near: number, far: number): Matrix {
  // prettier-ignore
  return new Float32Array([
    1 / halfWidth, 0, 0, 0,
    0, 1 / halfHeight, 0, 0,
    0, 0, -2 / (far - near), 0,
    0, 0, -(far + near) / (far - near), 1,
  ]);
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Inverse by cofactors; the matrices here are well-conditioned view-projections. */
export function invert(m: Matrix): Matrix {
  const a = Array.from(m);
  const inv = new Array<number>(16).fill(0);
  const at = (i: number): number => a[i] ?? 0;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      const minor: number[] = [];
      for (let c = 0; c < 4; c++) {
        if (c === row) continue;
        for (let r = 0; r < 4; r++) if (r !== col) minor.push(at(c * 4 + r));
      }
      const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = minor as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const det3 = m0 * (m4 * m8 - m5 * m7) - m3 * (m1 * m8 - m2 * m7) + m6 * (m1 * m5 - m2 * m4);
      inv[col * 4 + row] = ((row + col) % 2 ? -1 : 1) * det3;
    }
  }
  const det = at(0) * (inv[0] ?? 0) + at(1) * (inv[4] ?? 0) + at(2) * (inv[8] ?? 0) + at(3) * (inv[12] ?? 0);
  if (Math.abs(det) < 1e-12) throw new Error('matrix is not invertible');
  return new Float32Array(inv.map((x) => x / det));
}

/** Pixel of a world point, x right and y down from the top-left corner (PNG order), or null behind the camera. */
export function projectToPixel(
  viewProjection: Matrix,
  p: Point3,
  width: number,
  height: number,
): [number, number] | null {
  const v = (k: number): number =>
    (viewProjection[k] ?? 0) * p[0] +
    (viewProjection[4 + k] ?? 0) * p[1] +
    (viewProjection[8 + k] ?? 0) * p[2] +
    (viewProjection[12 + k] ?? 0);
  const w = v(3);
  if (w <= 0) return null;
  return [Math.floor(((v(0) / w + 1) / 2) * width), Math.floor((1 - (v(1) / w + 1) / 2) * height)];
}

export function normalize(v: Point3): Point3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Point3, b: Point3): Point3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
