#version 300 es

// Six RGBA32F texels per triangle (one row each): p0 + material, p1 + double-sided, p2 + render order,
// uv0 + uv1, uv2, face UV rectangle.
uniform sampler2D u_triangles;
uniform int u_triangleCount;
uniform mat4 u_inverseViewProjection;
uniform vec3 u_eye;
uniform vec2 u_viewportSize;
uniform vec3 u_background;

out vec4 outColor;

const float DET_EPSILON = 1e-9;
const float MIN_T = 1e-4;
// Hits closer than this count as the same depth; render order breaks the tie.
const float TIE = 1e-4;
const float SHADOW_OFFSET = 1e-3;

vec4 fetchRow(int triangle, int k) {
  return texelFetch(u_triangles, ivec2(k, triangle), 0);
}

// Möller–Trumbore. `frontOnly` skips triangles seen from behind (clockwise on screen).
bool intersect(int triangle, vec3 origin, vec3 dir, bool frontOnly, out float t, out vec2 bary) {
  vec3 p0 = fetchRow(triangle, 0).xyz;
  vec3 e1 = fetchRow(triangle, 1).xyz - p0;
  vec3 e2 = fetchRow(triangle, 2).xyz - p0;
  vec3 pv = cross(dir, e2);
  float det = dot(e1, pv);
  if (frontOnly ? det <= DET_EPSILON : abs(det) <= DET_EPSILON) return false;
  float inv = 1.0 / det;
  vec3 tv = origin - p0;
  float u = dot(tv, pv) * inv;
  if (u < 0.0 || u > 1.0) return false;
  vec3 qv = cross(tv, e1);
  float v = dot(dir, qv) * inv;
  if (v < 0.0 || u + v > 1.0) return false;
  t = dot(e2, qv) * inv;
  bary = vec2(u, v);
  return t > MIN_T;
}

int materialOf(int triangle) {
  return int(fetchRow(triangle, 0).w);
}

vec4 texelAt(int triangle, vec2 bary) {
  vec4 uv01 = fetchRow(triangle, 3);
  vec2 uv2 = fetchRow(triangle, 4).xy;
  vec2 uv = uv01.xy * (1.0 - bary.x - bary.y) + uv01.zw * bary.x + uv2 * bary.y;
  return materialTexel(materialOf(triangle), uv, fetchRow(triangle, 5));
}

bool opaqueAt(int triangle, vec2 bary) {
  return !texelInvisible(materialOf(triangle), texelAt(triangle, bary).a);
}

bool shadowed(vec3 origin) {
  for (int i = 0; i < u_triangleCount; i++) {
    float t;
    vec2 bary;
    if (intersect(i, origin, u_toLight, false, t, bary) && opaqueAt(i, bary)) return true;
  }
  return false;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / u_viewportSize * 2.0 - 1.0;
  vec4 far = u_inverseViewProjection * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - u_eye);

  float best = 1e30;
  float bestOrder = 0.0;
  int hit = -1;
  vec2 hitBary = vec2(0.0);
  for (int i = 0; i < u_triangleCount; i++) {
    float t;
    vec2 bary;
    bool singleSided = fetchRow(i, 1).w < 0.5;
    if (!intersect(i, u_eye, dir, singleSided, t, bary)) continue;
    float order = fetchRow(i, 2).w;
    bool wins = t < best - TIE || (t <= best + TIE && order > bestOrder);
    if (!wins || !opaqueAt(i, bary)) continue;
    best = t;
    bestOrder = order;
    hit = i;
    hitBary = bary;
  }
  if (hit < 0) {
    outColor = vec4(u_background, 1.0);
    return;
  }

  vec3 p0 = fetchRow(hit, 0).xyz;
  vec3 normal = normalize(cross(fetchRow(hit, 1).xyz - p0, fetchRow(hit, 2).xyz - p0));
  if (dot(normal, dir) > 0.0) normal = -normal;
  vec3 point = u_eye + dir * best;
  float lit = shadowed(point + normal * SHADOW_OFFSET) ? 0.0 : 1.0;
  outColor = vec4(shade(texelAt(hit, hitBary).rgb, normal, lit), 1.0);
}
