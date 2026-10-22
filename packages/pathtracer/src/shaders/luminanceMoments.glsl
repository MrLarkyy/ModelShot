// Luminance moments of the samples: the trace sums each sample's squared luminance beside the radiance sum, the noise
// and denoise passes turn both sums into the variance of a pixel's mean.

// Rec. 709 luminance of scene-linear RGB.
float radianceLuminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Variance of the mean luminance of n samples from their luminance sum and squared-luminance sum (unbiased); -1 when
// unknown (fewer than 2 samples).
float varianceOfMean(float luminanceSum, float squaresSum, float n) {
  if (n < 2.0) return -1.0;
  float mean = luminanceSum / n;
  return max(squaresSum / n - mean * mean, 0.0) / (n - 1.0);
}
