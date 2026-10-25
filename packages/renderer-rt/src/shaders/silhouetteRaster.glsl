// Raster variant: under MSAA a pixel the triangle only partly covers can have its centre past one of the triangle's
// edges. Past a silhouette edge (silhouetteVertexRaster) the centre lies off the mesh, and shading there extrapolates.
#include "triangleCorners"
flat in uint v_silhouetteEdges;

// A centre within 1/16 px outside an edge counts as on it: vertex snapping moves edges that far, so a single-sampled
// pixel (its centre always covered) never counts as crossing.
const float CROSSING_MARGIN = 0.0625;

// Whether the pixel centre lies past a silhouette edge of the triangle; the centre's ray meets the triangle's plane,
// and each edge's side is measured in pixels from its screen derivatives. Uniform control flow only (derivatives).
bool silhouetteCrossed() {
  vec3 origin;
  vec3 dir;
  pixelRay(origin, dir);
  vec3 n = cross(v_corner1 - v_corner0, v_corner2 - v_corner0);
  vec3 at;
  bool onPlane = planeHit(origin, dir, n, at);
  vec3 sides = edgeSides(onPlane ? at : v_corner0, n);
  vec3 perPixel = sqrt(dFdx(sides) * dFdx(sides) + dFdy(sides) * dFdy(sides));
  bvec3 past = lessThan(sides, -CROSSING_MARGIN * perPixel);
  uint crossed = (past.x ? 1u : 0u) | (past.y ? 2u : 0u) | (past.z ? 4u : 0u);
  return onPlane && (crossed & v_silhouetteEdges) != 0u;
}
