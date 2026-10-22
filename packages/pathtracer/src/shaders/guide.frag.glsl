#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

#include "rng"
#include "backdrop"
#include "primaryRay"
#include "bvhTraverse"
#include "cameraCatcher"

// The denoiser's guides, once per request: the mean albedo, shading normal and view depth of what camera rays see in
// this pixel, converged rather than what the request's few samples happened to draw. The rays go through the points of
// a (0,2)-sequence (Van der Corput by Sobol', rotated per pixel), so a texel edge's coverage is close to exact after
// u_guideRays of them; each one accepts partial texels with the trace's rule and the key of sample i, so a cut-out
// texel is never seen and a partial one as often as its alpha, and a pixel that met a partial texel goes on to
// u_partialGuideRays rays, as the sequence stays stratified. The denoiser divides the radiance by this albedo and
// resolve multiplies it back in: what the samples' coverage got wrong becomes noise in the quotient, which the filter
// removes. An escaped ray sees the backdrop (albedo the backdrop colour, normal 0, no depth), one on the shadow catcher
// the backdrop facing up; the trace's radiance divided by this albedo is then 1 on the backdrop and the catcher's shade
// on the catcher.
uniform uint u_seed;
uniform uint u_guideRays;
uniform uint u_partialGuideRays;

layout(location = 0) out vec4 outAlbedo;
// xyz: the mean normal (0 where every ray escaped); w: the mean view depth of the rays that met something, else 0.
layout(location = 1) out vec4 outNormal;

// Dividing by the albedo must not blow up black texels; resolve multiplies by the same floored value.
const float ALBEDO_FLOOR = 0.01;
// Keys the per-pixel rotation of the points apart from every sample's key.
const uint ROTATION_SAMPLE = 0xffffffffu;

// Van der Corput radical inverse in base 2 (GLSL ES 3.00 has no bitfieldReverse).
float vanDerCorput(uint v) {
  v = ((v >> 1u) & 0x55555555u) | ((v & 0x55555555u) << 1u);
  v = ((v >> 2u) & 0x33333333u) | ((v & 0x33333333u) << 2u);
  v = ((v >> 4u) & 0x0F0F0F0Fu) | ((v & 0x0F0F0F0Fu) << 4u);
  v = ((v >> 8u) & 0x00FF00FFu) | ((v & 0x00FF00FFu) << 8u);
  v = (v >> 16u) | (v << 16u);
  return float(v >> 8u) * (1.0 / 16777216.0);
}

// The second dimension of Sobol's sequence: with vanDerCorput a (0,2)-sequence, stratified at every power of 2.
float sobol(uint i) {
  uint result = 0u;
  for (uint v = 0x80000000u; i != 0u; i >>= 1u, v ^= v >> 1u) {
    if ((i & 1u) != 0u) result ^= v;
  }
  return float(result >> 8u) * (1.0 / 16777216.0);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec3 albedo = vec3(0.0);
  vec3 normal = vec3(0.0);
  float depth = 0.0;
  float hits = 0.0;
  uint rotationKey = sampleHash(u_seed, ROTATION_SAMPLE, uvec2(pixel));
  vec2 rotation = vec2(unitRandom(rotationKey, 0u, 0u), unitRandom(rotationKey, 1u, 0u));
  uint rays = u_guideRays;
  bool partial = false;
  for (uint i = 0u; i < rays; i++) {
    uint key = sampleHash(u_seed, i, uvec2(pixel));
    vec2 point = fract(vec2(vanDerCorput(i), sobol(i)) + rotation);
    vec3 origin;
    vec3 direction;
    primaryRay(vec2(pixel) + point, origin, direction);
    float depthScale = u_orthographic ? 1.0 : dot(direction, u_cameraForward);
    float tMin = u_near / depthScale;
    float tMax = u_far / depthScale;
    Hit hit;
    bool found = closestHit(origin, direction, tMin, tMax, depthScale, -1, key, FIRST_VERTEX_DIMENSION + 3u, hit);
    vec3 onCatcher;
    float z = -1.0;
    bool partialHit = false;
    if (catcherHit(origin, direction, tMin, tMax, found, hit.t, onCatcher)) {
      albedo += backdropHere();
      normal += vec3(0.0, 1.0, 0.0);
      z = dot(onCatcher - u_cameraPosition, u_cameraForward);
    } else if (!found) {
      albedo += backdropHere();
    } else {
      Surface s = surfaceAt(hit);
      albedo += s.albedo;
      normal += s.normal;
      z = dot(s.position - u_cameraPosition, u_cameraForward);
      float alpha;
      int slot = int(dataTexel(u_triPositions, hit.triangle * TRIANGLE_POSITION_TEXELS).w);
      partialHit = hitCoverage(hit.triangle, slot, hit.barycentric, alpha) == COVERAGE_PARTIAL;
    }
    if (z >= 0.0) {
      depth += z;
      hits += 1.0;
    }
    partial = partial || partialHit;
    if (i + 1u == rays && partial) rays = max(rays, u_partialGuideRays);
  }
  float count = float(rays);
  outAlbedo = vec4(max(albedo / count, vec3(ALBEDO_FLOOR)), 1.0);
  outNormal = vec4(normal / count, hits > 0.0 ? depth / hits : 0.0);
}
