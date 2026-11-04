// a + (b - a) f rather than mix(), which GLSL ES lets round: equal ends come back exactly.
vec4 lerpExact(vec4 a, vec4 b, float f) {
  return a + (b - a) * f;
}
