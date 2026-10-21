# Testing

`pnpm test` runs two layers, in order; either failing fails the command and the CI job.

1. `pnpm test:unit`: Vitest, every package plus `tools/harness/test` (comparator, golden store, budgets, bundle size,
   model-view helpers).
2. `pnpm test:browser`: Playwright in a pinned headless Chromium on software WebGL (SwiftShader), `tools/harness`.

Run `pnpm browsers` once per machine (and after a Playwright version bump) to install the browser. Playwright is pinned
to an exact version in `tools/harness/package.json`, which pins the Chromium revision.

## Browser tests

Fixtures in `tools/harness/fixtures` are self-contained WebGL2 pages served by a local Vite server on
`127.0.0.1:<port>`. The port is `MS_HARNESS_PORT`, else a stable per-checkout port in 4410..4909 derived from the harness
directory, so two worktrees can test at once; a server already on that port is never reused. A fixture publishes `window.__msFixture`; the spec waits for `ready`, reads the drawing buffer with
`gl.readPixels`, flips it, and encodes a PNG in Node. Every golden render asserts a SwiftShader renderer, so a local GPU
never produces or checks a golden. Every spec uses the shared `test` from `src/harnessTest.ts`, which fails any request off the fixture origin on any page,
and every `openFixture` asserts SwiftShader. Fixture
image code uses no clock or random source (lint rule; timing lives in `fixtures/src/bench.ts` only).

## Goldens

- Location `tools/harness/goldens/`, one file per name for every platform.
- Names: `name.png` for raster fixtures, `name.s<seed>.n<samples>.png` for path-traced ones. Seed (0..2^32-1) and
  sample count (1..4096) are part of the spec; rendering another seed or count fails the comparison.
- Comparison: pixelmatch (perceptual, anti-aliased pixels counted) with `threshold 0.1` and `maxDiffRatio 0.001`, plus a global
  check, `maxMeanDelta 1`: the mean absolute channel delta over the whole image, in 0..255 levels. pixelmatch alone
  ignores a uniform shift of up to about 25 levels; the mean catches exposure-like changes. A failure writes
  `<name>-actual.png`, `<name>-expected.png` and `<name>-diff.png` into the per-test subfolder of
  `tools/harness/test-results/` (the path is in the failure message); CI uploads `test-results/` as the
  `browser-test-results` artefact.
- What fails for a wrong sample count: the fixture counts the draws it really made and the spec rejects a count that
  differs from the request (`assertSampleCount`); for the same seed, 63 or 65 samples instead of 64 also fail the
  comparison by themselves, with 0 differing pixels but a mean delta of 1.40..1.42 levels against the limit of 1 (seed 8:
  12.8, 32 samples: 9.0). The 63/65 margin is small; do not raise `maxMeanDelta` without a replacement check.
- A missing golden fails the test, and the message names the spec file of the failing test as the update pattern. Goldens are written only by `pnpm golden:update [spec file pattern]`, for
  example `pnpm golden:update golden.spec` (Playwright `--update-snapshots=changed`; the pattern selects spec files, not
  golden names); the command is refused when `CI` is set. Review every changed image as an image before
  committing.
- Data goldens (JSON file snapshots of loader output, `__goldens__/*.json` next to the Vitest tests) are written only by
  `pnpm golden:update:data [test file pattern]` (`vitest run --update`); review the JSON diff before committing.
- A per-golden tolerance override (`threshold`, `maxDiffRatio`, `maxMeanDelta`, each range-checked) needs a non-empty `reason` in the spec, and GPU-variance evidence (the CI diff
  artefact) in the commit.

## Realtime renderer goldens

`e2e/realtime.spec.ts` renders `fixtures/rt.html` (the realtime renderer on SwiftShader, 256 x 256, no clock or
random source; partial alpha on the fallback path uses an integer hash). Scenes and camera presets live in
`fixtures/src/rtScenes.ts`, so the path-tracer fixture can render the same scene and camera for a paired golden. The
fixture models in `fixtures/models/` are ours (CC0, `LICENSE` there); `rt-showcase.bbmodel` has an atlas whose 6 x 6
face rectangles sit in a ring of magenta sentinel texels, opaque, cut-out and 50 % texels, a zero-thickness sprite,
two overlapping partial-alpha planes in different meshes, rotated and mirrored face UVs and a 64 x 64 brick face.

- Goldens: `rt-turntable-y000`, `-y030`, `-y060`, `-y090` (perspective 35°, pitch 20°), `rt-iso` (orthographic
  isometric), `rt-closeup` (half the fit distance, atlas texels about 28 px), `rt-far` (three times the fit
  distance, brick texels about 0.45 px), `rt-fallback` (no-float path), `rt-fit-flat-cube` (frame-to-fit of a plate
  with zero height), `rt-gltf-nodes-y030` and `rt-obj-shapes-y030` (perspective 35°, pitch 20°, yaw 30°: the glTF
  and OBJ loader fixtures, below). Default tolerance.
- Bleeding: no turntable frame has a pixel whose red and blue both exceed green by more than 24 levels (the magenta
  sentinel after lighting and AgX). Without the face-rectangle clamp the 0° frame has 441 such pixels. The same holds
  for `gltf-nodes` at yaw 0°, 30°, 60°, 90°, 180° and 270°; with every UV rectangle widened to the whole image its 0°
  frame has 179 such pixels (MS-13). Its fixture colours are chosen so that no edge pixel mixing two of them leans
  magenta.
