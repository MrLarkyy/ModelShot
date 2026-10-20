// Light rig v0: a sky/ground hemisphere fill and one directional key, in world space, read by the realtime preview and
// the path tracer alike; lightRig.ts mirrors the numbers.
const vec3 SKY_FILL = vec3(0.50, 0.52, 0.55);
const vec3 GROUND_FILL = vec3(0.20, 0.19, 0.18);
// Unit vector towards the key light (above, front right).
const vec3 KEY_DIRECTION = vec3(0.39904, 0.79808, 0.45140);
const vec3 KEY_COLOR = vec3(1.25, 1.22, 1.18);
// Angular radius (radians) of the key's disc: the path tracer and the light bake sample its visibility in this cone.
const float KEY_ANGULAR_RADIUS = 0.04;
// Share of the light a fully shadowed shadow-catcher point loses (shadowCatcher).
const float CATCHER_STRENGTH = 0.8;

// Fill a diffuse surface with unit normal n receives, as a multiple of its albedo (the preview's ambient term).
vec3 hemisphereFill(vec3 n) {
  return mix(GROUND_FILL, SKY_FILL, n.y * 0.5 + 0.5);
}

// Radiance of the environment along the unit direction d, for path-traced rays that escape. The cosine-weighted mean
// of d.y over the hemisphere around n is 2/3 n.y, so with the factor 3/4 an unoccluded Lambert surface receives exactly
// hemisphereFill(n): the path tracer converges to the preview's fill. Positive for every d with these constants.
vec3 environmentRadiance(vec3 d) {
  return mix(GROUND_FILL, SKY_FILL, d.y * 0.75 + 0.5);
}
