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
#include "triangleCorners"
in vec3 v_viewPosition;
// Bit i: edge i (corner i to corner i + 1) is shared with a coplanar triangle (exactEdgeWords).
flat in uint v_sharedEdges;

float depthPerPixel;

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
  vec3 origin;
  vec3 dir;
  pixelRay(origin, dir);
  vec3 n = cross(v_corner1 - v_corner0, v_corner2 - v_corner0);
  vec3 hit;
  float edgeBias = 0.0;
  if (!planeHit(origin, dir, n, hit)) {
    hit = v_viewPosition;
  } else {
    int outline = edgesCrossed(hit, n) & ~int(v_sharedEdges);
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
