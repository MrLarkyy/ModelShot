/** A decoded Radiance HDR image: scene-linear RGB, three floats per pixel, row 0 at the top. */
export interface RadianceImage {
  readonly width: number;
  readonly height: number;
  readonly rgb: Float32Array;
}
