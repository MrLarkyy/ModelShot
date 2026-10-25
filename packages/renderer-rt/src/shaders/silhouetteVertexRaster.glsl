// Raster variant: which of the triangle's edges are a silhouette from this eye, for silhouetteRaster.
#include "triangleCornersVertex"

// Bit i: edge i is open (exactEdgeWords) or its neighbour faces the other way as seen from the eye (u_lookEye: the
// eye, w 1, or the direction toward it, w 0), so nothing of the mesh lies just past it on screen.
flat out uint v_silhouetteEdges;
uniform vec4 u_lookEye;

// An octahedral unit vector from two snorm16 (exactEdgeWords).
vec3 octahedralNormal(uint word) {
  vec2 f = unpackSnorm2x16(word);
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return n;
}

void passSilhouette() {
  passCorners();
  // Both normals through u_normalMatrix: only their sides of the eye count, and it keeps both signs alike.
  vec3 own = u_normalMatrix * cross(a_corner1 - a_corner0, a_corner2 - a_corner0);
  vec3 corners[3] = vec3[3](a_corner0, a_corner1, a_corner2);
  uint edges = 0u;
  for (int i = 0; i < 3; i++) {
    vec3 middle = (u_model * vec4(0.5 * (corners[i] + corners[(i + 1) % 3]), 1.0)).xyz;
    vec3 toEye = u_lookEye.xyz - middle * u_lookEye.w;
    vec3 neighbour = u_normalMatrix * octahedralNormal(a_edgeWord[i + 1]);
    bool open = (a_edgeWord.x & (8u << i)) != 0u;
    if (open || dot(own, toEye) * dot(neighbour, toEye) <= 0.0) edges |= 1u << i;
  }
  // A degenerate triangle, or the corners at the origin of a draw without the de-indexed geometry: none.
  v_silhouetteEdges = dot(own, own) > 0.0 ? edges : 0u;
}