- Loader fixtures (MS-13): scene `gltf-nodes` is `packages/formats/test/fixtures/gltf/scene-nodes.gltf` through
  `loadGltf` (a node hierarchy with TRS, quaternion, non-uniform scale, a matrix node and a mirrored node, a cube
  instanced twice on an atlas with magenta sentinel rings, a `MASK` cut-out plane, a 50 % `BLEND` plane, a
  double-sided plane, factor-only colours, a `KHR_texture_transform` panel on `TEXCOORD_1` and a triangle strip);
  scene `obj-shapes` is `fixtures/obj/shapes.obj` with its `.mtl` and PNG through `loadObj` (quads, a concave star
  from negative indices, faces without `vn` or `vt`, a `map_Kd` cut-out, `Kd` only, `d 0.5`). Both are static
  imports, CC0, `LICENSE` next to them. The path-tracer fixture can pair goldens with these scenes.
- Shimmer: between yaw 30° and 30.25°, the share of pixels changing by more than 64 levels must be at most half of
  the same share with nearest sampling (`aa=0`), in the `far` and `closeup` framings.
- Order independence: reversing the mesh order gives a byte-identical image on the float path and on the fallback,
  for the showcase and for `gltf-nodes`.
- A cut-out texel over the backdrop shows exactly the backdrop colour.
- Context loss through `WEBGL_lose_context`: the image after the restore matches `rt-turntable-y030`, without a
  reload or a page error.
- Device pixel ratio 2 doubles the backing store; an element resize reallocates and keeps the projection unstretched.
- Sides: the zero-height plate (two coincident single-sided faces) seen from above shows its grass face, from below
  only its stone face, on both paths.
- Scene-format rule against the model-view fixture (`look=model-view` uses the fixture's camera, so its `probes` fall
  on the same pixels; `depth=framed` clips at 20..120, `depth=inside` at far × 1e-4..120 like a camera inside the
  bounding sphere, which switches the renderer to the exact depth key; `rt.depthKeyMode()` is asserted), on the
  float path and the fallback: `alpha-plane` (opaque texel, transparent texel showing the ground, double-sided back
  showing the mirrored texel), `render-order` (a scene with render orders, so always the exact key: the coincident
  horizontal pairs split along different diagonals, gap pairs at 2 × TIE where the nearer shows and tie pairs at
  0.5 × TIE where `in_front` shows), and `coincident-double` (order 0, so the raster key when framed;
  `look=above|below|grazing-above|grazing-below`: of two coincident double-sided quads split along different
  diagonals the one facing the camera wins, at about 8° with no pixel of the other colour; a single-sided quad seen
  from behind shows the backdrop).
- Closed double-sided boxes against the same boxes without their hidden faces (`closed-cube` / `closed-cube-open`, and
  `step` / `step-open`: a tall box beside a low one, with a T-junction and a hidden face coincident with a visible one
  facing the other way; visible faces red, hidden blue): not one pixel may differ, on float and fallback, with the
  raster key, the exact key inside the sphere and the exact key from render order 1 (`-order` scenes), seen from
  `cube`, `cube-grazing-1` (the east face about 1° from edge-on) and `cube-grazing-5` (`step`: `cube` and
  `cube-grazing-5`). The raster frames skip these opaque closed boxes' back pass; drawing it anyway differs in 74
  pixels (cube, 1°) and 23 (step, 5°) on float.
- Raster back pass of closed meshes, float and fallback: `closed-cube-cutout` (the hidden faces' rectangle half hole, so
  the cube is closed but not opaque and keeps its back pass) against `closed-cube-open`: 0 pixels from `cube` (at
  `polygonOffset(1, 1)`: 45), at most 10 from `cube-grazing-1` on float (the pinned MSAA deviation,
  realtime-renderer.md), 0 on fallback; `closed-cube` from `cube-inside` (camera inside the cube's bounds): no backdrop
  pixel, every wall a back side (skipping it there leaves only backdrop); `closed-cube-inverted` (every triangle
  reversed, normals flipped) from `cube`: the centre pixel is the red near wall, a back side (an orientation-blind
  closedness test skips it and shows the blue far wall: 76, 108, 190). Unit tests (`closedOpaque.test.ts`): solids
  (cube, shared or own vertices, two disjoint cubes; not: open sheet, missing face, a face wound the other way,
  duplicated faces, inside-out cube, coincident opposite pair with different diagonals, cavity, nested shell), the
  translucent-texel count inside a UV rectangle, the per-mesh decision (readback failure, opaque mode, untextured,
  single-sided, groups), `backSidesVisible` (inside, outside, near plane) and the batch key.
- Render-order tie at sample level: a red `in_front` quad over a coincident blue default quad split along the other
  diagonal (`tie-pair`) against the red quad alone (`tie-single`): not one pixel may differ, exact key, float and
  fallback, seen `above`, `grazing-above` (about 8°) and `model-view`; the double-sided pair seen `below` and
  `grazing-below` ties two back sides (without the shared-edge flags 1–124 pixels differ); and at device pixel ratio 2
  in a non-square 768 x 512 viewport (the exact key's ray uses the viewport the passes draw into; a drawing buffer
  smaller than the canvas cannot be produced in this harness).
- Texel alpha bytes in the shaders: a 16 x 16 quad with `fixtures/models/rt-alpha-ramp.png` (white texels whose alpha
  byte is their index, CC0) seen square on, `aa=0`, float and fallback: under blend 0.01 exactly the bytes 0–2 show
  only the backdrop, under mask 128/255 the bytes 0–127, under opaque none (so the cutoff byte and the bytes below it,
  254 and 255 run through `texelAlpha.glsl`).
- Float targets the driver rejects at a new size (`breakFramebuffers()` makes every framebuffer report incomplete)
  switch the renderer to the no-float path; `capabilities.path` reports it.
- Hostile textures (corrupt bytes rejected at the header, a valid header with scrambled image data that fails to
  decode, missing, header size lying, a 16384 x 16384 PNG header behind a declared 16 x 16,
  over `maxTextureSide`) draw a placeholder with a warning, the oversized one without being decoded; two quick `setScene` calls show only the second; `dispose()` (also during decoding) leaves no live WebGL
  object or open ImageBitmap (counted with `track=1`).
- Framing: the fit and isometric views keep a 2 px backdrop border around the model.
- Player skins (`player-*` scenes, built by `fixtures/src/playerScenes.ts` from the generated skins below):
  goldens `rt-player-classic-front` (yaw 180°, pitch 10°), `rt-player-classic-back` (yaw 0°), `rt-player-slim-34`,
  `rt-player-legacy-34`, `rt-player-legacy-opaque-hat-34` (`skin-legacy-opaque-hat.png`: no hat, so no magenta),
  `rt-player-hold-34` (classic in the `hold` preset with `single-cube.bbmodel` at half size
  attached to `right_hand`), `rt-player-walk-hold-34` (the same in `walk`) (yaw 210°, pitch 20°) and
  `rt-player-slim-fallback`, and `rt-player-wave-front` (classic in the `wave` preset, yaw 180°, pitch 10°; `idle` is
  the rest pose of the other frames); default tolerance. No player frame has a magenta sentinel pixel (the held cube's own
  gradient texture is hidden for that check with `hide=block`; the camera frames the unhidden scene, so the view does
  not move). Probes projected from model space, float and fallback: the alpha-0 base texel shows its cyan RGB (base
  layer opaque), a hat hole shows the red head front, and the slim skin's alpha-128 hat texel (5 x 5 mean, as the
  fallback dithers) is less red and more green than the head beside it. Reversed mesh order is byte-identical
  (`player-slim-34`, `player-hold-34`, `player-slim-fallback`). The held cube (the pixels that change when it is
  hidden) has its centroid within 2 px of the projection of its centre, taken from the right hand's world matrix
  (`rt.nodePoint`) at 1.5 units below the anchor, in `hold` and in `walk`. Offsetting the hat's skin offset by one
  row puts 203 sentinel pixels into `rt-player-classic-front`.

