import type { CompareOptions } from './compareImages';

/**
 * Preview vs render of the same view, the preview baked (64 samples, seed 1): `maxDiffRatio` and `maxMeanDelta` are
 * measured values x 1.25 (docs/testing.md, path-tracer pair table), never widened later. The render adds
 * interreflection and noise; the bake adds the occlusion and soft shadows the unbaked preview lacked, so the limits
 * fell when it came (MS-16). Framing is compared without the shadow catcher on both sides (the catcher's edge fades
 * into the backdrop and would count as model), radiance with it on both.
 */
export const PT_PAIR_TOLERANCE: Readonly<Record<string, CompareOptions>> = {
  // MS-30: the preview's cut-out seams are anti-aliased (alpha-to-coverage) like the render's; turntable-y030, iso,
  // alpha-plane and cutout-checker measured 0.00217 / 0.724, 0.00409 / 0.889, 0.00354 / 1.334 and 0.00340 / 0.623,
  // x 1.25 (before 0.00307 / 0.772, 0.00558 / 0.959, 0.01041 / 1.567 under MS-41's world charts, 0.00447 / 0.731).
  'turntable-y030': { threshold: 0.1, maxDiffRatio: 0.00271, maxMeanDelta: 0.905 },
  iso: { threshold: 0.1, maxDiffRatio: 0.00512, maxMeanDelta: 1.12 },
  'alpha-plane': { threshold: 0.1, maxDiffRatio: 0.00443, maxMeanDelta: 1.67 },
  'player-hold-34': { threshold: 0.1, maxDiffRatio: 0.0232, maxMeanDelta: 1.62 },
  'cutout-checker': { threshold: 0.1, maxDiffRatio: 0.00426, maxMeanDelta: 0.78 },
  edges: { threshold: 0.1, maxDiffRatio: 0.00082, maxMeanDelta: 0.496 },
  // MS-19 with the narrow view-relative rims (round 5), measured 0.01936 / 1.237, 0.02147 / 1.109 and 0.02116 /
  // 1.281; a limit stays where the measurement x 1.25 would raise it (earlier rounds' 0.0223 / 1.43, 0.0241 / 1.13,
  // 1.52). The Rim preset's exponent 5 and colour 4 keep its pair under 1.13 (exponent 10, colour 8: 0.02567 / 1.263).
  'preset-marketplace': { threshold: 0.1, maxDiffRatio: 0.0223, maxMeanDelta: 1.43 },
  'preset-rim': { threshold: 0.1, maxDiffRatio: 0.0241, maxMeanDelta: 1.13 },
  // The app's default yaw: the rim follows the camera to the screen-left silhouettes.
  'preset-marketplace-yaw30': { threshold: 0.1, maxDiffRatio: 0.0265, maxMeanDelta: 1.52 },
  // MS-50: measured ratio 0.01642, mean delta 0.912; MS-39: 0.00266 / 0.438 once the catcher stopped covering the shell's
  // bottom edge (a model surface in its plane), x 1.25.
  'outline-hull': { threshold: 0.1, maxDiffRatio: 0.00333, maxMeanDelta: 0.548 },
  // MS-41, catcher off: measured 0.10661 / 5.627, x 1.25. The ground agrees; the box's sides do not: the render lights
  // them with the bright ground's bounce, the bake has no interreflection (its top, lit alike, matches to the level).
  'gltf-contact': { threshold: 0.1, maxDiffRatio: 0.133, maxMeanDelta: 7.03 },
  // MS-39 (the catcher no longer beats a model surface in its plane): measured 0.00706 / 0.558, with MS-30's
  // anti-aliased cut-out edges 0.00374 / 0.470, x 1.25.
  'obj-shapes-y030': { threshold: 0.1, maxDiffRatio: 0.00468, maxMeanDelta: 0.588 },
  // MS-39: the glTF loader scene, measured 0.00664 / 1.008, with MS-30's anti-aliased cut-out edges 0.00488 / 0.956, x 1.25 (the ground was 0.04472 / 2.305 while the catcher
  // could win against it).
  'gltf-nodes-y030': { threshold: 0.1, maxDiffRatio: 0.0061, maxMeanDelta: 1.2 },
};
