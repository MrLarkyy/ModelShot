// The material table both model-view renderers read. The alpha rule is resolveMaterialAlpha / texelCoverage of
// @modelshot/scene: below the cutoff a texel is invisible to camera and shadow rays alike. Partial texels never reach
// these shaders (sceneUpload.ts rejects them). MAX_MATERIALS and MODE_* are #defines from modelShaderDefines.ts.

uniform sampler2DArray u_textures;
uniform int u_materialLayer[MAX_MATERIALS];
uniform int u_materialMode[MAX_MATERIALS];
uniform float u_materialCutoff[MAX_MATERIALS];
uniform ivec2 u_layerSize[MAX_MATERIALS];
uniform vec3 u_untexturedColor;

// Nearest texel, clamped to the face's UV rectangle so a UV on the face's edge never reads the neighbouring region.
vec4 materialTexel(int material, vec2 uv, vec4 rect) {
  int layer = u_materialLayer[material];
  if (layer < 0) return vec4(u_untexturedColor, 1.0);
  vec2 size = vec2(u_layerSize[layer]);
  ivec2 lo = ivec2(floor(rect.xy * size));
  ivec2 hi = max(lo, ivec2(ceil(rect.zw * size)) - 1);
  ivec2 texel = clamp(ivec2(floor(uv * size)), lo, hi);
  return texelFetch(u_textures, ivec3(texel, layer), 0);
}

bool texelInvisible(int material, float alpha) {
  return u_materialMode[material] != MODE_OPAQUE && alpha < u_materialCutoff[material];
}
