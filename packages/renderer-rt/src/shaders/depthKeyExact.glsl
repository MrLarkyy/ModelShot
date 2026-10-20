// Exact depth-key variant: the fragment depth is the render-order key itself, computed per fragment from the pixel's
// ray and the triangle's plane (its three corners in view space, the same on all its vertices), so two triangulations
// of one plane agree to float precision instead of to the rasteriser's interpolation error. Written over the far
// plane; costs early depth testing and gives per-pixel (not per-sample) MSAA depth.
uniform float u_orderPull;
uniform float u_far;
uniform mat4 u_inverseProjection;
uniform vec2 u_viewportSize;
in float v_viewDepth;
flat in vec3 v_corner0;
flat in vec3 v_corner1;
flat in vec3 v_corner2;

void writeDepthKey() {
  vec2 ndc = gl_FragCoord.xy / u_viewportSize * 2.0 - 1.0;
  vec4 nearPoint = u_inverseProjection * vec4(ndc, -1.0, 1.0);
  vec4 farPoint = u_inverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 origin = nearPoint.xyz / nearPoint.w;
  vec3 dir = farPoint.xyz / farPoint.w - origin;
  vec3 n = cross(v_corner1 - v_corner0, v_corner2 - v_corner0);
  float facing = dot(n, dir);
  // Edge-on (no usable plane): the interpolated depth is as good as it gets.
  float viewDepth = v_viewDepth;
  if (abs(facing) > 1.0e-12 * dot(n, n) * dot(dir, dir)) {
    float t = dot(n, v_corner0 - origin) / facing;
    viewDepth = -(origin.z + t * dir.z);
  }
  gl_FragDepth = clamp((viewDepth - u_orderPull) / u_far, 0.0, 1.0);
}
