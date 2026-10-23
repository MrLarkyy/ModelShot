// Exact depth-key variant: the fragment depth is the render-order key itself, computed per fragment from the pixel
// centre's ray and the triangle's plane (its three corners in view space, the same on all its vertices), so two
// triangulations of one plane agree to float precision instead of to the rasteriser's interpolation error. Where the
// hit leaves the triangle only across edges shared with a coplanar triangle (a quad's diagonal) it stays as it is: the
// plane is the same there. At an edge pixel whose hit lies outside an unshared edge (MSAA; a silhouette or a face's
// outline, where the extended plane may lie in front of or behind the faces that really cover the samples) the hit is
// moved to the nearest point of the crossed outline edges, which coincident faces share, so they still key alike; a
// back face there yields two pixels' worth of its depth change, as a slope-scaled offset would. Written as
// (key + offset) × scale (exactDepthRange); costs early depth testing and gives per-pixel MSAA depth.
uniform float u_orderPull;
uniform vec2 u_depthRange;
uniform mat4 u_inverseProjection;
// u_viewportSize: declared in the shading chunk, which every mesh pass includes first.
in vec3 v_viewPosition;
flat in vec3 v_corner0;
flat in vec3 v_corner1;
flat in vec3 v_corner2;
// Bit i: edge i (corner i to corner i + 1) is shared with a coplanar triangle (uploadExactGeometry).
flat in float v_sharedEdges;

float depthPerPixel;

// Distance along dir from origin to the triangle's plane; false for a ray parallel to it.
bool planeHit(vec3 origin, vec3 dir, vec3 n, out vec3 hit) {
  float facing = dot(n, dir);
  if (abs(facing) <= 1.0e-12 * dot(n, n) * dot(dir, dir)) return false;
  hit = origin + dir * (dot(n, v_corner0 - origin) / facing);
  return true;
}

// Bits of the edges the point lies outside of (or on), by a small margin.
int edgesCrossed(vec3 p, vec3 n) {
  float margin = 1.0e-4 * dot(n, n);
  int crossed = 0;
  if (dot(cross(v_corner1 - v_corner0, p - v_corner0), n) <= margin) crossed |= 1;
  if (dot(cross(v_corner2 - v_corner1, p - v_corner1), n) <= margin) crossed |= 2;
  if (dot(cross(v_corner0 - v_corner2, p - v_corner2), n) <= margin) crossed |= 4;
  return crossed;
}

vec3 nearestOnSegment(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  return a + ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1.0e-30), 0.0, 1.0);
}

// Nearest point to p on the edges in `edges` (bits as edgesCrossed).
vec3 nearestOnEdges(vec3 p, int edges) {
  vec3 best = p;
  float bestDistance = 1.0e30;
  for (int i = 0; i < 3; i++) {
    if ((edges & (1 << i)) == 0) continue;
    vec3 a = i == 0 ? v_corner0 : i == 1 ? v_corner1 : v_corner2;
    vec3 b = i == 0 ? v_corner1 : i == 1 ? v_corner2 : v_corner0;
    vec3 q = nearestOnSegment(p, a, b);
    float d = dot(q - p, q - p);
    if (d < bestDistance) {
      bestDistance = d;
      best = q;
    }
  }
  return best;
}

// Called at the top of main, before any discard: derivatives are undefined in non-uniform control flow.
void prepareDepthKey() {
  depthPerPixel = fwidth(v_viewPosition.z);
}

void writeDepthKey() {
  vec2 ndc = gl_FragCoord.xy / u_viewportSize * 2.0 - 1.0;
  vec4 nearPoint = u_inverseProjection * vec4(ndc, -1.0, 1.0);
  vec4 farPoint = u_inverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 origin = nearPoint.xyz / nearPoint.w;
  vec3 dir = farPoint.xyz / farPoint.w - origin;
  vec3 n = cross(v_corner1 - v_corner0, v_corner2 - v_corner0);
  vec3 hit;
  float edgeBias = 0.0;
  if (!planeHit(origin, dir, n, hit)) {
    hit = v_viewPosition;
  } else {
    int outline = edgesCrossed(hit, n) & ~int(v_sharedEdges + 0.5);
    if (outline != 0) {
      vec3 snapped = nearestOnEdges(hit, outline);
      if (gl_FrontFacing) {
        // Capped at the outline: a sample the rasteriser gives this face just past its true edge (vertices are snapped
        // to the subpixel grid; at a grazing angle that is far along the plane) never keys deeper than the edge.
        if (-snapped.z < -hit.z) hit = snapped;
      } else {
        hit = snapped;
        edgeBias = 2.0 * depthPerPixel;
      }
    }
  }
  gl_FragDepth = clamp((-hit.z + edgeBias - u_orderPull + u_depthRange.x) * u_depthRange.y, 0.0, 1.0);
}
