// Raster depth-key variant: the depth buffer holds the projected depth of the pulled vertex (mesh.vert), which
// orders surfaces by view depth minus the render-order pull exactly when the 24-bit step at the far plane is small.
void writeDepthKey() {}
