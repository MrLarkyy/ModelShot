// The look's light rig (LookPreset of @modelshot/looks, uploaded by uploadLookUniforms), in world space, read by the
// realtime preview, the path tracer and the light bake alike; lightRig.ts mirrors the shading.
// The environment: a sky/ground dome, radiance linear in the direction's y (kind 0), or a bundled image (kind 1),
// which the preview sees as its L2 irradiance over pi: nine RGB coefficients of the image's frame, which a look turns
// by the yaw (cos, sin) about +y (equirect.ts).
uniform int u_lookEnvironmentKind;
uniform vec3 u_lookSky;
uniform vec3 u_lookGround;
uniform vec3 u_lookEnvironmentSh[9];
uniform vec2 u_lookEnvironmentYaw;
// The key: unit vector towards it, its colour, and the cosine of its disc's angular radius (the path tracer and the
// light bake sample its visibility in this cone).
uniform vec3 u_lookKeyDirection;
uniform vec3 u_lookKeyColor;
uniform float u_lookKeyCosRadius;
// The fill: an unshadowed directional accent (preview and the path tracer's camera hit, never the bake).
uniform vec3 u_lookFillDirection;
uniform vec3 u_lookFillColor;
// The rim: a grazing accent whose direction the upload turns from view into world space every frame (preview and the
// path tracer's camera hit, never the bake).
uniform vec3 u_lookRimDirection;
uniform vec3 u_lookRimColor;
uniform float u_lookRimExponent;
uniform float u_lookRimAlbedoShare;
// Perspective: the eye position, w 1; orthographic: the unit vector toward the viewer, w 0.
uniform vec4 u_lookEye;
// Share of the light a fully shadowed shadow-catcher point loses (shadowCatcher).
uniform float u_lookCatcherStrength;

// The world direction d in the image's frame: turned by -yaw about +y; the image data never turns.
vec3 environmentImageDirection(vec3 d) {
  vec2 yaw = u_lookEnvironmentYaw;
  return vec3(yaw.x * d.x - yaw.y * d.z, d.y, yaw.y * d.x + yaw.x * d.z);
}

// The image's L2 irradiance over pi at the unit normal n of its frame (shIrradiance.ts).
vec3 environmentSh(vec3 n) {
  return u_lookEnvironmentSh[0] * 0.282095 + u_lookEnvironmentSh[1] * (0.488603 * n.y) +
    u_lookEnvironmentSh[2] * (0.488603 * n.z) + u_lookEnvironmentSh[3] * (0.488603 * n.x) +
    u_lookEnvironmentSh[4] * (1.092548 * n.x * n.y) + u_lookEnvironmentSh[5] * (1.092548 * n.y * n.z) +
    u_lookEnvironmentSh[6] * (0.315392 * (3.0 * n.z * n.z - 1.0)) + u_lookEnvironmentSh[7] * (1.092548 * n.x * n.z) +
    u_lookEnvironmentSh[8] * (0.546274 * (n.x * n.x - n.y * n.y));
}

// Fill a diffuse surface with unit normal n receives from the environment, as a multiple of its albedo (the preview's
// ambient term, the light bake's and the path tracer's catcher reference). An image's is its L2 irradiance, within 1 %
// of the exact one for the bundled images; the dome's branch is the expression it always was.
vec3 hemisphereFill(vec3 n) {
  if (u_lookEnvironmentKind == 1) return max(environmentSh(environmentImageDirection(n)), vec3(0.0));
  return mix(u_lookGround, u_lookSky, n.y * 0.5 + 0.5);
}

// Radiance of the dome along the unit direction d, for path-traced rays that escape (an image's escapes read the image
// itself: escapeRadiance of the path tracer's environmentMap chunk). The cosine-weighted mean
// of d.y over the hemisphere around n is 2/3 n.y, so with the factor 3/4 an unoccluded Lambert surface receives exactly
// hemisphereFill(n): the path tracer converges to the preview's fill, and its shadow catcher, which subtracts only the
// blocked fill from hemisphereFill(up), stays unbiased. Never negative: checkLookPreset keeps each channel of sky and
// ground within five times the other. The path tracer's catcherFill chunk samples cos x the luminance of this in closed
// form, so it must stay linear in d.y.
vec3 environmentRadiance(vec3 d) {
  return mix(u_lookGround, u_lookSky, d.y * 0.75 + 0.5);
}

// The fill accent on a diffuse surface with unit normal n, as a multiple of its albedo; no shadow.
vec3 fillLight(vec3 n) {
  return u_lookFillColor * max(dot(n, u_lookFillDirection), 0.0);
}

// Unit vector from the world point p toward the eye.
vec3 towardEye(vec3 p) {
  return u_lookEye.w > 0.0 ? normalize(u_lookEye.xyz - p) : u_lookEye.xyz;
}

// The rim as radiance (not a multiple of the albedo, so it can stay white on a saturated texel): strongest where the
// unit normal n grazes the view (v unit toward the eye), exactly 0 where it faces the eye; no shadow. pow is never
// called at 0, so a black rim adds exactly 0.
vec3 rimLight(vec3 n, vec3 v, vec3 albedo) {
  float grazing = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  float facing = max(dot(n, u_lookRimDirection), 0.0);
  float rim = grazing > 0.0 && facing > 0.0 ? pow(grazing, u_lookRimExponent) * facing : 0.0;
  return u_lookRimColor * (rim * mix(vec3(1.0), albedo, u_lookRimAlbedoShare));
}