**Baked lighting** (MS-16, `test.describe('baked lighting')`; the fixture's `bake=<samples>` bakes with `LightBaker`
before the first frame, `catcher=0|1`, `bakeSeed`, `bakeTile`, `pose=<player preset>`, `lag=1`; its `rt` controls
bake, re-pose, lose the worker's context and hash the shown lighting). Every existing `rt-*` golden is drawn without
lighting and stays byte-identical. New goldens, 64 samples, seed 1, catcher on, default tolerance:
`rt-bake-cutout-checker` (and `-fallback`: the generated `cutout-checker` scene, an 8 x 8 checker of cut-out and
opaque texels 1 unit each, bottom row 1 unit above the catcher, facing the key, half a unit in front of a grey box;
textures generated in code, `look=checker` from behind the plane), `rt-bake-alpha-plane` (model-view camera) and
`rt-bake-turntable-y030`.

- Pixel-shaped shadows (probes of `ptProbes.ts` projected along the key from the document, as for the path tracer):
  hole and opaque texel shadows on the catcher 48.8 levels apart with a 0.99 px step, on the box top 54.0 levels with
  1.47 px (at least 40, at most 2; float path and fallback alike). The box top first sat 6.3 units below its
  occluding texels: the cone's penumbra (2 · 0.04 · 6.3 = 0.5 units) measured 3.93 px there, so the box moved, the
  threshold stayed.
- Determinism: the same bake twice, in 32- and 64-texel tiles, and the 16-sample progress update of a 64-sample bake
  against a 16-sample bake: identical lighting hashes; seed 2 differs. Progress comes after 4 and 16 of 64 samples.
- Supersede: of two bakes started back to back the first resolves `applied: false`, and the shown lighting equals the
  second baked alone.
- Pose: `player-hold-34` baked, re-posed to `wave` (same layout key): the old lighting stays until the re-bake's
  first update; the final image equals a fresh bake of the posed document (`pose=wave`), and differs from the old
  light under the moved arm.
- Exact depth key (`render-order`, always exact): baking with and without the catcher changes no model pixel.
- Context loss: a lost and restored renderer re-uploads the light (same bytes); a lost and restored worker context
  restarts the bake and reaches the reference hash and image.
- `dispose()` with `track=1`: no WebGL object or ImageBitmap left on the page, the worker terminated.
- `setLighting` refuses another layout key, size or data length and keeps the shown light.
- Hostile: 10 000 coincident cubes bake a sample (node cap) without a lost context; `lightmap-overflow` (350 000
  double-sided untextured triangles: 2.1 M vertex texels) is refused with `SCENE_TOO_LARGE` by the bake and by
  `setScene`; a corrupt texture bakes with the placeholder and `TEXTURE_DECODE_FAILED`; an empty scene has no catcher
  and its backdrop stays (0 levels).
- Shimmer with baked light (`bake=4`): anti-aliased 0.00000 vs nearest 0.00020 (`far`), 0.00168 vs 0.01076
  (`closeup`): light and albedo share the seam taps.
- Local-first: every request of a baked page (the worker's modules included) goes to the page's origin.
- Round 2 (review findings): a bake refused with `SCENE_TOO_LARGE` after it posted the checker's textures, then a bake
  of the checker with the same textures array, gives no warning and the hash of a fresh bake; a bake asked for right
  after the worker lost its context, and one whose context is lost right before the readback after 16 samples
  (progress 4, 4, 16), reach the reference hash; with `countCappedTraversals` no texel of the benchmark scene
  (4 samples) or the cut-out plant field (1 sample) counts a capped traversal, while 107 795 texels of the coincident
  cubes do.

For a manual run on real hardware open `rt.html?scene=bench&size=512&fps=1`: it draws continuously and shows the
median frame work (draw until the GPU finished) and display interval over the last 120 frames, with the renderer
string.

## Path-tracer goldens

Fix the seed, the sample count, the resolution and the camera. The accumulation stops after exactly N samples, never
after a time. Random numbers come from a seeded integer hash, never `Math.random`.

`e2e/pathtracer.spec.ts` renders `fixtures/pt.html` (`@modelshot/pathtracer` on SwiftShader, 256 x 256, 4 bounces,
seed 1). The page takes the realtime fixture's scenes and views (`rtScenes.ts`: `variant`, `scene`, `look`, ...) so
every path-traced golden pairs with a preview of the same view, plus `seed`, `samples`, `batch` (samples per `step`),
`tile` (tile side), `size`, `maxTriangles`, `track=1` and `timing=1`; the path-tracer-only variant `emissive` sets an
emission on the showcase's brick material. A golden spec names its view in `variant` (`PathTracedGoldenSpec.variant`,
put in the URL, not in the file name).

| golden                        | view                                            | checks                                       |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------- |
| `pt-turntable-y030.s1.n64`    | showcase, perspective 35°                       | golden; determinism; bleeding; pair          |
| `pt-iso.s1.n64`               | showcase, orthographic isometric                | golden; pair                                 |
| `pt-closeup.s1.n64`           | showcase, half the fit distance (texels ~28 px) | golden                                       |
| `pt-alpha-plane.s1.n128`      | alpha-plane.bbmodel, model-view camera          | golden; shadow probes; back side; pair       |
| `pt-alpha-ramp-blend.s1.n128` | the 16 x 16 alpha ramp (blend, cutoff 0.01)     | golden; stochastic transparency              |
| `pt-render-order.s1.n16`      | render-order.bbmodel, model-view camera         | golden; render-order probes                  |
| `pt-emissive.s1.n64`          | showcase, bricks emitting (4, 2.2, 0.8)         | golden; the post beside the bricks brightens |
| `pt-player-hold-34.s1.n64`    | MS-20 player, hold preset, cube in the hand     | golden; pair with `rt-player-hold-34`        |
| `pt-cutout-checker.s1.n128`   | generated cut-out checker and box, `checker`    | golden; checker shadow probes; pair          |

All eight earlier `pt-*` goldens were regenerated in MS-16 on purpose (same seeds, samples and size): the key became
a 0.04 rad cone, the shadow catcher appeared under every model, and the random dimensions per path vertex grew from
4 to 6. Their probes were measured again (below). Round 2 gave the catcher's fill ray its own number for partial
texels (it shared the camera ray's): `pt-turntable-y030`, `pt-iso`, `pt-closeup`, `pt-emissive` and
`pt-alpha-ramp-blend`, where catcher fill rays meet partial texels (the glass panes, the ramp), were regenerated
again, by at most 5 levels (mean 1) over their whole catcher; the others did not change.

- Tolerance: an override of `threshold 0` only (its reason in the spec); `maxDiffRatio 0.001` and `maxMeanDelta 1`
  stay the defaults. The tracer converges, so at the default threshold 0.1 another seed or one sample more or less
  still passes (seed 2 at 64 samples: 7 of 65 536 pixels, mean delta 0.30; 63 samples: 0 pixels, mean delta 0.027). At
  threshold 0 every changed level counts: another seed changes 12 023 pixels (18 %), 63 or 65 samples about 4 900
  (7.5 %), 75 times the allowed ratio, so `seed 2`, `63 samples` and `65 samples` fail the comparison.
- Determinism: the same request twice, and the same 64 samples in batches of 1 and 7, in 64-pixel tiles and both, give
  the bytes of a reference rendered in the same run in one pass (never the bytes of the committed PNG, which only the
  tolerant golden comparison reads); `samplesDone` is checked against the request (`assertSampleCount`).
- Probes (`fixtures/src/ptProbes.ts`, from the document, never from a renderer; logged as `[pt probe] ...`): the cutout
  plane's hole (2, 14) and opaque texel (6, 14) followed along the key direction to the ground: lit 199.4, shadowed
  145.6 levels (at least 40 apart), and the lit/shadowed step between them spans 0.99 px (at most 2; 0.49 px with the
  delta key of MS-17, 2.96 px with a 0.05 rad cone, so the cone is 0.04 rad); on the flat cube, whose coincident
  single-sided faces the light meets from the south, the ground north of it, seen from the `flat-shadow` look: 49.7
  levels between the hole and the opaque texel (at least 40); the cut-out checker's shadows on the catcher 55.1 levels
  apart with a 1.24 px step and on the box 48.9 levels with 1.23 px (at least 40, at most 2); with the catcher off the
  interior pixels of a closed cube are byte-identical (camera rays only) while over 100 backdrop pixels darken with
  it; from below, the single-sided
  quad of `coincident-double` shows the backdrop exactly, and alpha-plane's double-sided back plane shows its texel
  mirrored (the model-view probe); the render-order pairs resolve as in the model-view fixture; each alpha-ramp texel's
  9 x 9-pixel mean is within 6 levels of AgX(a · lit white + (1 − a) · backdrop) (largest deviation 1.29); no
  turntable pixel shows the magenta sentinel; the emissive bricks raise the post's south face by 14.6 levels (at
  least 10).
- Limits and lifetime: an empty scene draws only the backdrop; corrupt, missing and size-lying textures draw the
  placeholder with the realtime renderer's warning; `maxTriangles=10` fails the page with `SCENE_TOO_LARGE`; seeds and
  sample counts out of range and a field of view of 0 or 180 throw `RangeError`; 10 000 coincident cubes
  (`scene=coincident-cubes`, 120 000 triangles whose BVH nodes nothing prunes) render a sample without losing the
  context (the per-ray node cap, path-tracer.md; about 2.3 s with page load on SwiftShader) and their camera rays are
  counted as capped; no traversal is capped in any golden view, the benchmark scene, the 200 000-triangle grid (load
  view and edge-on) or the cut-out plant field `grass-field` (edge-on from the ground and at 2°); a lost context draws
  nothing and, restored, renders the same bytes as before the loss; `cancel()` after 5 samples stays at 5; of two
  quick `setScene` calls only the second is applied (the bytes of a one-pass reference rendered in the same run); a
  scene over the material limit (1.4 M materials) fails with `SCENE_TOO_LARGE` before decoding anything and the
  current scene keeps rendering the same bytes; `dispose()` leaves no WebGL object or ImageBitmap (`track=1`).

**Pair tests** (preview vs render): `rt.html` baked (`bake=64`) and `pt.html` of the same view. Framing, with the
shadow catcher off on both sides (its edge fades into the backdrop): the backdrop masks (within 2 levels of the
top-left pixel) must agree on every pixel off the silhouette (a pixel whose 3 x 3 neighbourhood in the preview holds
both classes); 0 mismatches is the limit. Radiance, catcher on both: pixelmatch `threshold 0.1` with `maxDiffRatio`
and `maxMeanDelta` = measured x 1.25 and never above the previous limit, never widened; the render differs where it
has interreflection and noise. Logged as `[pt pair] <view>: ...`, values in `test-results/pt-pair-<view>.json`.
Measured on SwiftShader (local Windows dev machine, deterministic), MS-16 (MS-17's unbaked values in brackets):

| view             | framing: mismatches (silhouette px) | radiance: pixels, ratio, mean delta           | limit: `maxDiffRatio`, `maxMeanDelta` |
| ---------------- | ----------------------------------- | --------------------------------------------- | ------------------------------------- |
| `turntable-y030` | 0 (1 606)                           | 185, 0.00282, 0.762 (715, 0.01091, 0.784)     | 0.00353, 0.953                        |
| `iso`            | 0 (1 543)                           | 335, 0.00511, 0.942 (835, 0.01274, 1.049)     | 0.00639, 1.18                         |
| `alpha-plane`    | 0 (689)                             | 2 083, 0.03178, 2.189 (2 158, 0.03293, 1.984) | 0.0398, 2.48 (2.189 x 1.25 is above)  |
| `player-hold-34` | 0 (1 322)                           | 1 215, 0.01854, 1.295 (1 596, 0.02435, 1.443) | 0.0232, 1.62                          |
| `cutout-checker` | 0 (3 310)                           | 275, 0.00420, 0.726                           | 0.00525, 0.908                        |

alpha-plane's large ground is an untextured box, baked per vertex, so its preview shows no ground shadow (world-density
charts for untextured meshes are not in MS-16); the catcher under it darkens its mean delta a little.

For a manual run on real hardware open `pt.html?scene=bench&size=512&samples=256&timing=1`: one sample per animation
frame with the elapsed time and the renderer string.

## Model-view fixture

`fixtures/model-view.html?variant=<name>` renders a real loader result (`loadBbmodel` or `loadGltf` on a formats test
fixture, imported statically in `fixtures/src/modelViewScenes.ts`; the URL only picks one of the variants below,
looked up as an own key) with one fixed camera,
light and look (`fixtures/src/modelViewCamera.ts`), in two independent ways that read the same material table and
shading include:

- `raster`: an orthographic depth-only pass from the light (DEPTH_COMPONENT24, 1024², alpha-tested, slope polygon
  offset, back faces of single-sided runs culled as seen from the light), then the camera pass with the same culling,
  alpha discard, a `gl_FrontFacing` normal flip and a hard shadow-map lookup, into its own RGBA8 +
  DEPTH_COMPONENT24 target (blitted to the canvas; the default depth buffer may have only 16 bits). Its fragment depth
  is the scene format's render-order key (view depth − (order + back) × TIE, back = −1/16 for a back face) over
  `DEPTH_RANGE` (far + 1), computed per fragment from the pixel's ray and the triangle's plane (three flat corner
  attributes) by `shaders/include/cameraRay.glsl`, the same code the raycast uses, with a `LESS` test; no polygon
  offset. Interpolated positions or depths are not precise enough for the 0.001 tie (the rasteriser's error at a
  grazing angle is several times larger), which is why the fixture writes `gl_FragDepth` and gives up early-z: it is a
  reference, not a renderer; `@modelshot/renderer-rt` realises the key its own way (realtime-renderer.md).
- `raycast`: per pixel centre, a camera ray to the nearest triangle whose texel passes the alpha test
  (single-sided triangles only from the front; the smallest render-order key wins, the same key), shaded with the barycentric vertex normal, then one shadow ray toward the light that an
  alpha-passing
  triangle blocks (a single-sided one only if its front faces the light). Triangles and their vertex normals live in
  an RGBA32F data texture (at most 256, checked against `MAX_TEXTURE_SIZE`).

Textures are decoded with `createImageBitmap(…, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`,
uploaded unflipped and unpremultiplied into a NEAREST `TEXTURE_2D_ARRAY` without mipmaps, and read back; a
partially transparent texel under a blended material fails the page with a clear error (partial alpha is drawn by the
product renderers, MS-14 and MS-17). Shaders are static `.glsl` files joined by `fixtures/src/shaderSource.ts`
(`#version` line, then `#define`s, then includes from `shaders/include/`, then the stage). Every constant the
shaders share with TypeScript (`MAX_MATERIALS`, `MODE_*`, `RENDER_ORDER_TIE`, `SHADOW_NORMAL_OFFSET`,
`DEPTH_RANGE`) is such a `#define` from
`fixtures/src/modelShaderDefines.ts`, so it has one source; a model with more materials or textures than the tables
hold fails with a clear error.

| variant                | golden                     | checks                                                                                           |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `alpha-plane-raster`   | `alpha-plane-raster.png`   | golden; probes; pair                                                                             |
| `alpha-plane-raycast`  | `alpha-plane-raycast.png`  | golden; probes; pair; byte-identical re-render                                                   |
| `mesh-shapes-raster`   | `mesh-shapes-raster.png`   | golden (triangle, out-of-order quad, n-gons, null-texture face, rotated mesh, smooth arch); pair |
| `mesh-shapes-raycast`  | `mesh-shapes-raycast.png`  | golden; pair                                                                                     |
| `render-order-raster`  | `render-order-raster.png`  | golden; render-order probes; pair                                                                |
| `render-order-raycast` | `render-order-raycast.png` | golden; render-order probes; pair                                                                |
| `gltf-nodes-raster`    | `gltf-nodes-raster.png`    | golden (glTF hierarchy, baked transforms, factor textures); `MASK` probes; pair                  |
| `gltf-nodes-raycast`   | `gltf-nodes-raycast.png`   | golden; `MASK` probes; pair                                                                      |
| `player-raster`        | `player-raster.png`        | golden; skin probes; pair                                                                        |
| `player-raycast`       | `player-raycast.png`       | golden; skin probes; pair                                                                        |

The page publishes `probes`: pixels of chosen texels of the cutout plane (and of their shadows on the ground,
following the light ray) and of the plane seen from behind, with the texel colour. `modelView.spec.ts` checks that the
opaque texel shows the plane, the transparent texel shows the ground, the ground under the transparent texel is lit
and under the opaque one shadowed, the back side shows the same texel at its mirrored place, and on the flat cube
(two coincident single-sided faces) light through a hole of the face toward the light reaches the ground while an
opaque texel of it shadows it. In `render-order`, two pairs of coincident quads (split along different diagonals, so
their depths differ by rounding only) show the higher order's texel: `in_front` over `default`, `default` over
`behind`; two more pairs face the eye with the `in_front` quad farther along the view by 2 × and 0.5 ×
`RENDER_ORDER_TIE_DISTANCE`: at 2 × the nearer `default` quad shows, at 0.5 × the `in_front` one. `player` is the
classic test skin in the `hold` pose holding `single-cube.bbmodel`, attached at 0.6 scale and turned to face the camera
(the camera frames about 16 units); its probes show the alpha-0 cyan head texel (opaque base layer), the head through a
hat hole, a hat ring texel and the held cube, each by the hue of its texel.

`gltf-nodes` is `scene-nodes.gltf` loaded with `unitScale: 8` (half the default, so the whole model fits the fixed
camera) and its 50 % glass plane hidden: a partially transparent texel is only rejected under a blended material
that a visible mesh draws. Its probes are the top row of the `MASK` cut-out plane: the opaque red texel shows the plane
and shadows the ground (a generated 1×1 factor texture), the hole shows and lights it.

Shadow receivers: both renderers move the receiving point `SHADOW_NORMAL_OFFSET` (1.5 shadow-map texels, 0.094
units) along its geometric normal toward the viewer before testing the light (shadow-map lookup or shadow-ray
origin). Without it the shadow map's own depth error made a dithered acne band on the grazing-lit smooth arch of
`mesh-shapes` (about 45 pixels, raster only); the offset is far below a texel of any fixture model, and the alpha-plane
shadow probes still pass.

**Pair tests**: the raster and raycast images of each model are compared with its `MODEL_VIEW_PAIR_TOLERANCE`
entry (`threshold 0.1` throughout); the test prints `[model-view pair] <model>: … px differ, ratio … / max …, mean
delta … / max …` into the build log and attaches it. Measured on SwiftShader (local Windows dev machine,
deterministic, same on re-runs), differing pixels of 65 536:

| model          | measured: pixels, ratio, mean delta | limit: `maxDiffRatio`, `maxMeanDelta` |
| -------------- | ----------------------------------- | ------------------------------------- |
| `alpha-plane`  | 115, 0.00175, 0.119                 | 0.0025, 0.25                          |
| `mesh-shapes`  | 50, 0.00076, 0.046                  | 0.001, 0.07                           |
| `render-order` | 40, 0.00061, 0.040                  | 0.0008, 0.06                          |
| `gltf-nodes`   | 57, 0.00087, 0.050                  | 0.0011, 0.08                          |
| `player`       | 111, 0.00169, 0.063                 | 0.0025, 0.095                         |

The differing pixels are isolated: pixels whose centre lies within a rounding error of a silhouette, of a shadow edge
(shadow-map texels against exact shadow rays; the longest is the straight edge of the arch's shadow on the checker
quad in `mesh-shapes`), or of a texel boundary on a gradient texture (the raster interpolates UVs per pixel, the
raycast takes exact barycentrics; adjacent `uv-grid.png` texels differ by about 13 levels after lighting). No region
differs as a whole. The measured values of a run are also in
`tools/harness/test-results/model-view-pair-<model>.json`. Dropping the alpha test from the shadow pass alone changes
about 2 000 pixels of `alpha-plane`, dropping the render-order term from the raster depth about 3 400 of
`render-order`; a tolerance is never widened to make a pair pass.

`player` has one more class: about 80 of its 111 pixels are 1-px strips just inside the holes of the outer layer
(right arm 39, left arm 18, legs 25), where the base layer lies 0.15 units (0.25 × 0.6 scale) behind the opaque ring
and the raycast's exact shadow ray draws the ring's contact shadow on it; the raster's shadow map (0.0625-unit texels,
receiver offset 0.094) cannot resolve a shadow that close, so the strip stays lit there. It is shadow-map resolution,
not a disagreement about the scene: the skin probes (opaque base, hat hole, held cube) match in both. The rest are edge
pixels as above.

