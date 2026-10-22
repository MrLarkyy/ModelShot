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

// The denoiser's guides, once per request: the mean albedo and shading normal of what the camera rays of samples
// 0..GUIDE_RAYS-1 see in this pixel. Same keys, jitter and alpha acceptance as the trace, so the same texels: a cut-out
// texel is never seen, a partial one as often as those samples took it. An escaped ray sees the backdrop (albedo the
// backdrop colour, normal 0), one on the shadow catcher the backdrop facing up; the trace's radiance divided by this
// albedo is then 1 on the backdrop and the catcher's shade on the catcher.
uniform uint u_seed;

layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;

const uint GUIDE_RAYS = 8u;
// Dividing by the albedo must not blow up black texels; resolve multiplies by the same floored value.
const float ALBEDO_FLOOR = 0.01;

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec3 albedo = vec3(0.0);
  vec3 normal = vec3(0.0);
  for (uint i = 0u; i < GUIDE_RAYS; i++) {
    uint key = sampleHash(u_seed, i, uvec2(pixel));
    vec3 origin;
    vec3 direction;
    primaryRay(vec2(pixel) + vec2(unitRandom(key, 0u, 0u), unitRandom(key, 1u, 0u)), origin, direction);
    float depthScale = u_orthographic ? 1.0 : dot(direction, u_cameraForward);
    float tMin = u_near / depthScale;
    float tMax = u_far / depthScale;
    Hit hit;
    bool found = closestHit(origin, direction, tMin, tMax, depthScale, -1, key, FIRST_VERTEX_DIMENSION + 3u, hit);
    vec3 point;
    if (catcherHit(origin, direction, tMin, tMax, found, hit.t, point)) {
      albedo += backdropHere();
      normal += vec3(0.0, 1.0, 0.0);
    } else if (!found) {
      albedo += backdropHere();
    } else {
      Surface s = surfaceAt(hit);
      albedo += s.albedo;
      normal += s.normal;
    }
  }
  float rays = float(GUIDE_RAYS);
  outAlbedo = vec4(max(albedo / rays, vec3(ALBEDO_FLOOR)), 1.0);
  outNormal = vec4(normal / rays, 0.0);
}
