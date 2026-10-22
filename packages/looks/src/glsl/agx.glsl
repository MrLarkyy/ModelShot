// AgX view transform (Troy Sobotka's AgX with the polynomial fit of its default contrast curve); agxToneMap.ts
// mirrors it. Input: scene-linear Rec.709. Output: display-encoded sRGB in 0..1, written to the framebuffer as is. The
// look's exposure and grade (LookPreset.toneMapping, uploaded by uploadLookUniforms) apply on the way.
//
// AgX by Troy Sobotka. The Rec.709 inset/outset matrices, the log2 range and the contrast polynomial fit follow
// Benjamin Wrensch, "Minimal AgX Implementation" (iolite engine blog, 2024,
// https://iolite-engine.com/blog_posts/minimal_agx_implementation); the same polynomial ships in three.js
// AgXToneMapping (MIT) and Filament.
const mat3 AGX_INSET = mat3(
  0.842479062253094, 0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772, 0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_OUTSET = mat3(
  1.19687900512017, -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
  -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

// 2^exposure; exactly 1 at exposure 0, so the multiply is exact there.
uniform float u_lookExposureScale;
// False for the neutral grade (slope 1, offset 0, power 1, saturation 1): the grade is skipped, not evaluated as an
// identity that pow() would round.
uniform bool u_lookGraded;
uniform vec3 u_lookSlope;
uniform vec3 u_lookOffset;
uniform vec3 u_lookPower;
uniform float u_lookSaturation;

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// ASC CDL then saturation about Rec.709 luma, on the curve's output (Wrensch's "look" step).
vec3 agxGrade(vec3 v) {
  v = pow(max(v * u_lookSlope + u_lookOffset, vec3(0.0)), u_lookPower);
  float luma = dot(v, vec3(0.2126, 0.7152, 0.0722));
  return luma + u_lookSaturation * (v - luma);
}

vec3 agxToneMap(vec3 linearColor) {
  vec3 v = AGX_INSET * max(linearColor * u_lookExposureScale, vec3(0.0));
  // log2(0) is -inf; the floor keeps it finite before the clamp.
  v = clamp(log2(max(v, vec3(1.0e-10))), AGX_MIN_EV, AGX_MAX_EV);
  v = (v - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  v = agxContrast(v);
  if (u_lookGraded) v = agxGrade(v);
  return clamp(AGX_OUTSET * v, 0.0, 1.0);
}
