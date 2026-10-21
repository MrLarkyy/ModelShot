// The look's light rig (LookPreset of @modelshot/looks, uploaded by uploadLookUniforms), in world space, read by the
// realtime preview, the path tracer and the light bake alike; lightRig.ts mirrors the shading.
// The environment: a sky/ground dome, radiance linear in the direction's y.
uniform vec3 u_lookSky;
uniform vec3 u_lookGround;
// The key: unit vector towards it, its colour, and the cosine of its disc's angular radius (the path tracer and the
// light bake sample its visibility in this cone).
uniform vec3 u_lookKeyDirection;
uniform vec3 u_lookKeyColor;
uniform float u_lookKeyCosRadius;
// Fill and rim: unshadowed directional accents, in every renderer.
uniform vec3 u_lookFillDirection;
uniform vec3 u_lookFillColor;
uniform vec3 u_lookRimDirection;
uniform vec3 u_lookRimColor;
// Share of the light a fully shadowed shadow-catcher point loses (shadowCatcher).
uniform float u_lookCatcherStrength;

// Fill a diffuse surface with unit normal n receives from the dome, as a multiple of its albedo (the preview's ambient
// term).
vec3 hemisphereFill(vec3 n) {
  return mix(u_lookGround, u_lookSky, n.y * 0.5 + 0.5);
}

// Radiance of the environment along the unit direction d, for path-traced rays that escape. The cosine-weighted mean
// of d.y over the hemisphere around n is 2/3 n.y, so with the factor 3/4 an unoccluded Lambert surface receives exactly
// hemisphereFill(n): the path tracer converges to the preview's fill. Never negative: checkLookPreset keeps each
// channel of sky and ground within five times the other.
vec3 environmentRadiance(vec3 d) {
  return mix(u_lookGround, u_lookSky, d.y * 0.75 + 0.5);
}

// The fill and rim accents on a diffuse surface with unit normal n, as a multiple of its albedo; no shadow anywhere.
vec3 accentLight(vec3 n) {
  return u_lookFillColor * max(dot(n, u_lookFillDirection), 0.0) + u_lookRimColor * max(dot(n, u_lookRimDirection), 0.0);
}
