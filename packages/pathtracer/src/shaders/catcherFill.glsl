// The shadow catcher's fill ray, drawn by cos x the environment's luminance over the upper hemisphere (density p), so
// a blocked ray takes radiance x cos / (pi p) from the catcher, whose luminance is the same whatever the direction:
// Z / pi, Z the integral of cos x luminance. The dome's in closed form, an image's from the catcher marginal (the g
// channel of u_envMarginal, environmentLighting.ts) and its rows' conditional CDFs. E_p[B L cos / (pi p)] is the
// cosine estimate's mean for any blocker B, so the catcher's control variate stays unbiased; an unblocked ray loses
// vec3(0.0) as before, so a catcher sample where nothing blocks is still exactly 1. catcherFillSampling.ts mirrors it.
#include "lightRig"
#include "environmentMap"
#include "shadowCatcher"

// Per row (x) the catcher's marginal CDF through it: rows weighted by luminance x the row's integral of cos sin theta.
float catcherMarginalCdf(int row) {
  return row < 0 ? 0.0 : texelFetch(u_envMarginal, ivec2(row, 0), 0).g;
}

// The dome's luminance is A + B y (environmentRadiance, linear in d.y), so the density in y is
// (A + B) y^2 + A y (1 - y), a mixture with A = lum at the horizon and A + B = lum at the zenith, both >= 0
// (checkLookPreset): y = cbrt(t) for the first component, the inverse Beta(2, 2) CDF 1/2 + sin(asin(2t - 1) / 3) for
// the second. Z / pi = A / 3 + 2 (A + B) / 3 = lum(hemisphereFill(up)).
vec3 sampleDomeCatcherFill(float u1, float u2, out vec3 lostIfBlocked) {
  float horizon = max(catcherLuminance(environmentRadiance(vec3(1.0, 0.0, 0.0))), 0.0);
  float zenith = max(catcherLuminance(environmentRadiance(vec3(0.0, 1.0, 0.0))), 0.0);
  float quadratic = zenith / 3.0;
  float total = quadratic + horizon / 6.0;
  lostIfBlocked = vec3(0.0);
  if (!(total > 0.0)) return vec3(0.0, 1.0, 0.0);
  float pick = quadratic / total;
  float y;
  if (u1 < pick) {
    float t = u1 / pick;
    y = t > 0.0 ? pow(t, 1.0 / 3.0) : 0.0;
  } else {
    float t = clamp((u1 - pick) / (1.0 - pick), 0.0, 1.0);
    y = 0.5 + sin(asin(clamp(2.0 * t - 1.0, -1.0, 1.0)) / 3.0);
  }
  float phi = 2.0 * ENV_PI * u2;
  float r = sqrt(max(0.0, 1.0 - y * y));
  vec3 d = vec3(r * cos(phi), y, r * sin(phi));
  vec3 radiance = environmentRadiance(d);
  float lum = catcherLuminance(radiance);
  if (lum > 0.0) lostIfBlocked = radiance * (2.0 * total / lum);
  return d;
}

// An image's: a row by the catcher marginal, a pixel by the row's conditional CDF, cos^2 theta uniform in the row's
// band clipped at the horizon. The weight (y0^2 - y1^2) / (width P) takes P from the very CDF values the search read,
// so the estimate is unbiased for the stored tables, whatever they round.
vec3 sampleImageCatcherFill(float u1, float u2, out vec3 lostIfBlocked) {
  ivec2 size = textureSize(u_envRadiance, 0);
  int lo = 0;
  int hi = size.y - 1;
  for (int i = 0; i < 16 && lo < hi; i++) {
    int mid = (lo + hi) / 2;
    if (catcherMarginalCdf(mid) > u1) hi = mid;
    else lo = mid + 1;
  }
  int row = lo;
  float r0 = catcherMarginalCdf(row - 1);
  float r1 = catcherMarginalCdf(row);
  lo = 0;
  hi = size.x - 1;
  for (int i = 0; i < 16 && lo < hi; i++) {
    int mid = (lo + hi) / 2;
    if (conditionalCdf(mid, row) > u2) hi = mid;
    else lo = mid + 1;
  }
  int x = lo;
  float c0 = conditionalCdf(x - 1, row);
  float c1 = conditionalCdf(x, row);
  float y0 = cos(ENV_PI * float(row) / float(size.y));
  float y1 = max(0.0, cos(ENV_PI * float(row + 1) / float(size.y)));
  float band = y0 * y0 - y1 * y1;
  float t = clamp((u1 - r0) / max(r1 - r0, 1.0e-30), 0.0, 1.0);
  float y = sqrt(max(0.0, y0 * y0 - band * t));
  float sinTheta = sqrt(max(0.0, 1.0 - y * y));
  float phi = 2.0 * ENV_PI * ((float(x) + clamp((u2 - c0) / max(c1 - c0, 1.0e-30), 0.0, 1.0)) / float(size.x)) - ENV_PI;
  vec3 radiance = texelFetch(u_envRadiance, ivec2(x, row), 0).rgb;
  float p = (r1 - r0) * (c1 - c0);
  lostIfBlocked = catcherLuminance(radiance) > 0.0 && p > 0.0 && band > 0.0 ? radiance * (band / (float(size.x) * p))
                                                                             : vec3(0.0);
  return environmentWorldDirection(vec3(sinTheta * sin(phi), y, -sinTheta * cos(phi)));
}

// The catcher fill direction from u1, u2 in [0, 1) (world, y >= 0) and what a blocked ray along it takes.
vec3 sampleCatcherFill(float u1, float u2, out vec3 lostIfBlocked) {
  if (u_lookEnvironmentKind == 1) return sampleImageCatcherFill(u1, u2, lostIfBlocked);
  return sampleDomeCatcherFill(u1, u2, lostIfBlocked);
}
