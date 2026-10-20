// The camera ray of the shared camera definition, as cameraRay of @modelshot/scene computes it (cameraUniforms.ts), so
// the render frames exactly like the preview.
uniform bool u_orthographic;
uniform vec3 u_cameraPosition;
uniform vec3 u_cameraForward;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform vec2 u_cameraScale;
uniform float u_near;
uniform float u_far;
uniform vec2 u_viewportSize;

// windowPosition: a point in the viewport in pixels, origin bottom-left (gl_FragCoord convention).
void primaryRay(vec2 windowPosition, out vec3 origin, out vec3 direction) {
  vec2 ndc = windowPosition / u_viewportSize * 2.0 - 1.0;
  vec3 offset = (ndc.x * u_cameraScale.x) * u_cameraRight + (ndc.y * u_cameraScale.y) * u_cameraUp;
  if (u_orthographic) {
    origin = u_cameraPosition + offset;
    direction = u_cameraForward;
  } else {
    origin = u_cameraPosition;
    direction = normalize(u_cameraForward + offset);
  }
}
