// Lighting v0: a sky/ground hemisphere fill plus one directional key, in world space. Light rigs move to looks later.
const vec3 SKY_FILL = vec3(0.50, 0.52, 0.55);
const vec3 GROUND_FILL = vec3(0.20, 0.19, 0.18);
// Unit vector towards the key light (above, front right).
const vec3 KEY_DIRECTION = vec3(0.39904, 0.79808, 0.45140);
const vec3 KEY_COLOR = vec3(1.25, 1.22, 1.18);

// Faces are drawn double-sided: the back of a face is lit with the flipped normal.
vec3 surfaceNormal(vec3 interpolatedNormal) {
  vec3 n = normalize(interpolatedNormal);
  return gl_FrontFacing ? n : -n;
}

vec3 shadeSurface(vec3 albedo, vec3 n) {
  vec3 fill = mix(GROUND_FILL, SKY_FILL, n.y * 0.5 + 0.5);
  float key = max(dot(n, KEY_DIRECTION), 0.0);
  return albedo * (fill + KEY_COLOR * key);
}
