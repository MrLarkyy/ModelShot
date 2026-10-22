// Baked light of the surface (lightmapLayout.ts, BakedLighting.ts): rgb the fill as a multiple of hemisphereFill(n),
// a the key's visibility. Texel charts are read with the albedo's seam taps (texelSample), clamped to the chart, so
// light changes per texel and at the same pixels as the albedo; world charts bilinearly at their own grid (an
// untextured face has no texel grid to keep); vertex charts come interpolated from mesh.vert.
#include "texelSample"
#include "faceTexels"
#include "shading"

uniform highp sampler2D u_lightmap;
uniform bool u_bakeOn;
// The face texture's size in texels as the layout saw it (SceneTexture width and height).
uniform vec2 u_lightmapTextureSize;
// (chart x, chart y, texture texels per lightmap texel, back offset); z 0: vertex mode, -1: no light, -2: world
// mode (x, y then the provoking corner's point, unused).
flat in vec4 v_lightmap;
in vec4 v_vertexLight;
in vec4 v_vertexLightBack;

const float LIGHTMAP_NONE = -1.0;
const float LIGHTMAP_WORLD = -2.0;

vec4 lightmapTexel(ivec2 origin, ivec2 local, ivec2 size) {
  return texelFetch(u_lightmap, origin + clamp(local, ivec2(0), size - 1), 0);
}

// Called before any discard: the derivatives need uniform control flow.
vec4 sampleBakedLight(vec2 uv, vec4 uvRect) {
  vec2 p = uv * u_lightmapTextureSize;
  vec2 texelsPerPixel = abs(dFdx(p)) + abs(dFdy(p));
  vec4 chart = v_lightmap;
  if (chart.z == LIGHTMAP_NONE) return vec4(1.0);
  if (chart.z == 0.0) return gl_FrontFacing ? v_vertexLight : v_vertexLightBack;
  if (chart.z == LIGHTMAP_WORLD) {
    // Interpolated, the rectangle may miss its integers by a rounding error.
    vec4 rect = floor(v_vertexLightBack + 0.5);
    ivec2 worldSize = ivec2(rect.zw);
    ivec2 worldOrigin = ivec2(rect.xy) + (gl_FrontFacing ? ivec2(0) : ivec2(int(chart.w), 0));
    // Texel i holds the light around its centre i + 0.5 (the bake's jittered point).
    vec2 at = v_vertexLight.xy - rect.xy - 0.5;
    ivec2 base = ivec2(floor(at));
    vec2 f = at - floor(at);
    vec4 w00 = lightmapTexel(worldOrigin, base, worldSize);
    vec4 w10 = lightmapTexel(worldOrigin, base + ivec2(1, 0), worldSize);
    vec4 w01 = lightmapTexel(worldOrigin, base + ivec2(0, 1), worldSize);
    vec4 w11 = lightmapTexel(worldOrigin, base + ivec2(1, 1), worldSize);
    return mix(mix(w00, w10, f.x), mix(w01, w11, f.x), f.y);
  }
  float k = chart.z;
  ivec4 range = faceTexelRange(uvRect, u_lightmapTextureSize);
  ivec2 size = ivec2(ceil(vec2(range.zw - range.xy + 1) / k));
  ivec2 origin = ivec2(chart.xy) + (gl_FrontFacing ? ivec2(0) : ivec2(int(chart.w), 0));
  SeamTaps taps = seamTaps((p - vec2(range.xy)) / k, texelsPerPixel / k);
  vec4 c00 = lightmapTexel(origin, taps.base, size);
  vec4 c10 = lightmapTexel(origin, taps.base + ivec2(1, 0), size);
  vec4 c01 = lightmapTexel(origin, taps.base + ivec2(0, 1), size);
  vec4 c11 = lightmapTexel(origin, taps.base + ivec2(1, 1), size);
  return mix(mix(c00, c10, taps.f.x), mix(c01, c11, taps.f.x), taps.f.y);
}

// The preview's shading: with baked light when the renderer has it, else exactly the unbaked expression.
vec3 shadeLit(vec3 albedo, vec3 n, vec4 light) {
  vec3 v = towardEye(v_worldPosition);
  return u_bakeOn ? shadeBaked(albedo, n, v, light) : shadeSurface(albedo, n, v);
}
