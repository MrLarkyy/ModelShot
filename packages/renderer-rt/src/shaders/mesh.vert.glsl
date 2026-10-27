#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_uvRect;
// Where the vertex's light lies in the lightmap (lightmapLayout.ts); locations 4-7 carry the exact depth key.
layout(location = 8) in vec4 a_lightmap;
// Distances to the triangle's sharp-edge slots and their angles (sharpEdges of @modelshot/scene, batchScene.ts).
layout(location = 9) in vec4 a_edgeDistances;
layout(location = 10) in vec4 a_edgeAngles;
// World charts: the chart's rectangle in the lightmap (x, y, width, height), the same on a triangle's corners.
layout(location = 11) in vec4 a_lightmapChart;

uniform mat4 u_model;
// Inverse transpose of u_model's upper 3x3 up to a positive factor (mat4NormalMatrix); node scale makes it differ.
uniform mat3 u_normalMatrix;
uniform mat4 u_view;
uniform mat4 u_viewProjection;
// Render order: (order × RENDER_ORDER_TIE_DISTANCE) × the projection's third column, i.e. the vertex moved that far
// towards the camera along the view axis (raster depth key; zero in the exact variant).
uniform vec4 u_depthPull;
uniform highp sampler2D u_lightmap;
uniform bool u_bakeOn;

// Centroid: under MSAA a pixel a triangle only partly covers reads the normal at a covered sample, on the face, not at
// the pixel centre past the triangle's edge, where it extrapolates; v_worldPosition, v_edgeDistances and the baked
// vertex light (which at that centre would carry the light of a point beyond the face) likewise. prepareShading
// (shading.glsl) keeps that sample only where the pixel reaches over a sharp edge and returns to the centre elsewhere.
// The UV stays at the centre: texel anti-aliasing, the alpha-to-coverage contour and the hashed alpha cell are defined
// there, and v_uvRect keeps the texel on the face.
centroid out vec3 v_normal;
out vec2 v_uv;
// Every vertex of a face carries the same rectangle; flat avoids interpolation error at the clamp bounds.
flat out vec4 v_uvRect;
flat out vec4 v_lightmap;
// Vertex charts: the vertex's light for the front and the back side. World charts reuse them, as two more varyings
// would pass the minimum MAX_VARYING_VECTORS (15) with the exact depth key's: the corner's lightmap point in xy, and
// the chart rectangle.
centroid out vec4 v_vertexLight;
centroid out vec4 v_vertexLightBack;
centroid out vec3 v_worldPosition;
centroid out vec4 v_edgeDistances;
// The same on every corner of a triangle.
flat out vec4 v_edgeAngles;
#include "depthKeyVertex"

void main() {
  v_normal = u_normalMatrix * a_normal;
  v_uv = a_uv;
  v_uvRect = a_uvRect;
  v_lightmap = a_lightmap;
  v_edgeDistances = a_edgeDistances;
  v_edgeAngles = a_edgeAngles;
  v_vertexLight = vec4(1.0);
  v_vertexLightBack = vec4(1.0);
  if (u_bakeOn && a_lightmap.z == 0.0) {
    ivec2 texel = ivec2(a_lightmap.xy);
    v_vertexLight = texelFetch(u_lightmap, texel, 0);
    v_vertexLightBack = texelFetch(u_lightmap, texel + ivec2(int(a_lightmap.w), 0), 0);
  } else if (a_lightmap.z == -2.0) {
    v_vertexLight = vec4(a_lightmap.xy, 0.0, 0.0);
    v_vertexLightBack = a_lightmapChart;
  }
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPosition = world.xyz;
  passDepthKey(world);
  gl_Position = u_viewProjection * world + u_depthPull;
}
