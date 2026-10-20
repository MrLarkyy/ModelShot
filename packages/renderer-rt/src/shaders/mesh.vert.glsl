#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_uvRect;
// Where the vertex's light lies in the lightmap (lightmapLayout.ts); locations 4-7 carry the exact depth key.
layout(location = 8) in vec4 a_lightmap;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_viewProjection;
// Render order: (order × RENDER_ORDER_TIE_DISTANCE) × the projection's third column, i.e. the vertex moved that far
// towards the camera along the view axis (raster depth key; zero in the exact variant).
uniform vec4 u_depthPull;
uniform highp sampler2D u_lightmap;
uniform bool u_bakeOn;

out vec3 v_normal;
out vec2 v_uv;
// Every vertex of a face carries the same rectangle; flat avoids interpolation error at the clamp bounds.
flat out vec4 v_uvRect;
flat out vec4 v_lightmap;
// Vertex charts: the vertex's light for the front and the back side.
out vec4 v_vertexLight;
out vec4 v_vertexLightBack;
#include "depthKeyVertex"

void main() {
  // Node world matrices are rigid (rotation and translation only), so their upper 3x3 also maps normals.
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
  v_uvRect = a_uvRect;
  v_lightmap = a_lightmap;
  v_vertexLight = vec4(1.0);
  v_vertexLightBack = vec4(1.0);
  if (u_bakeOn && a_lightmap.z == 0.0) {
    ivec2 texel = ivec2(a_lightmap.xy);
    v_vertexLight = texelFetch(u_lightmap, texel, 0);
    v_vertexLightBack = texelFetch(u_lightmap, texel + ivec2(int(a_lightmap.w), 0), 0);
  }
  vec4 world = u_model * vec4(a_position, 1.0);
  passDepthKey(world);
  gl_Position = u_viewProjection * world + u_depthPull;
}
