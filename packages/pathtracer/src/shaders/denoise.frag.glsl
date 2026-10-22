#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

#include "luminanceMoments"

// One iteration of an edge-avoiding à-trous filter (Dammertz et al., HPG 2010) with the edge-stopping weights of SVGF
// (Schied et al., HPG 2017) and none of its temporal part. It filters the demodulated radiance (the mean divided by the
// guide albedo), so the texels come back sharp when resolve multiplies the albedo in again and only the light is
// smoothed: across texels of one face, never across a change of albedo, normal or a luminance step beyond the noise.
// The first iteration reads the accumulation; each one widens the taps (u_step 1, 2, 4, 8, 16).
uniform highp sampler2D u_source;
uniform highp sampler2D u_sum;
uniform highp sampler2D u_moments;
uniform highp sampler2D u_albedo;
uniform highp sampler2D u_normal;
uniform bool u_first;
uniform float u_samples;
uniform int u_step;

// rgb: the filtered demodulated radiance; a: the variance of its luminance.
out vec4 outFiltered;

// The 5-tap B3 spline, by distance from the centre.
const float KERNEL[3] = float[3](0.375, 0.25, 0.0625);
const float SIGMA_LUMINANCE = 2.0;
// Added to the luminance scale: where no sample found the light (inside a cavity) the variance is 0, yet the mean is
// not exact; without it those pixels take nothing from the neighbours that did, and the cavity comes out too dark.
const float LUMINANCE_FLOOR = 0.02;
const float NORMAL_POWER = 128.0;
// Linear albedo distance at which the weight falls to 1/e: neighbouring texels of one material shade alike, a
// different surface does not.
const float SIGMA_ALBEDO = 0.5;
// Depth (SVGF): a neighbour weighs exp(-|dz| / (SIGMA_DEPTH * the change the centre's plane predicts + a share of z)),
// so a surface seen through a cut-out never blends with the face in front of it.
const float SIGMA_DEPTH = 1.0;
const float DEPTH_SHARE = 0.005;

ivec2 frameSize() {
  return textureSize(u_albedo, 0);
}

vec4 sourceAt(ivec2 p) {
  if (!u_first) return texelFetch(u_source, p, 0);
  float albedoLuminance = radianceLuminance(texelFetch(u_albedo, p, 0).rgb);
  vec3 sum = texelFetch(u_sum, p, 0).rgb;
  vec3 demodulated = sum / u_samples / texelFetch(u_albedo, p, 0).rgb;
  float variance = varianceOfMean(radianceLuminance(sum), texelFetch(u_moments, p, 0).r, u_samples);
  // One sample: unknown, taken as large as the value itself so the first preview filters broadly.
  float luminance = radianceLuminance(demodulated);
  variance = variance < 0.0 ? luminance * luminance : variance / (albedoLuminance * albedoLuminance);
  return vec4(demodulated, variance);
}

// The unit shading normal of the guide, or 0 where the guide rays saw only backdrop.
vec3 normalAt(ivec2 p) {
  vec3 n = texelFetch(u_normal, p, 0).xyz;
  float length2 = dot(n, n);
  return length2 > 1.0e-6 ? n * inversesqrt(length2) : vec3(0.0);
}

bool inside(ivec2 p, ivec2 size) {
  return p.x >= 0 && p.y >= 0 && p.x < size.x && p.y < size.y;
}

float depthAt(ivec2 p, ivec2 size) {
  return texelFetch(u_normal, clamp(p, ivec2(0), size - 1), 0).w;
}

// The centre's depth change per pixel in x and y, the smaller one-sided difference, so a pixel beside a silhouette
// takes the slope of its own surface.
vec2 depthSlope(ivec2 p, ivec2 size, float z) {
  vec2 slope;
  for (int axis = 0; axis < 2; axis++) {
    ivec2 d = axis == 0 ? ivec2(1, 0) : ivec2(0, 1);
    slope[axis] = min(abs(depthAt(p + d, size) - z), abs(z - depthAt(p - d, size)));
  }
  return slope;
}

// The centre's luminance variance through a 3 x 3 Gaussian, so one lucky sample count does not pin the weight.
float centreVariance(ivec2 p, ivec2 size) {
  float sum = 0.0;
  float weights = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 q = p + ivec2(dx, dy);
      if (!inside(q, size)) continue;
      float w = (dx == 0 ? 0.5 : 0.25) * (dy == 0 ? 0.5 : 0.25);
      sum += w * sourceAt(q).a;
      weights += w;
    }
  }
  return sum / weights;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = frameSize();
  vec4 centre = sourceAt(p);
  vec3 albedo = texelFetch(u_albedo, p, 0).rgb;
  vec3 normal = normalAt(p);
  bool backdrop = normal == vec3(0.0);
  float depth = depthAt(p, size);
  vec2 slope = depthSlope(p, size, depth);
  float luminance = radianceLuminance(centre.rgb);
  float luminanceScale = SIGMA_LUMINANCE * sqrt(max(centreVariance(p, size), 0.0)) + LUMINANCE_FLOOR;
  vec3 filtered = vec3(0.0);
  float weights = 0.0;
  float variance = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 q = p + ivec2(dx, dy) * u_step;
      if (!inside(q, size)) continue;
      bool isCentre = dx == 0 && dy == 0;
      vec4 c = isCentre ? centre : sourceAt(q);
      float w = KERNEL[abs(dx)] * KERNEL[abs(dy)];
      if (!isCentre) {
        vec3 n = normalAt(q);
        bool otherBackdrop = n == vec3(0.0);
        float wNormal = backdrop || otherBackdrop ? (backdrop == otherBackdrop ? 1.0 : 0.0)
                                                  : pow(clamp(dot(normal, n), 0.0, 1.0), NORMAL_POWER);
        vec3 da = albedo - texelFetch(u_albedo, q, 0).rgb;
        float wAlbedo = exp(-dot(da, da) / (SIGMA_ALBEDO * SIGMA_ALBEDO));
        float wLuminance = exp(-abs(luminance - radianceLuminance(c.rgb)) / luminanceScale);
        float expected = SIGMA_DEPTH * dot(slope, abs(vec2(dx, dy))) * float(u_step) + DEPTH_SHARE * depth + 1.0e-6;
        float wDepth = backdrop ? 1.0 : exp(-abs(depth - depthAt(q, size)) / expected);
        w *= wNormal * wAlbedo * wLuminance * wDepth;
      }
      filtered += w * c.rgb;
      weights += w;
      variance += w * w * max(c.a, 0.0);
    }
  }
  outFiltered = vec4(filtered / weights, variance / (weights * weights));
}
