// The look's environment as escaping rays see it: the dome of the lightRig chunk (u_lookEnvironmentKind 0), or a
// bundled image (kind 1, EnvironmentTextures.ts) sampled by luminance x solid angle. environmentLighting.ts of
// @modelshot/looks builds the tables and environmentSampling.ts mirrors the sampling. texelFetch only: float textures
// need no filtering extension, and a pixel is one constant radiance, as the tables assume.
#include "lightRig"

// rgb the radiance times the look's intensity, a the conditional CDF of the pixel's row through it; row 0 the zenith.
uniform highp sampler2D u_envRadiance;
// Per row (x) the marginal CDF through it in r; g the shadow catcher's, b its row band (catcherFill).
uniform highp sampler2D u_envMarginal;

const float ENV_PI = 3.141592653589793;

// The image-frame direction d in the world: turned by +yaw about +y, the inverse of environmentImageDirection.
vec3 environmentWorldDirection(vec3 d) {
  vec2 yaw = u_lookEnvironmentYaw;
  return vec3(yaw.x * d.x + yaw.y * d.z, d.y, -yaw.y * d.x + yaw.x * d.z);
}

// The pixel holding the image-frame unit direction d (equirect.ts: v 0 the zenith, u 0.5 the front, -z).
ivec2 environmentPixel(vec3 d, ivec2 size) {
  float u = abs(d.x) + abs(d.z) > 0.0 ? (atan(d.x, -d.z) + ENV_PI) / (2.0 * ENV_PI) : 0.5;
  float v = acos(clamp(d.y, -1.0, 1.0)) / ENV_PI;
  return clamp(ivec2(int(u * float(size.x)), int(v * float(size.y))), ivec2(0), size - 1);
}

// channel 0: the marginal CDF through row (luminance x solid angle), 1: the shadow catcher's (catcherFill).
float envMarginalCdf(int row, int channel) {
  return row < 0 ? 0.0 : texelFetch(u_envMarginal, ivec2(row, 0), 0)[channel];
}

float marginalCdf(int row) {
  return envMarginalCdf(row, 0);
}

float conditionalCdf(int x, int row) {
  return x < 0 ? 0.0 : texelFetch(u_envRadiance, ivec2(x, row), 0).a;
}

// The first of `rows` rows whose marginal CDF of `channel` exceeds u: bisection, at most 16 steps (images up to 65536
// a side).
int marginalSearch(float u, int rows, int channel) {
  int lo = 0;
  int hi = rows - 1;
  for (int i = 0; i < 16 && lo < hi; i++) {
    int mid = (lo + hi) / 2;
    if (envMarginalCdf(mid, channel) > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// The first of the `width` pixels of `row` whose conditional CDF exceeds u, as marginalSearch.
int conditionalSearch(float u, int row, int width) {
  int lo = 0;
  int hi = width - 1;
  for (int i = 0; i < 16 && lo < hi; i++) {
    int mid = (lo + hi) / 2;
    if (conditionalCdf(mid, row) > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Radiance of the environment along the unit world direction d, for rays that escape: the dome's
// environmentRadiance, or the image's pixel.
vec3 escapeRadiance(vec3 d) {
  if (u_lookEnvironmentKind != 1) return environmentRadiance(d);
  ivec2 size = textureSize(u_envRadiance, 0);
  return texelFetch(u_envRadiance, environmentPixel(environmentImageDirection(d), size), 0).rgb;
}

// Density per steradian with which sampleEnvironment draws the unit world direction d.
float environmentPdf(vec3 d) {
  vec3 image = environmentImageDirection(d);
  ivec2 size = textureSize(u_envRadiance, 0);
  ivec2 pixel = environmentPixel(image, size);
  float sinTheta = sqrt(max(0.0, 1.0 - image.y * image.y));
  if (sinTheta <= 0.0) return 0.0;
  float p = (marginalCdf(pixel.y) - marginalCdf(pixel.y - 1)) * (conditionalCdf(pixel.x, pixel.y) -
    conditionalCdf(pixel.x - 1, pixel.y));
  return p * float(size.x * size.y) / (2.0 * ENV_PI * ENV_PI * sinTheta);
}

// A world direction drawn by the image's luminance x solid angle from u1, u2 in [0, 1): its density per steradian
// (0: unusable) and the radiance along it. Bisection over the CDFs (marginalSearch, conditionalSearch).
vec3 sampleEnvironment(float u1, float u2, out float pdf, out vec3 radiance) {
  ivec2 size = textureSize(u_envRadiance, 0);
  int row = marginalSearch(u1, size.y, 0);
  float r0 = marginalCdf(row - 1);
  float r1 = marginalCdf(row);
  int x = conditionalSearch(u2, row, size.x);
  float c0 = conditionalCdf(x - 1, row);
  float c1 = conditionalCdf(x, row);
  float v = (float(row) + clamp((u1 - r0) / max(r1 - r0, 1.0e-30), 0.0, 1.0)) / float(size.y);
  float u = (float(x) + clamp((u2 - c0) / max(c1 - c0, 1.0e-30), 0.0, 1.0)) / float(size.x);
  float theta = ENV_PI * v;
  float phi = 2.0 * ENV_PI * u - ENV_PI;
  float sinTheta = sin(theta);
  pdf = sinTheta > 0.0 ? (r1 - r0) * (c1 - c0) * float(size.x * size.y) / (2.0 * ENV_PI * ENV_PI * sinTheta) : 0.0;
  radiance = texelFetch(u_envRadiance, ivec2(x, row), 0).rgb;
  return environmentWorldDirection(vec3(sinTheta * sin(phi), cos(theta), -sinTheta * cos(phi)));
}

// Power heuristic (beta 2) weight of the strategy with density a against the one with density b.
float powerHeuristic(float a, float b) {
  float a2 = a * a;
  return a2 / (a2 + b * b);
}

// What a cosine-sampled ray that escapes along d brings: the dome's radiance in full (no other strategy samples it),
// an image's weighted against the light sampling of the vertex it left (cosinePdf, 0 where the light sampling cannot
// draw d: the full radiance).
vec3 escapeRadianceMis(vec3 d, float cosinePdf) {
  if (u_lookEnvironmentKind != 1) return environmentRadiance(d);
  float weight = cosinePdf > 0.0 ? powerHeuristic(cosinePdf, environmentPdf(d)) : 1.0;
  return escapeRadiance(d) * weight;
}
