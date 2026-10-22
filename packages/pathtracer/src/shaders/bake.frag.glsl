#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
precision highp sampler2DArray;

#include "rng"
#include "lightRig"
#include "pathSampling"
#include "keyLight"
#include "bvhTraverse"

// One sample of the light bake per lightmap texel, with the path tracer's own rules for every ray (bvhTraverse): the
// key's visibility through shadowTransmittance in the key cone, the fill as the environment along one cosine-weighted
// direction that escapes. No interreflection: the bake is what the preview's lighting lacks, occlusion. Pass sums:
// rgb the fill as a multiple of hemisphereFill(n), a the key visibility; texels of no chart add 1 (unbaked).

// The running sum of earlier samples (AccumulationTargets).
uniform highp sampler2D u_previous;
// Per lightmap texel its chart + 1 (chartTable.ts); the chart records, their triangle lists and the world charts'
// triangle corners in chart-local texels.
uniform highp usampler2D u_chartIndex;
uniform highp sampler2D u_charts;
uniform highp sampler2D u_chartTriangles;
uniform highp sampler2D u_chartCorners;
uniform uint u_seed;
uniform uint u_sample;
// The shadow catcher pass: texel (x, z) of a u_catcherSize grid over u_catcherRect at height u_catcherY.
uniform bool u_catcherPass;
// Test hook: write the traversals stopped at the node cap (bvhTraverse) instead of the light, to show none are.
uniform bool u_countCapped;
uniform float u_catcherY;
uniform vec4 u_catcherRect;
uniform vec2 u_catcherSize;

out vec4 outSum;

const int CHART_TEXELS = 4;
const int CHART_MODE_TEXEL = 0;
const int CHART_MODE_VERTEX = 1;
const int CHART_MODE_WORLD = 2;
const int CORNER_TEXELS = 2;
const int MAX_CHART_TRIANGLES = 32;
// Random dimensions: 0-1 the point in the texel, 2-3 the key cone, 4-5 the fill direction, 6 partial texels.
const uint KEY_DIMENSION = 2u;
const uint FILL_DIMENSION = 4u;
const uint ALPHA_DIMENSION = 6u;

vec2 cornerUv(int triangle, int corner) {
  int base = triangle * TRIANGLE_ATTRIBUTE_TEXELS;
  if (corner == 0) return vec2(dataTexel(u_triAttributes, base).w, dataTexel(u_triAttributes, base + 1).w);
  if (corner == 1) return vec2(dataTexel(u_triAttributes, base + 2).w, dataTexel(u_triAttributes, base + 3).x);
  return dataTexel(u_triAttributes, base + 3).yz;
}

// Weights of corners b and c of point p in triangle (a, b, c) (unclamped; zero area gives a large negative).
vec2 barycentric(vec2 a, vec2 b, vec2 c, vec2 p) {
  vec2 e1 = b - a;
  vec2 e2 = c - a;
  vec2 d = p - a;
  float det = e1.x * e2.y - e1.y * e2.x;
  if (abs(det) < 1.0e-20) return vec2(-1.0e9);
  return vec2(d.x * e2.y - d.y * e2.x, e1.x * d.y - e1.y * d.x) / det;
}

vec2 uvBarycentric(int triangle, vec2 uv) {
  return barycentric(cornerUv(triangle, 0), cornerUv(triangle, 1), cornerUv(triangle, 2), uv);
}

// The same for a world chart's triangle, whose corners the chart table lists in chart-local texels.
vec2 worldBarycentric(int corners, vec2 point) {
  vec4 ab = dataTexel(u_chartCorners, corners * CORNER_TEXELS);
  vec4 c = dataTexel(u_chartCorners, corners * CORNER_TEXELS + 1);
  return barycentric(ab.xy, ab.zw, c.xy, point);
}

int chartTriangle(int entry) {
  vec4 four = dataTexel(u_chartTriangles, entry / 4);
  return int(four[entry % 4]);
}