## Player skin fixtures

`packages/formats/test/fixtures/skins/generate.mjs` (no dependencies, deterministic; CC0 with the images, `LICENSE`
there) writes `skin-classic.png` and `skin-slim.png` (64 x 64) and `skin-legacy.png` (64 x 32). Every face of every
part has its own colour (hues 0–75° for the base layer, 90–165° for the outer layer, blue never above green so no mix
reads as the sentinel), its top-left texel darker to show orientation; every texel outside the face regions is the
magenta sentinel. Outer-layer faces are an opaque one-texel ring around alpha-0 holes. Head front texels (2..3, 2..3)
are alpha 0 with RGB (0, 200, 200); in `skin-slim.png` hat front texels (4..5, 4..5) and jacket front texels
(3..4, 5..6) are green at alpha 128. `skin-legacy-opaque-hat.png` (64 x 32) is `skin-legacy.png` with the whole hat
area (32..64, 0..16) opaque sentinel magenta, so any drawn hat texel trips the sentinel check. Run it again after
changing it and commit the images with it.

Unit tests: `formats/test/player/loadSkin.test.ts` (accepted sizes, every error code, the order of the checks, no copy
before the size rule passes, `legacyHatOpaque` of every fixture, modern skins never decoded, undecodable legacy data
keeping the hat, a seeded fuzz of 2000 corrupted legacy skins throwing nothing but `SkinError`, a 1024 x 512 16-bit
legacy skin decoded in under a second, a 2048 x 1024 one and a 2^31 x 2^30 header keeping the hat undecoded, a cut-short
IDAT and a zlib bomb in IDAT keeping the hat, 2 MiB of minimal dynamic deflate blocks walked in under a second), `legacyHatOpaque.test.ts` (the area, HD scaling, the alpha-128 threshold, 8-
and 16-bit), `createPlayerModel.test.ts` (box-UV corners, slim and legacy geometry, materials, render orders, hand
anchors, every face rectangle inside its part's skin region, no `hat` mesh for an opaque legacy hat whatever
`showOuterLayer`, the `RangeError` for a non-boolean `legacyHatOpaque`) with the data goldens
`formats/test/player/__goldens__/player-{classic,slim,legacy,legacy-opaque-hat}.json` (`serializeScene.ts`; update with
`pnpm golden:update:data`); `formats/test/png/inflateZlib.test.ts` (equal to `node:zlib` for levels 0, 1, 6, 9 and the
fixed, Huffman-only and RLE strategies; hostile streams, a 64 MiB zlib bomb against an 8 KiB expected length) and
`decodePngRgba.test.ts` (every colour type and bit depth, filters 0–4, Adam7, `tRNS`, hostile files; PNGs built by
`test/support/buildPng.ts`); `scene/test/poseScene.test.ts`, `playerPosePresets.test.ts`, `attachModel.test.ts` (the
attached vertex formula in four poses, re-posing, nesting, index remapping, every `RangeError` path) and
`renderer-rt/test/validateScene.test.ts` (a posed document with nested attachments is a valid scene).

