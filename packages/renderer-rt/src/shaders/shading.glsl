// Shading of the preview with the look's light rig and edge rounding (lightRig and edgeRounding chunks of
// @modelshot/looks, which the path tracer reads too).
#include "lightRig"
#include "edgeRounding"

// EdgeLook width (model units); 0 rounds nothing.
uniform float u_edgeWidth;
in vec3 v_worldPosition;
in vec4 v_edgeDistances;
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

// The dome, the key and the unshadowed accents (fill and rim lights).
vec3 shadeSurface(vec3 albedo, vec3 n) {
  vec3 fill = hemisphereFill(n);
  float key = max(dot(n, u_lookKeyDirection), 0.0);
  return albedo * (fill + u_lookKeyColor * key + accentLight(n));
}

// With baked light (bakedLight): the fill times its baked share, the key times its baked visibility; the accents cast
// no shadow and stay whole. Light (1, 1, 1, 1) gives shadeSurface's value.
vec3 shadeBaked(vec3 albedo, vec3 n, vec4 light) {
  vec3 fill = hemisphereFill(n) * light.rgb;
  float key = max(dot(n, u_lookKeyDirection), 0.0) * light.a;
  return albedo * (fill + u_lookKeyColor * key + accentLight(n));
}