// The light of one surface point: rgb the fill over hemisphereFill(normal), a the key visibility.
vec4 bakePoint(vec3 position, vec3 normal, vec3 side, int skip, uint key) {
  vec3 origin = leave(position, side);
  float keyT = 0.0;
  if (dot(side, u_lookKeyDirection) > 0.0) {
    vec3 cone = keyConeDirection(unitRandom(key, KEY_DIMENSION, 0u), unitRandom(key, KEY_DIMENSION + 1u, 0u));
    keyT = shadowTransmittance(origin, cone, skip);
  }
  vec3 d = cosineDirection(normal, unitRandom(key, FILL_DIMENSION, 0u), unitRandom(key, FILL_DIMENSION + 1u, 0u));
  vec3 fill = vec3(0.0);
  if (dot(d, side) > 0.0) {
    Hit blocker;
    if (!closestHit(origin, d, 0.0, 3.0e38, 1.0, skip, key, ALPHA_DIMENSION, blocker)) fill = environmentRadiance(d);
  }
  return vec4(fill / hemisphereFill(normal), keyT);
}

vec4 bakeCatcher(ivec2 texel, uint key) {
  vec2 jitter = vec2(unitRandom(key, 0u, 0u), unitRandom(key, 1u, 0u));
  vec2 xz = u_catcherRect.xy + (vec2(texel) + jitter) / u_catcherSize * (u_catcherRect.zw - u_catcherRect.xy);
  vec3 up = vec3(0.0, 1.0, 0.0);
  return bakePoint(vec3(xz.x, u_catcherY, xz.y), up, up, -1, key);
}

vec4 bakeChart(ivec2 texel, uint key) {
  uint chart = texelFetch(u_chartIndex, texel, 0).r;
  if (chart == 0u) return vec4(1.0);
  int record = int(chart - 1u) * CHART_TEXELS;
  vec4 rect = dataTexel(u_charts, record);
  vec4 uvMap = dataTexel(u_charts, record + 1);
  vec4 info = dataTexel(u_charts, record + 2);
  vec4 extra = dataTexel(u_charts, record + 3);
  vec2 local = vec2(texel) - rect.xy;
  bool back = info.z > 0.0 && local.x >= rect.z;
  if (back) local.x -= rect.z;
  int first = int(info.x);
  int count = int(info.y);
  int triangle = -1;
  vec2 b = extra.xy;
  int mode = int(info.w);
  if (mode != CHART_MODE_VERTEX) {
    vec2 jitter = vec2(unitRandom(key, 0u, 0u), unitRandom(key, 1u, 0u));
    bool world = mode == CHART_MODE_WORLD;
    // Texel mode: the point's UV; world mode: the chart-local point itself.
    vec2 point = world ? local + jitter : uvMap.xy + (local + jitter) * uvMap.zw;
    int corners = int(uvMap.x);
    // The triangle holding the point, else the one it is nearest to inside (a texel sticking out of the face).
    float best = -3.0e38;
    for (int i = 0; i < MAX_CHART_TRIANGLES; i++) {
      if (i >= count) break;
      int candidate = chartTriangle(first + i);
      if (candidate < 0) continue;
      vec2 w = world ? worldBarycentric(corners + i, point) : uvBarycentric(candidate, point);
      float inside = min(min(w.x, w.y), 1.0 - w.x - w.y);
      if (inside > best) {
        best = inside;
        triangle = candidate;
        b = w;
      }
      if (inside >= 0.0) break;
    }
    b = clamp(b, 0.0, 1.0);
    float total = b.x + b.y;
    if (total > 1.0) b /= total;
  } else {
    triangle = chartTriangle(first);
  }
  if (triangle < 0) return vec4(1.0);
  Surface s = surfaceAt(Hit(triangle, 0.0, b, back));
  return bakePoint(s.position, s.normal, s.side, triangle, key);
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 sum = texelFetch(u_previous, texel, 0);
  // The catcher's texels draw other numbers than the model texels at the same coordinates.
  uvec2 stream = uvec2(texel) + (u_catcherPass ? uvec2(0u, 65536u) : uvec2(0u));
  uint key = sampleHash(u_seed, u_sample, stream);
  vec4 value = u_catcherPass ? bakeCatcher(texel, key) : bakeChart(texel, key);
  if (any(isnan(value)) || any(isinf(value))) value = vec4(1.0);
  outSum = sum + (u_countCapped ? vec4(float(cappedTraversals)) : value);
}