## Budgets

`budgets.json` (root, `"version": 1`) holds `max` values for frame time, load time, time to N samples and gzip bundle
size of `app` and `embed`. `pnpm test` measures them (`bench.spec.ts`; the bundle is built fresh into a temporary directory, so
it does not depend on `pnpm -r build`) and fails when a value exceeds its `max`, when a budget has no measurement, or
a measurement has no budget. The measured values are in `tools/harness/test-results/budgets-measured.json`, and
every run prints each one against its max (`[budget] <group>.<key>: measured … / max …`, from `bench.spec.ts` and
`test/bundleSize.test.ts`; Vitest runs with `silent: false` so passing tests print too).

Measured on the local Windows dev machine (SwiftShader, 3 runs) when the budgets were set: frame time median 0.3, 0.3,
0.4 ms; time to 64 samples median 23.8, 23, 25.8 ms; gzip app 437 B, embed 115 B.

`frameTimeMs.rt-bench-512` is the realtime renderer on the benchmark scene (`fixtures/src/benchScene.ts`: 16 x 16 x 8
textured cubes, 2,048 cubes, 24,576 triangles, one mesh per cube in 128 group nodes of 4 x 4 cubes as the Blockbench
loader produces a grouped model, so 512 draw calls per frame after batching per node (checked by the spec), every
seventh with a partial-alpha face; 512 x 512, 4x MSAA, front and back face passes, opaque and transparency passes),
median of 30 frames after 5 warm-up frames. Local SwiftShader medians 68.9, 70.2 and 80.7 ms (3 runs, 128 group
nodes batched per node); max 750 ms is 10x the middle run (702 ms), rounded up, room for a CI runner that is 3-5x slower than the dev machine. SwiftShader cannot
stand in for a laptop GPU: the 60 fps criterion is evidenced by a manual run of the `fps=1` page on real hardware
(16.7 ms or less of frame work), recorded with the machine and GPU in the task.

