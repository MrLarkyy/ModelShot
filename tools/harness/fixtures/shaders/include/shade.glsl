uniform vec3 u_toLight;
uniform float u_ambient;

// Lambert plus ambient; `lit` is 1 where the light reaches the point and 0 in shadow.
vec3 shade(vec3 albedo, vec3 normal, float lit) {
  float direct = max(dot(normal, u_toLight), 0.0) * lit;
  return albedo * (u_ambient + (1.0 - u_ambient) * direct);
}
