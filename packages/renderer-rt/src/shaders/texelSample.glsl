// Pixel-art texture lookup: nearest texels with an anti-aliased seam one screen pixel wide, every tap clamped to the
// face's texel rectangle so no texel of a neighbouring atlas region is ever read. Textures are SRGB8_ALPHA8 with
// NEAREST filtering and no mipmaps; texelFetch returns linear colour, so the taps blend in linear space.

// Inclusive texel range [xy, zw] of a face from its normalised UV rectangle [uMin, vMin, uMax, vMax].
ivec4 faceTexelRange(vec4 uvRect, vec2 size) {
  vec2 lo = floor(uvRect.xy * size + 1.0e-3);
  vec2 hi = max(ceil(uvRect.zw * size - 1.0e-3) - 1.0, lo);
  return ivec4(lo, hi);
}

vec4 fetchPremultiplied(sampler2D tex, ivec2 texel, ivec4 range) {
  vec4 c = texelFetch(tex, clamp(texel, range.xy, range.zw), 0);
  return vec4(c.rgb * c.a, c.a);
}

// p: position in texel units; texelsPerPixel: fwidth(p). Inside a texel the result is that texel; across a seam the
// two sides blend over one pixel. Premultiplied, so a cutout neighbour adds no dark fringe.
vec4 texelAntialiased(sampler2D tex, vec2 p, vec2 texelsPerPixel, ivec4 range) {
  vec2 seam = floor(p + 0.5);
  vec2 q = seam + clamp((p - seam) / max(texelsPerPixel, vec2(1.0e-6)), -0.5, 0.5) - 0.5;
  vec2 cell = floor(q);
  vec2 f = q - cell;
  ivec2 base = ivec2(cell);
  vec4 c00 = fetchPremultiplied(tex, base, range);
  vec4 c10 = fetchPremultiplied(tex, base + ivec2(1, 0), range);
  vec4 c01 = fetchPremultiplied(tex, base + ivec2(0, 1), range);
  vec4 c11 = fetchPremultiplied(tex, base + ivec2(1, 1), range);
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

struct TexelSample {
  // Anti-aliased colour, premultiplied by alpha.
  vec4 premultiplied;
  // Alpha of the nearest texel: the transparency class comes from it, so cutout shapes stay exactly per texel.
  float nearestAlpha;
};

TexelSample sampleTexels(sampler2D tex, vec2 uv, vec4 uvRect, bool antialias) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 p = uv * size;
  // Derivatives before any branch: they are undefined in non-uniform control flow.
  vec2 dx = dFdx(p);
  vec2 dy = dFdy(p);
  vec2 texelsPerPixel = abs(dx) + abs(dy);
  ivec4 range = faceTexelRange(uvRect, size);
  vec4 nearest = texelFetch(tex, clamp(ivec2(floor(p)), range.xy, range.zw), 0);
  TexelSample s;
  s.nearestAlpha = nearest.a;
  if (!antialias) {
    s.premultiplied = vec4(nearest.rgb * nearest.a, nearest.a);
  } else if (max(texelsPerPixel.x, texelsPerPixel.y) <= 1.0) {
    s.premultiplied = texelAntialiased(tex, p, texelsPerPixel, range);
  } else {
    // Minified: several texels per pixel. A rotated 2x2 grid of the same clamped lookup averages them, so a far zoom
    // does not shimmer while the camera moves.
    s.premultiplied = 0.25 * (
      texelAntialiased(tex, p + dx * -0.125 + dy * -0.375, texelsPerPixel, range) +
      texelAntialiased(tex, p + dx * 0.375 + dy * -0.125, texelsPerPixel, range) +
      texelAntialiased(tex, p + dx * 0.125 + dy * 0.375, texelsPerPixel, range) +
      texelAntialiased(tex, p + dx * -0.375 + dy * 0.125, texelsPerPixel, range));
  }
  return s;
}

// Straight (not premultiplied) colour of a sample; black where every tap was cut out.
vec3 sampleColor(TexelSample s) {
  return s.premultiplied.a > 0.0 ? s.premultiplied.rgb / s.premultiplied.a : vec3(0.0);
}

// Nearest texel coordinate of uv, for per-texel decisions such as hashed alpha.
ivec2 nearestTexel(sampler2D tex, vec2 uv, vec4 uvRect) {
  vec2 size = vec2(textureSize(tex, 0));
  ivec4 range = faceTexelRange(uvRect, size);
  return clamp(ivec2(floor(uv * size)), range.xy, range.zw);
}
