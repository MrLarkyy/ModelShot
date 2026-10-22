import type { CompareOptions } from './compareImages';

/**
 * Preview vs render of the same view, the preview baked (64 samples, seed 1): `maxDiffRatio` and `maxMeanDelta` are
 * measured values x 1.25 (docs/testing.md, path-tracer pair table), never widened later. The render adds
 * interreflection and noise; the bake adds the occlusion and soft shadows the unbaked preview lacked, so the limits
 * fell when it came (MS-16). Framing is compared without the shadow catcher on both sides (the catcher's edge fades
 * into the backdrop and would count as model), radiance with it on both.
 */
export const PT_PAIR_TOLERANCE: Readonly<Record<string, CompareOptions>> = {
  'turntable-y030': { threshold: 0.1, maxDiffRatio: 0.00353, maxMeanDelta: 0.953 },
  iso: { threshold: 0.1, maxDiffRatio: 0.00639, maxMeanDelta: 1.18 },
  // MS-41: the ground is world-charted and has the render's shadows; measured 0.01041 / 1.567 (per vertex 0.03178 /
  // 2.189 under a limit of 0.0398 / 2.48), x 1.25.
  'alpha-plane': { threshold: 0.1, maxDiffRatio: 0.013, maxMeanDelta: 1.96 },
  'player-hold-34': { threshold: 0.1, maxDiffRatio: 0.0232, maxMeanDelta: 1.62 },
  'cutout-checker': { threshold: 0.1, maxDiffRatio: 0.00525, maxMeanDelta: 0.908 },
  edges: { threshold: 0.1, maxDiffRatio: 0.00082, maxMeanDelta: 0.496 },
  // MS-19 with the narrow view-relative rims (round 5), measured 0.01936 / 1.237, 0.02147 / 1.109 and 0.02116 /
  // 1.281; a limit stays where the measurement x 1.25 would raise it (earlier rounds' 0.0223 / 1.43, 0.0241 / 1.13,
  // 1.52). The Rim preset's exponent 5 and colour 4 keep its pair under 1.13 (exponent 10, colour 8: 0.02567 / 1.263).
  'preset-marketplace': { threshold: 0.1, maxDiffRatio: 0.0223, maxMeanDelta: 1.43 },
  'preset-rim': { threshold: 0.1, maxDiffRatio: 0.0241, maxMeanDelta: 1.13 },
  // The app's default yaw: the rim follows the camera to the screen-left silhouettes.
  'preset-marketplace-yaw30': { threshold: 0.1, maxDiffRatio: 0.0265, maxMeanDelta: 1.52 },
  // MS-50: measured ratio 0.01642, mean delta 0.912 (the rim's antialiased silhouette against the traced box filter).
  'outline-hull': { threshold: 0.1, maxDiffRatio: 0.0205, maxMeanDelta: 1.14 },
  // MS-41, catcher off: measured 0.10661 / 5.627, x 1.25. The ground agrees; the box's sides do not: the render lights
  // them with the bright ground's bounce, the bake has no interreflection (its top, lit alike, matches to the level).
  'gltf-contact': { threshold: 0.1, maxDiffRatio: 0.133, maxMeanDelta: 7.03 },
};