`frameTimeMs.rt-load-first-frame-200k-order` times `setScene` plus the first frame of a generated scene at the
loader's limits (100 000 quads, 200 000 triangles, 400 000 vertices) at render order 1, which builds the exact key's
de-indexed geometry and its shared-edge flags at upload: local SwiftShader 348, 344 and 354 ms before the flags, 506
and 527 ms with them; since round 7 436 and 447 ms; max 3500 ms (10x of the first measurement).

`frameTimeMs.rt-bench-order-512` is the same scene with one mesh at render order 1, so every frame uses the exact
depth key (fragment depth, de-indexed geometry); max 750 ms like the raster bench. MS-12 local SwiftShader medians:
`rt-bench-512` 92, 118 and 120 ms (raster key, cubes double-sided as the loader marks free-format faces, coverage per
texel tap), `rt-bench-order-512` 117, 145 and 148 ms with MSAA, 83 and 107 ms since exact frames draw single-sampled
(MS-12 round 7).

- `frameTimeMs` max 5: the median is below 1 ms and `performance.now` is coarsened to 0.1 ms without cross-origin
  isolation, so 5x the median (2 ms) would be 20 ticks and one GC pause from flaking on a shared runner. 5 ms is 12-16x the
  local median and still catches about 12x and above over the local median.
