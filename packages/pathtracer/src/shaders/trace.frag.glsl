#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

#include "rng"
#include "lightRig"
#include "pathSampling"
#include "keyLight"
#include "shadowCatcher"
#include "backdrop"
#include "primaryRay"
#include "bvhTraverse"
#include "cameraCatcher"
#include "luminanceMoments"

// The running sum of earlier samples; this pass writes it plus one new sample (AccumulationTargets).
uniform highp sampler2D u_previous;
// Denoise or a noise threshold: the same for the sum of the samples' squared luminance, in a second target.
uniform bool u_moments;
uniform highp sampler2D u_previousMoments;
// A transparent request: the same for each sample's coverage and its square, in a third target, and no backdrop in the
// radiance.
uniform bool u_transparent;
uniform highp sampler2D u_previousCoverage;
uniform uint u_seed;
uniform uint u_sample;
uniform int u_maxBounces;

layout(location = 0) out vec4 outSum;
layout(location = 1) out float outMoments;
layout(location = 2) out vec2 outCoverage;

const int MAX_BOUNCES = 16;
const int ROULETTE_FROM = 3;

// The catcher point's shade of the backdrop: one key ray in the cone and one cosine-weighted fill ray (escaped: the
// environment) through catcherShade, which is affine in both, so the mean over samples is the shade of the preview's
// baked means. The catcher is invisible to every other ray.
float catcherShadeAt(uint key, uint dimension, vec3 point) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 origin = leave(point, up);
  vec3 cone = keyConeDirection(unitRandom(key, dimension + 4u, 0u), unitRandom(key, dimension + 5u, 0u));
  float keyT = shadowTransmittance(origin, cone, -1);
  vec3 d = cosineDirection(up, unitRandom(key, dimension, 0u), unitRandom(key, dimension + 1u, 0u));
  Hit blocker;
  vec3 fill = closestHit(origin, d, 0.0, 3.0e38, 1.0, -1, key, dimension + 2u, blocker) ? vec3(0.0)
                                                                                        : environmentRadiance(d);
  return catcherShade(fill, keyT, point.xz, u_catcherRect);
}

// One path: the camera ray through a jittered point of the pixel (a box filter: texel edges come out area-averaged),
// then Lambert bounces. At every hit: emission and the key light through a shadow ray in its cone; at the camera hit also
// the unshadowed fill and rim accents, the rim seen back along the camera ray (no ray, so no random dimension of their
// own); on escape the environment (lightRig), whose cosine integral is the preview's fill. A camera ray that escapes
// shows the backdrop at its pixel, or the shadow catcher. Transparent: such a ray adds no radiance, and coverage is 0
// there, 1 - shade on the catcher (unclamped, so the mean stays affine: radiance + backdrop x (1 - coverage) is the
// opaque mean) and 1 where it met a texel it accepted.
vec3 tracePath(uint key, vec2 pixel, out float coverage) {
  vec3 origin;
  vec3 direction;
  primaryRay(pixel + vec2(unitRandom(key, 0u, 0u), unitRandom(key, 1u, 0u)), origin, direction);
  float depthScale = u_orthographic ? 1.0 : dot(direction, u_cameraForward);
  // Clip planes are distances along the view axis, as in the preview.
  float tMin = u_near / depthScale;
  float tMax = u_far / depthScale;
  int skip = -1;
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  coverage = 1.0;
  for (int pathVertex = 0; pathVertex <= MAX_BOUNCES; pathVertex++) {
    uint dimension = FIRST_VERTEX_DIMENSION + uint(pathVertex) * DIMENSIONS_PER_VERTEX;
    Hit hit;
    bool found = closestHit(origin, direction, tMin, tMax, depthScale, skip, key, dimension + 3u, hit, pathVertex == 0);
    if (pathVertex == 0) {
      vec3 point;
      if (catcherHit(origin, direction, tMin, tMax, found, hit.t, point)) {
        float shade = catcherShadeAt(key, dimension, point);
        if (!u_transparent) return backdropHere() * shade;
        coverage = 1.0 - shade;
        return vec3(0.0);
      }
      if (!found && u_transparent) {
        coverage = 0.0;
        break;
      }
    }
    if (!found) {
      radiance += throughput * (pathVertex == 0 ? backdropHere() : environmentRadiance(direction));
      break;
    }
    Surface s = surfaceAt(hit);
    radiance += throughput * s.emission;
    // The key is a light of irradiance pi * u_lookKeyColor: Lambert albedo / pi times that is the preview's term, times the
    // share of its disc the shadow ray sees.
    float cosKey = dot(s.normal, u_lookKeyDirection);
    if (cosKey > 0.0 && dot(s.side, u_lookKeyDirection) > 0.0) {
      vec3 cone = keyConeDirection(unitRandom(key, dimension + 4u, 0u), unitRandom(key, dimension + 5u, 0u));
      float visible = shadowTransmittance(leave(s.position, s.side), cone, hit.triangle);
      radiance += throughput * s.albedo * u_lookKeyColor * (cosKey * visible);
    }
    // Only where the camera sees the surface: unshadowed, it would light faces the rig hides and bounce out of them; the
    // preview has no accent bounce either.
    if (pathVertex == 0) radiance += s.albedo * fillLight(s.normal) + rimLight(s.normal, -direction, s.albedo);
    if (pathVertex >= u_maxBounces) break;
    vec3 next = aboveSurface(
      cosineDirection(s.normal, unitRandom(key, dimension, 0u), unitRandom(key, dimension + 1u, 0u)), s.side);
    if (dot(next, s.side) <= 0.0) break;
    // Lambert with cosine sampling: albedo / pi * cos / (cos / pi).
    throughput *= s.albedo;
    if (pathVertex + 1 >= ROULETTE_FROM) {
      float survive = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.05, 1.0);
      if (unitRandom(key, dimension + 2u, 0u) >= survive) break;
      throughput /= survive;
    }
    origin = leave(s.position, s.side);
    direction = next;
    tMin = 0.0;
    tMax = 3.0e38;
    depthScale = 1.0;
    skip = hit.triangle;
  }
  return radiance;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 sum = texelFetch(u_previous, pixel, 0);
  float coverage;
  vec3 radiance = tracePath(sampleHash(u_seed, u_sample, uvec2(pixel)), vec2(pixel), coverage);
  // One bad sample must not poison the sum for good. Its coverage stays: a black sample, as the opaque sum takes it.
  if (any(isnan(radiance)) || any(isinf(radiance))) radiance = vec3(0.0);
  if (isnan(coverage) || isinf(coverage)) coverage = 1.0;
  // rgb: the radiance sum; a: the traversals stopped by the node cap so far (present reads rgb only).
  outSum = vec4(sum.rgb + radiance, sum.a + float(cappedTraversals));
  if (u_moments) {
    float luminance = radianceLuminance(radiance);
    outMoments = texelFetch(u_previousMoments, pixel, 0).r + luminance * luminance;
  } else {
    outMoments = 0.0;
  }
  outCoverage = u_transparent ? texelFetch(u_previousCoverage, pixel, 0).rg + vec2(coverage, coverage * coverage) : vec2(0.0);
}
