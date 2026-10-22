// What the trace's camera rays and the denoiser's guide rays share: the random dimensions of a path vertex and the
// shadow catcher. The guide accepts partial texels in the camera ray's dimension, so it sees them as often as the trace.

// Shadow catcher (shadowCatcherPlane.ts of the realtime renderer): a plane at height u_catcherY over the rectangle
// u_catcherRect = [minX, minZ, maxX, maxZ], seen only by camera rays from above.
uniform bool u_catcherOn;
uniform float u_catcherY;
uniform vec4 u_catcherRect;

// Random dimensions: 0-1 the pixel jitter; then per path vertex (offsets from its first dimension):
//   +0, +1  bounce direction         +2  Russian roulette        +3  acceptance of partial texels
//   +4, +5  key light cone direction
// A camera ray that meets the shadow catcher ends its path at vertex 0, so the catcher reuses vertex 0's offsets:
// +0, +1 its fill direction, +4, +5 its key ray, and +2 (roulette, unused there) the acceptance of partial texels by
// its fill ray. That one must not be +3: the camera ray drew +3 for the same triangles, so a fill ray through a partial
// texel the camera looked through would always pass it.
const uint FIRST_VERTEX_DIMENSION = 2u;
const uint DIMENSIONS_PER_VERTEX = 6u;

// Where a camera ray meets the catcher in front of everything else, or false.
bool catcherHit(vec3 origin, vec3 direction, float tMin, float tMax, bool modelHit, float modelT, out vec3 point) {
  point = vec3(0.0);
  if (!u_catcherOn || direction.y >= 0.0) return false;
  float t = (u_catcherY - origin.y) / direction.y;
  if (t < tMin || t > tMax || (modelHit && t >= modelT)) return false;
  point = origin + direction * t;
  return point.x >= u_catcherRect.x && point.x <= u_catcherRect.z && point.z >= u_catcherRect.y &&
    point.z <= u_catcherRect.w;
}
