// Raster depth-key variant: the depth buffer holds the projected depth of the pulled vertex (mesh.vert), which
// orders surfaces by view depth minus the render-order pull up to the rasteriser's depth interpolation error; used
// when every renderOrder is 0 and the 24-bit step at the far plane is small.
void writeDepthKey() {}
