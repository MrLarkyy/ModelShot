// Stack traversal of the BVH (buildBvh.ts layout) with the scene format's rules for every ray: an invisible texel is
// skipped as if absent, a single-sided face counts only from its front (shadow rays: only if its front faces the
// light), and camera and bounce rays keep the hit with the smallest render-order key.
#include "rng"
#include "surfaceHit"

// The build keeps leaves at depth 31 or less: at most one pending sibling per level plus two children.
const int BVH_STACK_SIZE = 32;

uniform float u_maxRenderOrder;
uniform float u_orderTie;
uniform float u_backSideOrder;

vec3 safeInverse(vec3 d) {
  // A zero component would give 0 * inf = NaN at a slab boundary.
  vec3 tiny = vec3(1.0e-30);
  return 1.0 / mix(d, sign(d + tiny) * tiny, lessThan(abs(d), tiny));
}

bool boxHit(vec3 lo, vec3 hi, vec3 origin, vec3 inverseDirection, float tMin, float tMax, out float entry) {
  vec3 t0 = (lo - origin) * inverseDirection;
  vec3 t1 = (hi - origin) * inverseDirection;
  vec3 tNear = min(t0, t1);
  vec3 tFar = max(t0, t1);
  entry = max(max(tNear.x, tNear.y), max(tNear.z, tMin));
  float exit = min(min(tFar.x, tFar.y), min(tFar.z, tMax));
  return entry <= exit;
}

// Möller-Trumbore. back: the ray meets the clockwise side (dot(direction, cross(e1, e2)) > 0).
bool triangleHit(vec3 origin, vec3 direction, vec3 p0, vec3 p1, vec3 p2, out float t, out vec2 b, out bool back) {
  vec3 e1 = p1 - p0;
  vec3 e2 = p2 - p0;
  vec3 p = cross(direction, e2);
  float det = dot(e1, p);
  t = 0.0;
  b = vec2(0.0);
  back = det < 0.0;
  if (det == 0.0) return false;
  float inverseDet = 1.0 / det;
  vec3 s = origin - p0;
  b.x = dot(s, p) * inverseDet;
  if (b.x < 0.0 || b.x > 1.0) return false;
  vec3 q = cross(s, e1);
  b.y = dot(direction, q) * inverseDet;
  if (b.y < 0.0 || b.x + b.y > 1.0) return false;
  t = dot(e2, q) * inverseDet;
  return true;
}

// The visible hit with the smallest key t * depthScale - (order + back side) * tie in [tMin, tMax], skipping the
// triangle skip (the one the ray leaves). depthScale is the cosine to the view axis for camera rays, 1 otherwise. A
// partial texel is taken with probability alpha (stochastic transparency), drawn per triangle in alphaDimension.
bool closestHit(
  vec3 origin,
  vec3 direction,
  float tMin,
  float tMax,
  float depthScale,
  int skip,
  uint sampleKey,
  uint alphaDimension,
  out Hit hit
) {
  hit = Hit(-1, 0.0, vec2(0.0), false);
  if (u_nodeCount == 0) return false;
  vec3 inverseDirection = safeInverse(direction);
  // No node whose entry key is this far behind the best can win, whatever its orders (0 when every order is 0).
  float orderReach = u_maxRenderOrder * u_orderTie;
  float bestKey = 3.0e38;
  int stack[BVH_STACK_SIZE];
  int size = 1;
  stack[0] = 0;
  while (size > 0) {
    int node = stack[--size];
    vec4 a = dataTexel(u_nodes, node * NODE_TEXELS);
    vec4 b = dataTexel(u_nodes, node * NODE_TEXELS + 1);
    float entry;
    if (!boxHit(a.xyz, b.xyz, origin, inverseDirection, tMin, tMax, entry)) continue;
    if (entry * depthScale - orderReach > bestKey) continue;
    int info = int(b.w);
    int reference = int(a.w);
    if (info < 0) {
      // Inner node: visit the child on the near side of the split axis first.
      bool flip = direction[-info - 1] < 0.0;
      stack[size++] = flip ? node + 1 : reference;
      stack[size++] = flip ? reference : node + 1;
      continue;
    }
    for (int triangle = reference; triangle < reference + info; triangle++) {
      if (triangle == skip) continue;
      int base = triangle * TRIANGLE_POSITION_TEXELS;
      vec4 p0 = dataTexel(u_triPositions, base);
      vec4 p1 = dataTexel(u_triPositions, base + 1);
      vec4 p2 = dataTexel(u_triPositions, base + 2);
      float t;
      vec2 bary;
      bool back;
      if (!triangleHit(origin, direction, p0.xyz, p1.xyz, p2.xyz, t, bary, back)) continue;
      if (t < tMin || t > tMax) continue;
      if (back && p1.w < 0.5) continue;
      float order = p2.w + (back ? u_backSideOrder : 0.0);
      float key = t * depthScale - order * u_orderTie;
      if (key >= bestKey) continue;
      float alpha;
      int coverage = hitCoverage(triangle, int(p0.w), bary, alpha);
      if (coverage == COVERAGE_INVISIBLE) continue;
      if (coverage == COVERAGE_PARTIAL && unitRandom(sampleKey, alphaDimension, uint(triangle)) >= alpha) continue;
      bestKey = key;
      hit = Hit(triangle, t, bary, back);
    }
  }
  return hit.triangle >= 0;
}

// Light that reaches the light along direction from origin: 0 behind an opaque texel, times 1 - alpha for each
// partial texel crossed (order-independent). Render order does not apply to occlusion. A single-sided face blocks only
// when its front faces the light, i.e. when this ray, travelling toward the light, meets its back.
float shadowTransmittance(vec3 origin, vec3 direction, int skip) {
  if (u_nodeCount == 0) return 1.0;
  vec3 inverseDirection = safeInverse(direction);
  float transmittance = 1.0;
  int stack[BVH_STACK_SIZE];
  int size = 1;
  stack[0] = 0;
  while (size > 0) {
    int node = stack[--size];
    vec4 a = dataTexel(u_nodes, node * NODE_TEXELS);
    vec4 b = dataTexel(u_nodes, node * NODE_TEXELS + 1);
    float entry;
    if (!boxHit(a.xyz, b.xyz, origin, inverseDirection, 0.0, 3.0e38, entry)) continue;
    int info = int(b.w);
    int reference = int(a.w);
    if (info < 0) {
      stack[size++] = reference;
      stack[size++] = node + 1;
      continue;
    }
    for (int triangle = reference; triangle < reference + info; triangle++) {
      if (triangle == skip) continue;
      int base = triangle * TRIANGLE_POSITION_TEXELS;
      vec4 p0 = dataTexel(u_triPositions, base);
      vec4 p1 = dataTexel(u_triPositions, base + 1);
      vec4 p2 = dataTexel(u_triPositions, base + 2);
      float t;
      vec2 bary;
      bool back;
      if (!triangleHit(origin, direction, p0.xyz, p1.xyz, p2.xyz, t, bary, back)) continue;
      if (t <= 0.0) continue;
      if (!back && p1.w < 0.5) continue;
      float alpha;
      int coverage = hitCoverage(triangle, int(p0.w), bary, alpha);
      if (coverage == COVERAGE_OPAQUE) return 0.0;
      if (coverage == COVERAGE_PARTIAL) transmittance *= 1.0 - alpha;
    }
  }
  return transmittance;
}
