// Direction sampling and ray offsets shared by the trace and the light bake, so both estimate the same integrals.

// Orthonormal tangent and bitangent of the unit vector n; Duff et al., JCGT 2017.
void orthonormalBasis(vec3 n, out vec3 tangent, out vec3 bitangent) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float b = n.x * n.y * a;
  tangent = vec3(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  bitangent = vec3(b, s + n.y * n.y * a, -n.y);
}

// Cosine-weighted direction around the unit normal n.
vec3 cosineDirection(vec3 n, float u1, float u2) {
  vec3 tangent;
  vec3 bitangent;
  orthonormalBasis(n, tangent, bitangent);
  float r = sqrt(u1);
  float phi = 6.283185307179586 * u2;
  return normalize(tangent * (r * cos(phi)) + bitangent * (r * sin(phi)) + n * sqrt(max(0.0, 1.0 - u1)));
}

// Start of a ray leaving the surface at p on the side `side`, clear of it at float precision for the scene's scale.
vec3 leave(vec3 p, vec3 side) {
  float scale = max(1.0, max(abs(p.x), max(abs(p.y), abs(p.z))));
  return p + side * (1.0e-4 * scale);
}