- `timeToSamplesMs` max 300: about 3.7x the CI median (80.6 ms) and 12x the worst local median (25.8 ms); the first limit of 150 left under 2x on shared runners.
- `timeToSamplesMs.pt-bench-128-n256`: the path tracer on the benchmark scene (24 576 triangles), 256 samples at
  128 x 128 (one 256-pixel tile, so one draw call per sample) until the GPU finished, median of 3. Local SwiftShader
  medians 6096, 5160 and 4970 ms (3 runs, MS-17); max 52 000 ms is 10x the middle run, rounded up, as for
  `rt-bench-512`, until a CI artefact allows 3-4x the CI median. Under 60 s locally, so the bench stays at 128 x 128.
  Real hardware (RTX 3080, ANGLE D3D11): 88 ms at 128 x 128, 234 ms at 512 x 512.
- `frameTimeMs.pt-load-200k`: `setScene` of the generated 200 000-triangle scene of
  `rt-load-first-frame-200k-order` (validate, flatten, BVH build in JavaScript, upload) plus its first sample. Local
  SwiftShader 1554, 919 and 941 ms; max 10 000 ms (10x the middle run, rounded up).
- `bundleGzipBytes` app 2500, embed 2200: measured plus about 2 kB, so a real dependency shows up while noise does not.
- `bakeTimeMs.bake-bench-n16` (MS-16): `LightBaker.bake` of the benchmark scene in its worker, 16 samples with the
  shadow catcher (lightmap 2048 wide, catcher 512 x 512), from the call to the final lighting, median of 3. Local
  SwiftShader 22 873, 22 113 and 22 141 ms; max 222 000 ms (10x the middle run, rounded up). Each run is asserted
  against the max as it completes, and the bench test's timeout is 3 x that max + 300 s, so a slow bake fails its
  budget instead of the timeout.
