// The camera ray through a pixel centre and its distance to a triangle's plane, shared by both renderers so the raster
// depth key and the raycast hit distance are the same computation.
uniform mat4 u_inverseViewProjection;
uniform vec3 u_eye;
uniform vec2 u_viewportSize;

vec3 cameraRayDirection(vec2 fragCoord) {
  vec2 ndc = fragCoord / u_viewportSize * 2.0 - 1.0;
  vec4 far = u_inverseViewProjection * vec4(ndc, 1.0, 1.0);
  return normalize(far.xyz / far.w - u_eye);
}

// Möller–Trumbore distance along `dir` to the plane of p0, p0 + e1, p0 + e2 (det from the same cross products).
float planeDistance(vec3 origin, vec3 dir, vec3 p0, vec3 e1, vec3 e2) {
  vec3 qv = cross(origin - p0, e1);
  return dot(e2, qv) / dot(e1, cross(dir, e2));
}

// The order-aware depth key: distance along the ray, pulled nearer by RENDER_ORDER_TIE per render-order step; the
// smallest key is shown.
float renderOrderKey(float distance, float renderOrder) {
  return distance - renderOrder * RENDER_ORDER_TIE;
}
