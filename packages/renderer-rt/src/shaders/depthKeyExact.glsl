// Exact depth-key variant: the fragment depth is the render-order key itself, computed per fragment from a ray and the
// triangle's plane (its three corners in view space, the same on all its vertices), so two triangulations of one plane
// agree to float precision instead of to the rasteriser's interpolation error. The ray is the pixel centre's; at an
// edge pixel whose centre lies outside the triangle (MSAA), where the centre ray may meet a neighbouring face's plane
// first, it goes through the centroid-sampled view position instead, a point inside the triangle. Written as
// (key + offset) × scale (exactDepthRange); costs early depth testing and gives per-pixel MSAA depth.
uniform float u_orderPull;
uniform vec2 u_depthRange;
uniform mat4 u_inverseProjection;
uniform vec2 u_viewportSize;
centroid in vec3 v_viewPosition;
flat in vec3 v_corner0;
flat in vec3 v_corner1;
flat in vec3 v_corner2;

// Distance along dir from origin to the triangle's plane; false for a ray parallel to it.
bool planeHit(vec3 origin, vec3 dir, vec3 n, out vec3 hit) {
  float facing = dot(n, dir);
  if (abs(facing) <= 1.0e-12 * dot(n, n) * dot(dir, dir)) return false;
  hit = origin + dir * (dot(n, v_corner0 - origin) / facing);
  return true;
}

// Strictly inside, by a small margin: a hit on or just past an edge is keyed through the centroid sample instead.
bool insideTriangle(vec3 p, vec3 n) {
  float margin = 1.0e-4 * dot(n, n);
  return dot(cross(v_corner1 - v_corner0, p - v_corner0), n) > margin &&
    dot(cross(v_corner2 - v_corner1, p - v_corner1), n) > margin &&
    dot(cross(v_corner0 - v_corner2, p - v_corner2), n) > margin;
}

void writeDepthKey() {
  // Before any branch: derivatives are undefined in non-uniform control flow.
  float depthPerPixel = fwidth(v_viewPosition.z);
  vec2 ndc = gl_FragCoord.xy / u_viewportSize * 2.0 - 1.0;
  vec4 nearPoint = u_inverseProjection * vec4(ndc, -1.0, 1.0);
  vec4 farPoint = u_inverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 origin = nearPoint.xyz / nearPoint.w;
  vec3 dir = farPoint.xyz / farPoint.w - origin;
  vec3 n = cross(v_corner1 - v_corner0, v_corner2 - v_corner0);
  vec3 hit;
  float edgeBias = 0.0;
  if (!planeHit(origin, dir, n, hit) || !insideTriangle(hit, n)) {
    // An edge pixel: the front face and a back face that meet at a silhouette are keyed at different points of their
    // own triangles; a back face yields two pixels' worth of its depth change, as a slope-scaled offset would.
    if (!gl_FrontFacing) edgeBias = 2.0 * depthPerPixel;
    // Through the centroid sample: from the eye (perspective) or along the view axis (orthographic, w row 0 0 0 1).
    bool orthographic = u_inverseProjection[2][3] == 0.0;
    vec3 sampleOrigin = orthographic ? vec3(v_viewPosition.xy, 0.0) : vec3(0.0);
    vec3 sampleDir = orthographic ? vec3(0.0, 0.0, -1.0) : v_viewPosition;
    if (!planeHit(sampleOrigin, sampleDir, n, hit)) hit = v_viewPosition;
  }
  gl_FragDepth = clamp((-hit.z + edgeBias - u_orderPull + u_depthRange.x) * u_depthRange.y, 0.0, 1.0);
}
