import type { CompareOptions } from './compareImages';

/**
 * Preview vs render of the same view, the preview baked (64 samples, seed 1): `maxDiffRatio` and `maxMeanDelta` are
 * measured values x 1.25 (docs/testing.md, path-tracer pair table), never widened later. The render adds
 * interreflection and noise; the bake adds the occlusion and soft shadows the unbaked preview lacked, so the limits
 * fell when it came (MS-16). Framing is compared without the shadow catcher on both sides (the catcher's edge fades
 * into the backdrop and would count as model) and against a preview without MSAA (pixel-centre coverage), radiance
 * with the catcher on both and the preview's MSAA.
 */
export const PT_PAIR_TOLERANCE: Readonly<Record<string, CompareOptions>> = {
  // MS-54 (centroid normal, position and edge distances on MSAA edge pixels) re-measured every pair; the views that
  // moved are tightened to measured x 1.25 where lower (docs/testing.md, pair table), the exact-key player views and
  // the rest measured as before and keep their limits.
  // MS-30: the preview's cut-out seams are anti-aliased (alpha-to-coverage) like the render's; turntable-y030, iso,
  // alpha-plane and cutout-checker measured 0.00217 / 0.724, 0.00409 / 0.889, 0.00354 / 1.334 and 0.00340 / 0.623,
  // x 1.25 (before 0.00307 / 0.772, 0.00558 / 0.959, 0.01041 / 1.567 under MS-41's world charts, 0.00447 / 0.731).
  'turntable-y030': { threshold: 0.1, maxDiffRatio: 0.00271, maxMeanDelta: 0.904 },
  iso: { threshold: 0.1, maxDiffRatio: 0.00508, maxMeanDelta: 1.111 },
  'alpha-plane': { threshold: 0.1, maxDiffRatio: 0.00443, maxMeanDelta: 1.669 },
  // MS-35 (exact-key frames converge to the mean of 4 rotated-grid passes): measured 0.01042 / 0.999, x 1.25.
  'player-hold-34': { threshold: 0.1, maxDiffRatio: 0.01304, maxMeanDelta: 1.25 },
  'cutout-checker': { threshold: 0.1, maxDiffRatio: 0.00426, maxMeanDelta: 0.78 },
  edges: { threshold: 0.1, maxDiffRatio: 0.00079, maxMeanDelta: 0.483 },
  // MS-19 with the narrow view-relative rims (round 5), measured 0.01936 / 1.237, 0.02147 / 1.109 and 0.02116 /
  // 1.281 (limits then 0.0223 / 1.43, 0.0241 / 1.13, 0.0265 / 1.52). MS-35: the player's exact-key frames converge to
  // the mean of 4 rotated-grid passes, and Rim's rim comes from behind (colour 8): measured 0.00912 / 0.793, 0.01312 /
  // 0.704 and 0.01103 / 0.856, x 1.25.
  'preset-marketplace': { threshold: 0.1, maxDiffRatio: 0.01141, maxMeanDelta: 0.992 },
  'preset-rim': { threshold: 0.1, maxDiffRatio: 0.01641, maxMeanDelta: 0.881 },
  // The app's default yaw: the rim follows the camera to the screen-left silhouettes.
  'preset-marketplace-yaw30': { threshold: 0.1, maxDiffRatio: 0.0138, maxMeanDelta: 1.071 },
  // MS-50: measured ratio 0.01642, mean delta 0.912; MS-39: 0.00266 / 0.438 once the catcher stopped covering the shell's
  // bottom edge (a model surface in its plane), x 1.25.
  'outline-hull': { threshold: 0.1, maxDiffRatio: 0.00329, maxMeanDelta: 0.547 },
  // MS-41, catcher off: measured 0.10661 / 5.627, x 1.25. The ground agrees; the box's sides do not: the render lights
  // them with the bright ground's bounce, the bake has no interreflection (its top, lit alike, matches to the level).
  'gltf-contact': { threshold: 0.1, maxDiffRatio: 0.133, maxMeanDelta: 7.03 },
  // MS-39 (the catcher no longer beats a model surface in its plane): measured 0.00706 / 0.558, with MS-30's
  // anti-aliased cut-out edges 0.00374 / 0.470, x 1.25.
  'obj-shapes-y030': { threshold: 0.1, maxDiffRatio: 0.00468, maxMeanDelta: 0.587 },
  // MS-39: the glTF loader scene, measured 0.00664 / 1.008, with MS-30's anti-aliased cut-out edges 0.00488 / 0.956, x 1.25 (the ground was 0.04472 / 2.305 while the catcher
  // could win against it).
  'gltf-nodes-y030': { threshold: 0.1, maxDiffRatio: 0.00609, maxMeanDelta: 1.194 },
};
