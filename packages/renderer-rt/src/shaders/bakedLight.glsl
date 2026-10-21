// Baked light of the surface (lightmapLayout.ts, BakedLighting.ts): rgb the fill as a multiple of hemisphereFill(n),
// a the key's visibility. Texel charts are read with the albedo's seam taps (texelSample), clamped to the chart, so
// light changes per texel and at the same pixels as the albedo; vertex charts come interpolated from mesh.vert.
#include "texelSample"
#include "faceTexels"
#include "shading"

uniform highp sampler2D u_lightmap;
uniform bool u_bakeOn;
// The face texture's size in texels as the layout saw it (SceneTexture width and height).
uniform vec2 u_lightmapTextureSize;
// (chart x, chart y, texture texels per lightmap texel, back offset); z 0: vertex mode, below 0: no light.
flat in vec4 v_lightmap;
in vec4 v_vertexLight;
in vec4 v_vertexLightBack;

vec4 lightmapTexel(ivec2 origin, ivec2 local, ivec2 size) {
  return texelFetch(u_lightmap, origin + clamp(local, ivec2(0), size - 1), 0);
}

// Called before any discard: the derivatives need uniform control flow.
vec4 sampleBakedLight(vec2 uv, vec4 uvRect) {
  vec2 p = uv * u_lightmapTextureSize;
  vec2 texelsPerPixel = abs(dFdx(p)) + abs(dFdy(p));
  vec4 chart = v_lightmap;
  if (chart.z < 0.0) return vec4(1.0);
  if (chart.z == 0.0) return gl_FrontFacing ? v_vertexLight : v_vertexLightBack;
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
  return u_bakeOn ? shadeBaked(albedo, n, light) : shadeSurface(albedo, n);
}
