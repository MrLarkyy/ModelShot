// Edge rounding shared by the preview and the path tracer; edgeRounding.ts mirrors it. A sharp edge (sharpEdges of
// @modelshot/scene) is shaded as a circular fillet: within `width` of the edge the normal turns toward it, reaching
// the bisector of the two faces at the edge, so both faces meet with the same normal. Geometry does not change.

// Integral of the ramp 1 - x / width (1 below 0, 0 beyond width) from 0 to x.
float edgeRampIntegral(float x, float width) {
  if (x <= 0.0) return x;
  if (x >= width) return 0.5 * width;
  return x - 0.5 * x * x / width;
}

// The ramp at distance d, box-filtered over a footprint of distance (the preview's pixel); 0 leaves it unfiltered (the
// path tracer averages over its jittered samples instead).
float edgeRamp(float d, float width, float footprint) {
  if (footprint <= 1.0e-6 * width) return clamp(1.0 - d / width, 0.0, 1.0);
  float h = 0.5 * footprint;
  return (edgeRampIntegral(d + h, width) - edgeRampIntegral(d - h, width)) / footprint;
}

// n: the unit surface normal; d: distances to the four slots' edges; angle: their signed angles between the face
// normals (negative: a crease, which bends the other way); t: unit directions in the surface toward each edge (zero for
// an empty slot); footprint: the distance one pixel spans per slot. On the fillet the normal's turn phi satisfies
// sin(phi) = ramp * sin(angle / 2), the profile of a circular arc seen from the face. Returns n itself where nothing
// bends it, so flat areas shade bit for bit as without rounding.
vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint) {
  if (width <= 0.0) return n;
  vec3 offset = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float r = edgeRamp(d[k], width, footprint[k]);
    if (r > 0.0 && angle[k] != 0.0) offset += tan(asin(r * sin(0.5 * angle[k]))) * t[k];
  }
  return dot(offset, offset) > 0.0 ? normalize(n + offset) : n;
}
