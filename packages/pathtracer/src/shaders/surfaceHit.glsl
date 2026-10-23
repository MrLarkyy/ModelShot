// What a ray meets on a triangle: its nearest texel as faceTexel addresses it (the face's texel rectangle, then the
// texture's wrap; pixel art, no filtering, nothing read from a neighbouring atlas region), the texel's coverage under
// the material's alpha rule (texelAlpha, the same classification as the preview), and the surface the integrator
// shades. The shading normal lives here only.
#include "sceneData"
#include "texelAlpha"
#include "faceTexels"
#include "edgeRounding"

// EdgeLook width of the rounded edges (model units); 0 rounds nothing (the light bake).
uniform float u_edgeWidth;

struct Hit {
  int triangle;
  float t;
  // Weights of corners 1 and 2; corner 0 has 1 - x - y.
  vec2 barycentric;
  // The ray met the back (clockwise) side.
  bool back;
};

vec2 hitUv(int triangle, vec2 b) {
  int base = triangle * TRIANGLE_ATTRIBUTE_TEXELS;
  vec4 a0 = dataTexel(u_triAttributes, base);
  vec4 a1 = dataTexel(u_triAttributes, base + 1);
  vec4 a2 = dataTexel(u_triAttributes, base + 2);
  vec4 a3 = dataTexel(u_triAttributes, base + 3);
  vec2 uv0 = vec2(a0.w, a1.w);
  vec2 uv1 = vec2(a2.w, a3.x);
  vec2 uv2 = a3.yz;
  return uv0 * (1.0 - b.x - b.y) + uv1 * b.x + uv2 * b.y;
}

// Addressed within the image before the placement offset, so a lookup never leaves its atlas place.
vec4 materialTexel(Material m, int triangle, vec2 b) {
  vec4 uvRect = dataTexel(u_triAttributes, triangle * TRIANGLE_ATTRIBUTE_TEXELS + 4);
  vec2 size = vec2(m.size);
  ivec4 range = faceTexelRange(uvRect, size);
  ivec2 texel = faceTexel(ivec2(floor(hitUv(triangle, b) * size)), range, m.size, m.textureFlags);
  return texelFetch(u_textureLayers, ivec3(texel + m.offset, m.layer), 0);
}

// Coverage of the texel a ray meets (COVERAGE_* of texelAlpha) and its alpha.
int hitCoverage(int triangle, int materialSlot, vec2 b, out float alpha) {
  Material m = fetchMaterial(materialSlot);
  alpha = 1.0;
  if (m.alphaMode == ALPHA_MODE_OPAQUE) return COVERAGE_OPAQUE;
  alpha = materialTexel(m, triangle, b).a;
  return texelCoverage(alpha, m.alphaMode, m.cutoffByte);
}

// The interpolated normal n of the hit rounded at the triangle's sharp edges (edgeRounding). Each slot's direction
// toward its edge is minus the gradient of its distance, which is affine over the triangle: exact, where the preview
// takes it from screen derivatives.
vec3 edgeRoundedNormal(int attributes, vec3 n, vec3 p0, vec3 p1, vec3 p2, vec2 b) {
  vec4 d0 = dataTexel(u_triAttributes, attributes + 5);
  vec4 d1 = dataTexel(u_triAttributes, attributes + 6);
  vec4 d2 = dataTexel(u_triAttributes, attributes + 7);
  vec4 angle = dataTexel(u_triAttributes, attributes + 8);
  vec3 e1 = p1 - p0;
  vec3 e2 = p2 - p0;
  vec3 g = cross(e1, e2);
  float area2 = dot(g, g);
  vec3 grad1 = cross(e2, g) / area2;
  vec3 grad2 = cross(g, e1) / area2;
  vec3 t[4];
  for (int k = 0; k < 4; k++) {
    vec3 gradient = (d1[k] - d0[k]) * grad1 + (d2[k] - d0[k]) * grad2;
    float length2 = dot(gradient, gradient);
    t[k] = length2 > 0.0 ? -gradient * inversesqrt(length2) : vec3(0.0);
  }
  vec4 d = d0 * (1.0 - b.x - b.y) + d1 * b.x + d2 * b.y;
  return roundedNormal(n, d, angle, t, u_edgeWidth, vec4(0.0));
}

struct Surface {
  vec3 position;
  // Interpolated vertex normal, rounded at sharp edges (edgeRounding), flipped toward the ray on a back side.
  vec3 normal;
  // Geometric normal on the side the ray came from: rays leaving the surface start on this side.
  vec3 side;
  vec3 albedo;
  vec3 emission;
};

Surface surfaceAt(Hit hit) {
  int base = hit.triangle * TRIANGLE_POSITION_TEXELS;
  vec4 p0 = dataTexel(u_triPositions, base);
  vec3 p1 = dataTexel(u_triPositions, base + 1).xyz;
  vec3 p2 = dataTexel(u_triPositions, base + 2).xyz;
  vec2 b = hit.barycentric;
  float w0 = 1.0 - b.x - b.y;
  int attributes = hit.triangle * TRIANGLE_ATTRIBUTE_TEXELS;
  vec3 n = dataTexel(u_triAttributes, attributes).xyz * w0 + dataTexel(u_triAttributes, attributes + 1).xyz * b.x +
    dataTexel(u_triAttributes, attributes + 2).xyz * b.y;
  vec3 geometric = normalize(cross(p1 - p0.xyz, p2 - p0.xyz));
  n = dot(n, n) > 0.0 ? normalize(n) : geometric;
  if (u_edgeWidth > 0.0) n = edgeRoundedNormal(attributes, n, p0.xyz, p1, p2, b);
  int slot = int(p0.w);
  Surface s;
  s.position = p0.xyz * w0 + p1 * b.x + p2 * b.y;
  s.normal = hit.back ? -n : n;
  s.side = hit.back ? -geometric : geometric;
  s.albedo = materialTexel(fetchMaterial(slot), hit.triangle, b).rgb;
  s.emission = materialEmission(slot);
  return s;
}
