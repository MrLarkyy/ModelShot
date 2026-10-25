// Exact depth key: the view position and the triangle's three corners in view space for the fragment's ray-plane key.
#include "triangleCornersVertex"

out vec3 v_viewPosition;
flat out uint v_sharedEdges;

void passDepthKey(vec4 world) {
  v_viewPosition = (u_view * world).xyz;
  passCorners();
  v_sharedEdges = a_edgeWord.x & 7u;
}
