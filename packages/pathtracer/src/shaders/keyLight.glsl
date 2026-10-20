// The key light as a disc of angular radius KEY_ANGULAR_RADIUS around KEY_DIRECTION (lightRig): shadow rays sample a
// direction uniformly in that cone, so a shadow softens with the distance to its occluder. Its cosine stays the one of
// KEY_DIRECTION, so an unoccluded surface gets exactly the preview's key term.
#include "lightRig"
#include "pathSampling"

vec3 keyConeDirection(float u1, float u2) {
  float cosTheta = 1.0 - u1 * (1.0 - cos(KEY_ANGULAR_RADIUS));
  float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  float phi = 6.283185307179586 * u2;
  vec3 tangent;
  vec3 bitangent;
  orthonormalBasis(KEY_DIRECTION, tangent, bitangent);
  return normalize(tangent * (sinTheta * cos(phi)) + bitangent * (sinTheta * sin(phi)) + KEY_DIRECTION * cosTheta);
}
