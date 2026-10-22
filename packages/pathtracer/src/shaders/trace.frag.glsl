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
#include "primaryRay"
#include "bvhTraverse"

// The running sum of earlier samples; this pass writes it plus one new sample (AccumulationTargets).
uniform highp sampler2D u_previous;
uniform uint u_seed;
uniform uint u_sample;
uniform int u_maxBounces;
uniform vec3 u_background;
// Shadow catcher (shadowCatcherPlane.ts of the realtime renderer): a plane at height u_catcherY over the rectangle
// u_catcherRect = [minX, minZ, maxX, maxZ], seen only by camera rays from above.
uniform bool u_catcherOn;
uniform float u_catcherY;
uniform vec4 u_catcherRect;

out vec4 outSum;

const int MAX_BOUNCES = 16;
const int ROULETTE_FROM = 3;
// Random dimensions: 0-1 the pixel jitter; then per path vertex (offsets from its first dimension):
//   +0, +1  bounce direction         +2  Russian roulette        +3  acceptance of partial texels
//   +4, +5  key light cone direction
// A camera ray that meets the shadow catcher ends its path at vertex 0, so the catcher reuses vertex 0's offsets:
// +0, +1 its fill direction, +4, +5 its key ray, and +2 (roulette, unused there) the acceptance of partial texels by
// its fill ray. That one must not be +3: the camera ray drew +3 for the same triangles, so a fill ray through a partial
// texel the camera looked through would always pass it.
const uint FIRST_VERTEX_DIMENSION = 2u;
const uint DIMENSIONS_PER_VERTEX = 6u;

// Where a camera ray meets the catcher in front of everything else, or false.
bool catcherHit(vec3 origin, vec3 direction, float tMin, float tMax, bool modelHit, float modelT, out vec3 point) {
  point = vec3(0.0);
  if (!u_catcherOn || direction.y >= 0.0) return false;
  float t = (u_catcherY - origin.y) / direction.y;
  if (t < tMin || t > tMax || (modelHit && t >= modelT)) return false;
  point = origin + direction * t;
  return point.x >= u_catcherRect.x && point.x <= u_catcherRect.z && point.z >= u_catcherRect.y &&
    point.z <= u_catcherRect.w;
}

// The catcher point's backdrop: one key ray in the cone and one cosine-weighted fill ray (escaped: the environment),
// shaded by catcherShade, which is affine in both, so the mean over samples is the shade of the preview's baked means.
// The catcher is invisible to every other ray.
vec3 shadeCatcher(uint key, uint dimension, vec3 point) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 origin = leave(point, up);
  vec3 cone = keyConeDirection(unitRandom(key, dimension + 4u, 0u), unitRandom(key, dimension + 5u, 0u));
  float keyT = shadowTransmittance(origin, cone, -1);
  vec3 d = cosineDirection(up, unitRandom(key, dimension, 0u), unitRandom(key, dimension + 1u, 0u));
  Hit blocker;
  vec3 fill = closestHit(origin, d, 0.0, 3.0e38, 1.0, -1, key, dimension + 2u, blocker) ? vec3(0.0)
                                                                                        : environmentRadiance(d);
  return u_background * catcherShade(fill, keyT, point.xz, u_catcherRect);
}

// One path: the camera ray through a jittered point of the pixel (a box filter: texel edges come out area-averaged),
// then Lambert bounces. At every hit: emission, the key light through a shadow ray in its cone, and on escape the
// environment (lightRig), whose cosine integral is the preview's fill. A camera ray that escapes shows the background,
// or the shadow catcher under the model.
vec3 tracePath(uint key, vec2 pixel) {
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
  for (int pathVertex = 0; pathVertex <= MAX_BOUNCES; pathVertex++) {
    uint dimension = FIRST_VERTEX_DIMENSION + uint(pathVertex) * DIMENSIONS_PER_VERTEX;
    Hit hit;
    bool found = closestHit(origin, direction, tMin, tMax, depthScale, skip, key, dimension + 3u, hit, pathVertex == 0);
    if (pathVertex == 0) {
      vec3 point;
      if (catcherHit(origin, direction, tMin, tMax, found, hit.t, point)) return shadeCatcher(key, dimension, point);
    }
    if (!found) {
      radiance += throughput * (pathVertex == 0 ? u_background : environmentRadiance(direction));
      break;
    }
    Surface s = surfaceAt(hit);
    radiance += throughput * s.emission;
    // The key is a light of irradiance pi * KEY_COLOR: Lambert albedo / pi times that is the preview's term, times the
    // share of its disc the shadow ray sees.
    float cosKey = dot(s.normal, KEY_DIRECTION);
    if (cosKey > 0.0 && dot(s.side, KEY_DIRECTION) > 0.0) {
      vec3 cone = keyConeDirection(unitRandom(key, dimension + 4u, 0u), unitRandom(key, dimension + 5u, 0u));
      float visible = shadowTransmittance(leave(s.position, s.side), cone, hit.triangle);
      radiance += throughput * s.albedo * KEY_COLOR * (cosKey * visible);
    }
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
  vec3 radiance = tracePath(sampleHash(u_seed, u_sample, uvec2(pixel)), vec2(pixel));
  // One bad sample must not poison the sum for good.
  if (any(isnan(radiance)) || any(isinf(radiance))) radiance = vec3(0.0);
  // rgb: the radiance sum; a: the traversals stopped by the node cap so far (present reads rgb only).
  outSum = vec4(sum.rgb + radiance, sum.a + float(cappedTraversals));
}
