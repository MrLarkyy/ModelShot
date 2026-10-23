// Shading of the preview with the look's light rig and edge rounding (lightRig and edgeRounding chunks of
// @modelshot/looks, which the path tracer reads too).
#include "lightRig"
#include "edgeRounding"

// EdgeLook width (model units); 0 rounds nothing.
uniform float u_edgeWidth;
uniform mat4 u_viewProjection;
#include "viewport"
// Centroid-sampled (mesh.vert): under MSAA an edge pixel reads them at a covered sample, off the pixel centre.
centroid in vec3 v_worldPosition;
centroid in vec4 v_edgeDistances;
flat in vec4 v_edgeAngles;

// Set by prepareEdges: per slot the unit direction in the surface toward its edge and the distance a pixel spans.
vec3 edgeToward[4];
vec4 edgeFootprint;

// Called first in main, before any discard: the derivatives need uniform control flow. A slot's distance is affine
// over the triangle, so minus its gradient in the surface (from the screen derivatives of distance and position) points
// at the edge, the direction the path tracer computes from the corners.
void prepareEdges() {
  vec3 dpx = dFdx(v_worldPosition);
  vec3 dpy = dFdy(v_worldPosition);
  vec4 ddx = dFdx(v_edgeDistances);
  vec4 ddy = dFdy(v_edgeDistances);
  edgeFootprint = abs(ddx) + abs(ddy);
  // Centroid values of neighbouring pixels lie up to 0.75 px off the unit steps, which skews the footprint (not the
  // direction, which uses position derivatives taken over the same steps). Where the steps between the samples' screen
  // positions are not unit ones the gradient is mapped back to unit steps: (ddx, ddy) times their matrix inverted.
  vec4 clip = u_viewProjection * vec4(v_worldPosition, 1.0);
  vec2 screen = (clip.xy / clip.w * 0.5 + 0.5) * u_viewportSize;
  vec2 sx = dFdx(screen);
  vec2 sy = dFdy(screen);
  vec4 skew = abs(vec4(abs(sx.x) - 1.0, sx.y, sy.x, abs(sy.y) - 1.0));
  float det = sx.x * sy.y - sy.x * sx.y;
  if (max(max(skew.x, skew.y), max(skew.z, skew.w)) > 0.01 && abs(det) > 0.25) {
    edgeFootprint = (abs(ddx * sy.y - ddy * sx.y) + abs(ddy * sx.x - ddx * sy.x)) / abs(det);
  }
  vec3 g = cross(dpx, dpy);
  vec3 alongX = cross(dpy, g);
  vec3 alongY = cross(g, dpx);
  for (int k = 0; k < 4; k++) {
    vec3 gradient = ddx[k] * alongX + ddy[k] * alongY;
    float length2 = dot(gradient, gradient);
    edgeToward[k] = length2 > 0.0 ? -gradient * inversesqrt(length2) : vec3(0.0);
  }
}

// The interpolated normal rounded at sharp edges, box-filtered over the pixel so the band does not shimmer; the back
// of a double-sided face (drawn in its own pass) is lit with the flipped normal.
vec3 shadingNormal(vec3 interpolatedNormal) {
  vec3 n = roundedNormal(normalize(interpolatedNormal), v_edgeDistances, v_edgeAngles, edgeToward, u_edgeWidth,
    edgeFootprint);
  return gl_FrontFacing ? n : -n;
}

// The dome, the key and the unshadowed accents: the fill light, and the rim seen along v (unit, toward the eye).
vec3 shadeSurface(vec3 albedo, vec3 n, vec3 v) {
  vec3 fill = hemisphereFill(n);
  float key = max(dot(n, u_lookKeyDirection), 0.0);
  return albedo * (fill + u_lookKeyColor * key + fillLight(n)) + rimLight(n, v, albedo);
}

// With baked light (bakedLight): the dome times its baked share, the key times its baked visibility; the accents cast
// no shadow and stay whole. Light (1, 1, 1, 1) gives shadeSurface's value.
vec3 shadeBaked(vec3 albedo, vec3 n, vec3 v, vec4 light) {
  vec3 fill = hemisphereFill(n) * light.rgb;
  float key = max(dot(n, u_lookKeyDirection), 0.0) * light.a;
  return albedo * (fill + u_lookKeyColor * key + fillLight(n)) + rimLight(n, v, albedo);
}
