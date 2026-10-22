#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

#include "luminanceMoments"

// The noise estimate of one NOISE_BLOCK x NOISE_BLOCK block of canvas pixels: the largest relative standard error of
// a pixel's mean luminance in it, a pixel being the box mean of its u_scale x u_scale traced pixels. Dark pixels count
// against a floor, so the noise of near-black never holds a render back. The CPU takes a quantile over the blocks.
uniform highp sampler2D u_sum;
uniform highp sampler2D u_moments;
uniform float u_samples;
uniform int u_scale;
uniform ivec2 u_outputSize;

out vec4 outNoise;

const int NOISE_BLOCK = 4;
const float MEAN_FLOOR = 0.05;

void main() {
  // Unknown from one sample: never under any threshold.
  if (u_samples < 2.0) {
    outNoise = vec4(3.0e38, 0.0, 0.0, 1.0);
    return;
  }
  ivec2 block = ivec2(gl_FragCoord.xy) * NOISE_BLOCK;
  float area = float(u_scale * u_scale);
  float worst = 0.0;
  for (int by = 0; by < NOISE_BLOCK; by++) {
    for (int bx = 0; bx < NOISE_BLOCK; bx++) {
      ivec2 o = block + ivec2(bx, by);
      if (o.x >= u_outputSize.x || o.y >= u_outputSize.y) continue;
      float mean = 0.0;
      float variance = 0.0;
      for (int y = 0; y < u_scale; y++) {
        for (int x = 0; x < u_scale; x++) {
          ivec2 p = o * u_scale + ivec2(x, y);
          float luminanceSum = radianceLuminance(texelFetch(u_sum, p, 0).rgb);
          mean += luminanceSum / u_samples;
          variance += varianceOfMean(luminanceSum, texelFetch(u_moments, p, 0).r, u_samples);
        }
      }
      // The variance of a mean of `area` independent means.
      worst = max(worst, sqrt(max(variance, 0.0) / (area * area)) / max(mean / area, MEAN_FLOOR));
    }
  }
  outNoise = vec4(worst, 0.0, 0.0, 1.0);
}
