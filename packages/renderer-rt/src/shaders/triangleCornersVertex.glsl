// The triangle's three corners (node space) and its edge word (exactEdgeWords), the same on all three of its vertices.
// Only the de-indexed geometry carries them (uploadExactGeometry); other draws read corners at the origin and word 0.
layout(location = 4) in vec3 a_corner0;
layout(location = 5) in vec3 a_corner1;
layout(location = 6) in vec3 a_corner2;
layout(location = 7) in uvec4 a_edgeWord;

flat out vec3 v_corner0;
flat out vec3 v_corner1;
flat out vec3 v_corner2;

// The corners in view space.
void passCorners() {
  mat4 modelView = u_view * u_model;
  v_corner0 = (modelView * vec4(a_corner0, 1.0)).xyz;
  v_corner1 = (modelView * vec4(a_corner1, 1.0)).xyz;
  v_corner2 = (modelView * vec4(a_corner2, 1.0)).xyz;
}