- `mainThreadBlockMs.bake-bench` (MS-16): the page's longest main-thread block over those three bakes
  (`fixtures/src/eventLoopLag.ts`): the longest long task the browser reports (Long Tasks API, 50 ms or more), else the
  longest timed stretch of the bake calls and progress updates (upload and redraw). First measured as the lag of a
  10 ms heartbeat: 27.4 ms, then 68.3 ms, which found the fixture recomputing its camera and hashing the light on
  every update (fixed: an update only re-uploads into the existing textures and draws; 4.2 ms). The heartbeat then
  still read 63.9 and once 192.9 ms with no long task and no handler over 6.3 ms: SwiftShader's GPU process spreads
  every draw over all cores and the page gets no CPU, which no page change can fix. It is printed beside the block
  (`heartbeat lag`). Block measured 9.1 and 7.3 ms. `realtime.spec.ts` pins the long-task half: an 80 ms busy timer
  task outside the timed work reads a block of 80.0 ms (`block()` takes the observer's pending records first). A task
  Playwright's `evaluate` runs is not reported as a long task, so the bench times the `bake()` call itself. Max 50 ms, fixed (RAIL's 50 ms response budget), not derived from
  a measurement. Round 4: a full `build test` on a busy machine read 120.2 ms (heartbeat 115.0 ms): a real task. Not
  reproduced locally (full suite; 22 CPU spinners; a parallel path-tracer browser), where each update was 5-7 ms, most
  of it one 9.4 MB texSubImage2D, which waits for the GPU process whenever it is busy with the bake's draws. Fixed in
  the renderer (upload in bands over frames into back textures, realtime-renderer.md). The bench now prints the longest
  stretch per phase (`bake-call`, `worker-message`, `set-lighting`, `upload`, `render`), every long task and the slow
  phases: after the fix `set-lighting` 0.3-0.4 ms, `upload` 1.1-1.3 ms, `worker-message` 1.3-2.2 ms, `render` 1.5 ms,
  `bake-call` 7-8 ms (the posted document's clone), no long task, block 7.0 and 7.8 ms.
- `mainThreadBlockMs.bake-post-200k` (MS-16 round 2): `bake()` of the 200 000-triangle `large-order` document (1
  sample): the longer of the call's own duration (validation and the structured clone of the posted document) and the
  block over the bake. Measured 16.2 and 14.9 ms; max 50 ms, fixed like the row above. In the same runs
  `rt-load-first-frame-200k-order` (now with the lightmap layout) measured about 600 ms of its 3500.

First CI run (2026-10-20, ubuntu-latest): frame time 0.9 ms (max 5, 5.5x), time to 64 samples 80.6 ms (max 300), gzip app 437 B, embed 115 B.
Limits derive from the CI numbers: re-derive from the `budgets-measured.json` artefact, with the numbers in the commit.
Changing a `max` is a reviewed change: explain it in the commit with the measured numbers, never raise it to hide a
regression.
