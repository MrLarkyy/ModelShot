#version 300 es

// Nine RGBA32F texels per triangle (one row each): p0 + material, p1 + double-sided, p2 + render order,
// uv0 + uv1, uv2, face UV rectangle, n0, n1, n2 (vertex normals).
uniform sampler2D u_triangles;
uniform int u_triangleCount;
uniform vec3 u_background;

out vec4 outColor;

const float DET_EPSILON = 1e-9;
const float MIN_T = 1e-4;
// Which side of a triangle a ray may hit: its front as seen along the ray, its back (the front as seen by a ray
// travelling the other way), or either.
const int SIDE_FRONT = 1;
const int SIDE_BACK = -1;
const int SIDE_ANY = 0;

vec4 fetchRow(int triangle, int k) {
  return texelFetch(u_triangles, ivec2(k, triangle), 0);
}

// Möller–Trumbore; det > 0 means the ray meets the counter-clockwise (front) side.
bool intersect(int triangle, vec3 origin, vec3 dir, int side, out float t, out vec2 bary) {
  vec3 p0 = fetchRow(triangle, 0).xyz;
  vec3 e1 = fetchRow(triangle, 1).xyz - p0;
  vec3 e2 = fetchRow(triangle, 2).xyz - p0;
  vec3 pv = cross(dir, e2);
  float det = dot(e1, pv);
  if (side == SIDE_FRONT ? det <= DET_EPSILON : side == SIDE_BACK ? det >= -DET_EPSILON : abs(det) <= DET_EPSILON) {
    return false;
  }
  float inv = 1.0 / det;
  vec3 tv = origin - p0;
  float u = dot(tv, pv) * inv;
  if (u < 0.0 || u > 1.0) return false;
  vec3 qv = cross(tv, e1);
  float v = dot(dir, qv) * inv;
  if (v < 0.0 || u + v > 1.0) return false;
  t = planeDistance(origin, dir, p0, e1, e2);
  bary = vec2(u, v);
  return t > MIN_T;
}

bool singleSided(int triangle) {
  return fetchRow(triangle, 1).w < 0.5;
}

int materialOf(int triangle) {
  return int(fetchRow(triangle, 0).w);
}

vec3 weights(vec2 bary) {
  return vec3(1.0 - bary.x - bary.y, bary.x, bary.y);
}

vec4 texelAt(int triangle, vec2 bary) {
  vec3 w = weights(bary);
  vec4 uv01 = fetchRow(triangle, 3);
  vec2 uv = uv01.xy * w.x + uv01.zw * w.y + fetchRow(triangle, 4).xy * w.z;
  return materialTexel(materialOf(triangle), uv, fetchRow(triangle, 5));
}

bool opaqueAt(int triangle, vec2 bary) {
  return !texelInvisible(materialOf(triangle), texelAt(triangle, bary).a);
}

// A shadow ray counts as travelling from the light: a single-sided triangle blocks it only if its front faces the
// light, i.e. this ray (toward the light) meets its back.
bool shadowed(vec3 origin) {
  for (int i = 0; i < u_triangleCount; i++) {
    float t;
    vec2 bary;
    int side = singleSided(i) ? SIDE_BACK : SIDE_ANY;
    if (intersect(i, origin, u_toLight, side, t, bary) && opaqueAt(i, bary)) return true;
  }
  return false;
}

void main() {
  vec3 dir = cameraRayDirection(gl_FragCoord.xy);

  // The smallest renderOrderKey wins, the first hit at an exactly equal key; the raster's depth is the same key.
  float bestKey = 1e30;
  float best = 0.0;
  int hit = -1;
  vec2 hitBary = vec2(0.0);
  for (int i = 0; i < u_triangleCount; i++) {
    float t;
    vec2 bary;
    if (!intersect(i, u_eye, dir, singleSided(i) ? SIDE_FRONT : SIDE_ANY, t, bary)) continue;
    float key = renderOrderKey(t, fetchRow(i, 2).w);
    if (key >= bestKey || !opaqueAt(i, bary)) continue;
    bestKey = key;
    best = t;
    hit = i;
    hitBary = bary;
  }
  if (hit < 0) {
    outColor = vec4(u_background, 1.0);
    return;
  }

  vec3 p0 = fetchRow(hit, 0).xyz;
  vec3 geometric = normalize(cross(fetchRow(hit, 1).xyz - p0, fetchRow(hit, 2).xyz - p0));
  vec3 w = weights(hitBary);
  vec3 normal = normalize(fetchRow(hit, 6).xyz * w.x + fetchRow(hit, 7).xyz * w.y + fetchRow(hit, 8).xyz * w.z);
  // Only double-sided triangles are hit from behind: shade their back with the flipped normal, as the raster does.
  if (dot(geometric, dir) > 0.0) {
    geometric = -geometric;
    normal = -normal;
  }
  vec3 point = u_eye + dir * best;
  float lit = shadowed(point + geometric * SHADOW_NORMAL_OFFSET) ? 0.0 : 1.0;
  outColor = vec4(shade(texelAt(hit, hitBary).rgb, normal, lit), 1.0);
}
