// Linear depth-key variant, for frames whose depth range is too deep for the tie distance in 24 bits: the fragment
// depth is the render-order key itself, view depth minus the pull, over the far plane.
uniform float u_orderPull;
uniform float u_far;
in float v_viewDepth;

void writeDepthKey() {
  gl_FragDepth = clamp((v_viewDepth - u_orderPull) / u_far, 0.0, 1.0);
}
