// Exact depth key: the view position and the triangle's three corners in view space for the fragment's ray-plane key.
// Only the de-indexed geometry carries the corners, the same on all three vertices of a triangle.
layout(location = 4) in vec3 a_corner0;
layout(location = 5) in vec3 a_corner1;
layout(location = 6) in vec3 a_corner2;
layout(location = 7) in float a_sharedEdges;

out vec3 v_viewPosition;
flat out vec3 v_corner0;
flat out vec3 v_corner1;
flat out vec3 v_corner2;
flat out float v_sharedEdges;

void passDepthKey(vec4 world) {
  v_viewPosition = (u_view * world).xyz;
  mat4 modelView = u_view * u_model;
  v_corner0 = (modelView * vec4(a_corner0, 1.0)).xyz;
  v_corner1 = (modelView * vec4(a_corner1, 1.0)).xyz;
  v_corner2 = (modelView * vec4(a_corner2, 1.0)).xyz;
  v_sharedEdges = a_sharedEdges;
}
