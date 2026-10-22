// The look's backdrop (backdropColor.ts mirrors it): scene-linear, from u_lookBackdropBottom at the frame's lowest edge
// to u_lookBackdropTop at its top, in screen space so the preview and the render agree pixel for pixel.
uniform vec3 u_lookBackdropTop;
uniform vec3 u_lookBackdropBottom;
// Height of the whole frame in pixels, never of a tile.
uniform float u_lookFrameHeight;

// yNorm: 0 at the bottom edge, 1 at the top. Written as bottom + difference so equal colours come out exact.
vec3 backdropAt(float yNorm) {
  return u_lookBackdropBottom + (u_lookBackdropTop - u_lookBackdropBottom) * yNorm;
}

// The backdrop behind this fragment's pixel centre.
vec3 backdropHere() {
  return backdropAt(gl_FragCoord.y / u_lookFrameHeight);
}
