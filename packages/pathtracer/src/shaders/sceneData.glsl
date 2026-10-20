// Scene data in RGBA32F textures with u_dataWidth texels per row (packSceneData.ts holds the layout and the same
// texel counts), plus every scene texture in one SRGB8_ALPHA8 array texture (textureLayers.ts).
uniform highp sampler2D u_nodes;
uniform highp sampler2D u_triPositions;
uniform highp sampler2D u_triAttributes;
uniform highp sampler2D u_materials;
uniform highp sampler2DArray u_textureLayers;
uniform int u_dataWidth;
uniform int u_nodeCount;

const int NODE_TEXELS = 2;
const int TRIANGLE_POSITION_TEXELS = 3;
const int TRIANGLE_ATTRIBUTE_TEXELS = 5;
const int MATERIAL_TEXELS = 3;

vec4 dataTexel(highp sampler2D data, int index) {
  return texelFetch(data, ivec2(index % u_dataWidth, index / u_dataWidth), 0);
}

struct Material {
  int layer;
  ivec2 offset;
  ivec2 size;
  int alphaMode;
  int cutoffByte;
};

Material fetchMaterial(int slot) {
  vec4 a = dataTexel(u_materials, slot * MATERIAL_TEXELS);
  vec4 b = dataTexel(u_materials, slot * MATERIAL_TEXELS + 1);
  return Material(int(a.x), ivec2(a.yz), ivec2(a.w, b.x), int(b.y), int(b.z));
}

vec3 materialEmission(int slot) {
  return dataTexel(u_materials, slot * MATERIAL_TEXELS + 2).rgb;
}
