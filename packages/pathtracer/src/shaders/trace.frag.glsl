#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

#include "rng"
#include "lightRig"
#include "primaryRay"
#include "bvhTraverse"

// The running sum of earlier samples; this pass writes it plus one new sample (AccumulationTargets).
uniform highp sampler2D u_previous;
uniform uint u_seed;
uniform uint u_sample;
uniform int u_maxBounces;
uniform vec3 u_background;

out vec4 outSum;

const int MAX_BOUNCES = 16;
const int ROULETTE_FROM = 3;
// Random dimensions: 0-1 the pixel jitter; then per path vertex the bounce direction (2), Russian roulette and the
// acceptance of partial texels.
const uint FIRST_VERTEX_DIMENSION = 2u;
const uint DIMENSIONS_PER_VERTEX = 4u;

// Cosine-weighted direction around the unit normal n; orthonormal basis of Duff et al., JCGT 2017.
vec3 cosineDirection(vec3 n, float u1, float u2) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float b = n.x * n.y * a;
  vec3 tangent = vec3(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  vec3 bitangent = vec3(b, s + n.y * n.y * a, -n.y);
  float r = sqrt(u1);
  float phi = 6.283185307179586 * u2;
  return normalize(tangent * (r * cos(phi)) + bitangent * (r * sin(phi)) + n * sqrt(max(0.0, 1.0 - u1)));
}

// Start of a ray leaving the surface at p on the side `side`, clear of it at float precision for the scene's scale.
vec3 leave(vec3 p, vec3 side) {
  float scale = max(1.0, max(abs(p.x), max(abs(p.y), abs(p.z))));
  return p + side * (1.0e-4 * scale);
}

// One path: the camera ray through a jittered point of the pixel (a box filter: texel edges come out area-averaged),
// then Lambert bounces. At every hit: emission, the key light through a shadow ray, and on escape the environment
// (lightRig), whose cosine integral is the preview's fill. A camera ray that escapes shows the background.
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
    if (!closestHit(origin, direction, tMin, tMax, depthScale, skip, key, dimension + 3u, hit)) {
      radiance += throughput * (pathVertex == 0 ? u_background : environmentRadiance(direction));
      break;
    }
    Surface s = surfaceAt(hit);
    radiance += throughput * s.emission;
    // The key is a delta light of irradiance pi * KEY_COLOR: Lambert albedo / pi times that is the preview's term.
    float cosKey = dot(s.normal, KEY_DIRECTION);
    if (cosKey > 0.0 && dot(s.side, KEY_DIRECTION) > 0.0) {
      float visible = shadowTransmittance(leave(s.position, s.side), KEY_DIRECTION, hit.triangle);
      radiance += throughput * s.albedo * KEY_COLOR * (cosKey * visible);
    }
    if (pathVertex >= u_maxBounces) break;
    vec3 next = cosineDirection(s.normal, unitRandom(key, dimension, 0u), unitRandom(key, dimension + 1u, 0u));
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
