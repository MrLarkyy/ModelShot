// The triangle's corners in view space (triangleCornersVertex) and the pixel centre's ray against its plane: the exact
// depth key and the silhouette test of raster MSAA frames read them.
uniform mat4 u_inverseProjection;
#include "viewport"
flat in vec3 v_corner0;
flat in vec3 v_corner1;
flat in vec3 v_corner2;

// The ray through the pixel centre in view space, from the near plane toward the far plane.
void pixelRay(out vec3 origin, out vec3 dir) {
  vec2 ndc = gl_FragCoord.xy / u_viewportSize * 2.0 - 1.0;
  vec4 nearPoint = u_inverseProjection * vec4(ndc, -1.0, 1.0);
  vec4 farPoint = u_inverseProjection * vec4(ndc, 1.0, 1.0);
  origin = nearPoint.xyz / nearPoint.w;
  dir = farPoint.xyz / farPoint.w - origin;
}

// Distance along dir from origin to the triangle's plane; false for a ray parallel to it.
bool planeHit(vec3 origin, vec3 dir, vec3 n, out vec3 hit) {
  float facing = dot(n, dir);
  if (abs(facing) <= 1.0e-12 * dot(n, n) * dot(dir, dir)) return false;
  hit = origin + dir * (dot(n, v_corner0 - origin) / facing);
  return true;
}

// Per edge i (corner i to corner i + 1) how far inside it p lies, times |n| and the edge's length: negative outside.
vec3 edgeSides(vec3 p, vec3 n) {
  return vec3(dot(cross(v_corner1 - v_corner0, p - v_corner0), n), dot(cross(v_corner2 - v_corner1, p - v_corner1), n),
    dot(cross(v_corner0 - v_corner2, p - v_corner2), n));
}

// Bits of the edges the point lies outside of (or on), by a small margin.
int edgesCrossed(vec3 p, vec3 n) {
  float margin = 1.0e-4 * dot(n, n);
  vec3 sides = edgeSides(p, n);
  int crossed = 0;
  if (sides.x <= margin) crossed |= 1;
  if (sides.y <= margin) crossed |= 2;
  if (sides.z <= margin) crossed |= 4;
  return crossed;
}
