// Shading of the preview with the look's light rig and edge rounding (lightRig and edgeRounding chunks of
// @modelshot/looks, which the path tracer reads too).
#include "lightRig"
#include "edgeRounding"

// EdgeLook width (model units); 0 rounds nothing.
uniform float u_edgeWidth;
uniform mat4 u_viewProjection;
#include "viewport"
// Centroid-sampled (mesh.vert): under MSAA a pixel a triangle only partly covers reads them at a covered sample, off
// the pixel centre. prepareShading moves them back to the centre unless the pixel reaches over a sharp edge.
centroid in vec3 v_normal;
centroid in vec3 v_worldPosition;
centroid in vec4 v_edgeDistances;
flat in vec4 v_edgeAngles;

// Set by prepareShading: per slot the unit direction in the surface toward its edge and the distance a pixel spans;
// the step from the centroid sample to the shading point in units of dFdx and dFdy; the edge distances and the
// interpolated normal at the shading point.
vec3 edgeToward[4];
vec4 edgeFootprint;
vec2 shadingStep;
vec4 edgeDistances;
vec3 interpolatedNormal;

// A centroid input at the shading point: inputs are affine over the triangle, so the step along their derivatives is
// exact. Uniform control flow only, as prepareShading.
vec4 atShadingPoint(vec4 value) {
  return value + dFdx(value) * shadingStep.x + dFdy(value) * shadingStep.y;
}

// Called first in main, before any discard: the derivatives need uniform control flow. A slot's distance is affine
// over the triangle, so minus its gradient in the surface (from the screen derivatives of distance and position) points
// at the edge, the direction the path tracer computes from the corners.
// The shading point is the pixel centre, as without MSAA, unless the pixel reaches over one of the triangle's sharp
// edges (a sharp silhouette or a crease: the centre less than half the pixel's footprint inside), where the centroid
// sample stays, on the face. Elsewhere the centre is used even where it lies off the face: along a triangle edge
// inside a face a GPU's centroid is a covered sample position, and shading there would change the pixel against
// single sampling (measured on an RTX 3080); at a smooth mesh's silhouette the centroid matched neither the render nor
// a supersampled preview better (docs/realtime-renderer.md).
void prepareShading() {
  vec3 dpx = dFdx(v_worldPosition);
  vec3 dpy = dFdy(v_worldPosition);
  vec4 ddx = dFdx(v_edgeDistances);
  vec4 ddy = dFdy(v_edgeDistances);
  // Neighbouring centroid samples lie up to 0.75 px off the unit steps dFdx and dFdy assume, which skews the footprint
  // (not the direction: distance and position are differenced over the same steps). Where the steps between the
  // samples' screen positions are not unit ones, toUnit (their matrix inverted) maps the derivatives back to unit
  // steps. Sample offsets lie within half a pixel, so a step 1 px or more off is no sample pattern: kept as it is.
  // Steps shortened to 0.25 px by opposite offsets are one (an RTX 3080's 4x pattern gives a determinant of 0.25
  // there): only a nearly singular matrix (below 1/16) is not.
  vec4 clip = u_viewProjection * vec4(v_worldPosition, 1.0);
  vec2 screen = (clip.xy / clip.w * 0.5 + 0.5) * u_viewportSize;
  vec2 sx = dFdx(screen);
  vec2 sy = dFdy(screen);
  vec4 skew = abs(vec4(abs(sx.x) - 1.0, sx.y, sy.x, abs(sy.y) - 1.0));
  float maxSkew = max(max(skew.x, skew.y), max(skew.z, skew.w));
  float det = sx.x * sy.y - sy.x * sx.y;
  bool mapped = maxSkew < 1.0 && abs(det) > 0.0625;
  mat2 toUnit = maxSkew > 0.01 && mapped ? mat2(sy.y, -sx.y, -sy.x, sx.x) / det : mat2(1.0);
  edgeFootprint = abs(ddx * toUnit[0][0] + ddy * toUnit[0][1]) + abs(ddx * toUnit[1][0] + ddy * toUnit[1][1]);
  // Within 0.01 px nothing moves. Beyond, the step also takes up the rasterizer's vertex snapping (SwiftShader snaps to
  // 1/16 px: its fully covered pixels interpolate up to 0.04 px off gl_FragCoord), so every pixel, partly covered or
  // not, is shaded at the same point: the centre on the surface itself.
  vec2 toCentre = gl_FragCoord.xy - screen;
  shadingStep = mapped && max(abs(toCentre.x), abs(toCentre.y)) > 0.01 ? toUnit * toCentre : vec2(0.0);
  edgeDistances = v_edgeDistances + ddx * shadingStep.x + ddy * shadingStep.y;
  if (any(lessThan(edgeDistances, 0.5 * edgeFootprint))) {
    shadingStep = vec2(0.0);
    edgeDistances = v_edgeDistances;
  }
  interpolatedNormal = atShadingPoint(vec4(v_normal, 0.0)).xyz;
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
vec3 shadingNormal() {
  vec3 n = roundedNormal(normalize(interpolatedNormal), edgeDistances, v_edgeAngles, edgeToward, u_edgeWidth,
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
