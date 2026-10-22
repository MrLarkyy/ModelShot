# Testing

`pnpm test` runs two layers, in order; either failing fails the command. CI runs the same layers in separate jobs
(CI, below).

1. `pnpm test:unit`: Vitest, every package plus `tools/harness/test` (comparator, golden store, budgets, bundle size,
   model-view helpers).
2. `pnpm test:browser`: Playwright in a pinned headless Chromium on software WebGL (SwiftShader), `tools/harness`, and the landing page's suite in `packages/site` (its own Playwright config, docs/site.md).

Run `pnpm browsers` once per machine (and after a Playwright version bump) to install the browser. Playwright is pinned
to an exact version in `tools/harness/package.json`, which pins the Chromium revision.

## CI

`.github/workflows/ci.yml` has three jobs, each with `timeout-minutes: 20`:

- `check`: install, typecheck, lint, format check, `pnpm -r build`, `pnpm run test:unit` (Vitest, bundle size
  included).
- `e2e`: a matrix of 9 shards (golden 1-4 of `--project=golden --shard=<k>/4`, pair 1-2 of `--project=pair --shard=<k>/2`, bake 1-3 of `--project=bake --shard=<k>/3`) (`fail-fast: false`), each on its own VM: install, the pinned Chromium, `pnpm -r build`,
  then `playwright test --project=<project> --shard=<k>/<n>`, then on golden shard 1 only `pnpm --filter @modelshot/site run test:browser` (it runs even when the harness tests failed), uploading `tools/harness/test-results/` and `packages/site/test-results/` as `browser-test-results-<golden-k|pair-k|bake-k>`.
- `bench`: its own VM, same install and build, `playwright test --project=bench` (the one budget test), uploading
  `browser-test-results-bench`; the budgets are measured on a machine that runs nothing else.

Why: on one runner the browser suite alone outran the 20-minute limit (run 39545935955 on 4861384 was cancelled in
`pnpm test`; the e2e part ran over 19 minutes with one worker, the baked-light tests about 37 s each). Shards are
separate VMs, so each keeps one worker and the budgets measure an otherwise idle machine; neither the timeout nor
the worker count changed. For the shards to split the suite the `golden` project is `fullyParallel` (its tests share
no state; with one worker nothing runs at once, it only lets a shard take part of a file), and `bench` no longer
depends on `golden` (a dependency put every golden test into the bench's shard: shard 1 had all 219 tests, 2-4
none). The `golden` project excludes the tests titled `baked lighting` or `like the baked preview` (`grepInvert`); the
`bake` project runs only the first, the `pair` project (the 9 preview-vs-render pairing tests of `pathtracer.spec.ts`)
only the second: shards are contiguous ranges, so a block of slow tests always landed in one or two shards. Listed locally
(`--list`, MS-19): `golden` 208 tests in 4 shards, 52 / 52 / 52 / 52; `pair` 9 tests, 5 / 4; `bake` 24 tests, 8 / 8 / 8;
`bench` 1 test; 242 in all, each once, as the plain `playwright test` (and so `pnpm test`) runs every project. By the times of
run 39624802150 (normal VM) the heaviest golden shard (2) takes about 5 minutes (about 10 on a 2x slow VM), a pair shard 3.8 (1.1-1.3 minutes per test; 7.6 on a 2x
slow VM; with the three look-preset pairs of MS-19 a pair shard holds up to 5 tests, about 6 minutes, 12 on a slow VM),
against the 20-minute limit.

Why: the shard holding the baked tests ran into the 20-minute job limit with 4 shards (cancelled in runs 39612706830 and
39624802150; the 23 baked lighting tests alone took 13-15 minutes on the slow VM of the second), and the 6 pairing tests
alone are about 11 minutes together on a normal VM. The VMs differ in speed by up to about 2x on the same image (the
cut-out checker bake took 1.3 minutes on one, 39 s on another), so a shard needs room for the slow case; the bench no
longer shares a VM with the bakes.

Timeouts: the Playwright default is 30 s and stays. On the runners (SwiftShader, 3-5x slower than local) some tests
came near or over it; the worst of runs 39594658979 and 39612706830 per test: the baked goldens
`rt-bake-cutout-checker` and its fallback over 30 s, `rt-bake-turntable-y030` over 30 s, `rt-bake-alpha-plane` 24.5 s;
the path-tracer determinism batches test 35.0 s (over 30 s), its same-seed test 15.2 s, `pt-alpha-plane` 22.4 s, the
transparency tests up to 22.5 s, the lifetime tests 14.9-18.6 s, the 10 000 coincident cubes test 10.0 s. A suite or
test whose CI time reaches a third of the default carries a timeout: 180 s for the baked goldens (bakes took 33-42 s in run 39624802150), 300 s for the baked lighting describe, 480 s for its determinism test (1.6 minutes on a normal runner, over 3 on a slow one), 300 s for the baked-preview pairing tests (up to 1.3 minutes, about 2.6 on a slow VM), 120 s for the path-tracer goldens, determinism, transparency and lifetime describes and the coincident cubes
test (at least 3x the worst measured time). A hang now fails after that time, not after 30 s; several hangs in one
shard can reach the 20-minute job limit, and the job is then cancelled instead of reporting the failures.

FFmpeg: `playwright install` fetches FFmpeg with every browser (playwright-core has no flag to skip it). The first
mirror (`playwright.download.prss.microsoft.com`) does not resolve on the runner; the downloader falls back to
`cdn.playwright.dev` and the step passes in both runs, so the install is not a failure cause and the workflow is
unchanged.

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
  `tools/harness/test-results/` (the path is in the failure message); CI uploads `test-results/` of each shard as the
  `browser-test-results-<shard>` artefact.
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
- Animation frames (MS-21) are data goldens, not images: `packages/formats/test/bbmodel/__goldens__/animated.frames.json`
  holds every animation of the `animated` fixture through `animateScene` at t = 0, 0.125, 0.5, length − 0.05,
  length, length + 0.3 and 2 · length + 0.1 (start, inside the first keyframe gap, at a keyframe, either side of the
  end, past the end where `once`, `hold` and `loop` differ, a later repetition), with node rotation, translation,
  scale and world matrix rounded to 10⁻⁶, plus `animationFrameTimes` at 24 fps. `animated.json` and
  `animated-unsupported.json` (every unsupported animation part, with its warnings) are loader goldens like the
  others. Hand-computed values for each pair rule sit beside them in `loadBbmodel.golden.test.ts`. Rendered clip
  frames belong to the export goldens (MS-22).
- Frame-strip textures (MS-27) are pinned by the data golden `frame-strip.json` (a `java_block` cube on a 16×64
  four-frame strip and a 16×16 still: strip faces with v in [0, 4] of the 16-unit UV space, `frames` with count 4,
  frame time 0.15 s, order [0, 2, 1, 3] and interpolate), by `texelExact.test.ts` (strip faces scaled back by uv height
  × count give the authored corners exactly) and by `textureFrames.test.ts` (count formula, timing, order, hostile
  fields). No render golden: renderers sample the same document UVs, which put frame 0 inside the image.
- Texture render modes (MS-29) are pinned by the data goldens `render-modes.json` (a `free` cube with one face per
  `render_mode`: default, emissive, additive, layered as default, an unknown string and a number, both warned) and
  `layered.json` (a `bedrock` cube and mesh, four textures, three layered and one of those hidden: every face on the
  appended composite with `layers` [0, 1, 3]), and by `formatRules.test.ts` (each mode, the layer rules per format,
  hostile values, Blockbench's default texture per format). `nested-groups.json` changed with them: its `bedrock`
  blank faces now show the default texture. No render golden: no renderer reads the new fields yet (MS-32).
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

**Rounded edges** (MS-15, `test.describe('rounded edges')`; the fixture's `edges=<width>` sets `EdgeLook.width`, 0
none, else the renderers' default `EDGE_LOOK_V0`, and its `rt.setEdges` / `pt.setEdges` change it on the page). The
generated `edges` scene (`fixtures/src/edgesScene.ts`, code-built, no licensed asset): a Blockbench cube and a
zero-thickness double-faced card through `loadBbmodel` (alpha-plane's texture), a Blockbench-style wedge mesh (flat
faces with their own vertices, a 45° slope), a single-sided plane and a smooth welded sphere; variant `edges` (yaw 30°,
pitch 35°). Golden `rt-edges`, default tolerance.

- Planes, cards and smooth areas: the pixels of the plane, the card and the sphere (those that change when the mesh is
  hidden, `hide=`, less the cube's and the wedge's MSAA silhouette pixels) are byte-identical with rounding on and
  `edges=0`, float and fallback (0 of 1 014 / 1 272 / 1 584 float, 982 / 1 210 / 1 544 fallback).
- Sharp-edged meshes change only beside their edges: every pixel that rounding changes (1 895 float, 1 729 fallback)
  lies within the band's projected width plus 2 px (4.82 px) of a projected sharp edge of the cube or the wedge.
- The cube's up face 0.15 units from its south edge, which faces the key, is brighter than the face centre (120.4 vs
  117.4 levels; unrounded it equals the centre).
- `setEdges`: width 0 draws the bytes of `edges=0`, width 0.5 again the initial bytes (a uniform); sharp angle 100°
  (the cube's 90° edges no longer sharp, the wedge's 135° ones still) differs from both, and 30° again gives the
  initial bytes (detection again, geometry uploaded again); `width -1`, NaN and `sharpAngleDeg 180` throw a `RangeError`
  naming `edges.width` / `edges.sharpAngleDeg` and change nothing; `edges=5` is a malformed parameter.
- Context loss: after a loss and restore the `edges` view has the same bytes (attributes 9-10 uploaded again).
- The hidden-face comparisons above (`closed-cube`, `step`, `closed-cube-cutout` against their `-open` variants) run
  with `edges=0`: an open variant lacks faces, so its edges there are boundaries that are not rounded, which is a
  difference of rounding, not a hidden face showing.

Goldens regenerated on purpose in MS-15 (default rounded edges, and in the render the bounce mirrored below the
surface; same views, seeds and samples): `rt-turntable-y000`, `-y030`, `-y060`, `-y090`, `rt-iso`, `rt-closeup`,
`rt-fallback`, `rt-player-classic-front`, `-classic-back`, `-slim-34`, `-legacy-34`, `-walk-hold-34`, `-slim-fallback`,
`-wave-front`, `rt-bake-turntable-y030`, `rt-bake-cutout-checker-fallback`; `pt-turntable-y030`, `pt-iso`,
`pt-closeup`, `pt-emissive`, `pt-player-hold-34`, `pt-cutout-checker`, `pt-alpha-plane` and `pt-render-order` (181
pixels along the ground box's back edges, at most 14 levels; its probes pass unchanged). The changes sit on the cube
edges (largest `rt-closeup`: 7 013 pixels, mean 0.93 levels; `pt-closeup` 9 754, 0.93). Within tolerance and so not
rewritten: `rt-far`, `rt-gltf-nodes-y030`, `rt-obj-shapes-y030`, `rt-player-hold-34`, `rt-player-legacy-opaque-hat-34`,
`rt-bake-cutout-checker`, `rt-bake-alpha-plane`, and as required `rt-fit-flat-cube`, `pt-alpha-ramp-blend`,
`gradient`, `progressive.s7.n64` and every model-view golden (their fixture has its own shaders).

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

| golden                         | view                                            | checks                                       |
| ------------------------------ | ----------------------------------------------- | -------------------------------------------- |
| `pt-turntable-y030.s1.n64`     | showcase, perspective 35°                       | golden; determinism; bleeding; pair          |
| `pt-iso.s1.n64`                | showcase, orthographic isometric                | golden; pair                                 |
| `pt-closeup.s1.n64`            | showcase, half the fit distance (texels ~28 px) | golden                                       |
| `pt-alpha-plane.s1.n128`       | alpha-plane.bbmodel, model-view camera          | golden; shadow probes; back side; pair       |
| `pt-alpha-ramp-blend.s1.n128`  | the 16 x 16 alpha ramp (blend, cutoff 0.01)     | golden; stochastic transparency              |
| `pt-render-order.s1.n16`       | render-order.bbmodel, model-view camera         | golden; render-order probes                  |
| `pt-emissive.s1.n64`           | showcase, bricks emitting (4, 2.2, 0.8)         | golden; the post beside the bricks brightens |
| `pt-player-hold-34.s1.n64`     | MS-20 player, hold preset, cube in the hand     | golden; pair with `rt-player-hold-34`        |
| `pt-cutout-checker.s1.n128`    | generated cut-out checker and box, `checker`    | golden; checker shadow probes; pair          |
| `pt-edges.s1.n128`             | generated `edges` scene (MS-15)                 | golden; rounded-edge probes; pair            |
| `pt-preset-marketplace.s1.n64` | `player-hold-34` under Marketplace (MS-19)      | golden; tile/batch determinism; pair         |
| `pt-preset-rim.s1.n64`         | `player-hold-34` under Rim (MS-19)              | golden; pair                                 |

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

**Rounded edges** (MS-15): on the `edges` scene, 128 samples, the plane, card and sphere pixels (the preview's masks)
of the render with rounding stay within the default golden tolerance of the render with `edges=0` (0 of 3 870 pixels
differ, mean delta 0.0025: only light bounced off rounded neighbours moves); the cube's key-facing edge (3 x 3 mean)
is brighter than the face centre (118.7 vs 117.4, unrounded equal); `setEdges` behaves as in the preview (width 0 the
bytes of `edges=0`, the angle round trip the initial bytes, bad values a `RangeError` naming the field).

**Pair tests** (preview vs render): `rt.html` baked (`bake=64`) and `pt.html` of the same view. Framing, with the
shadow catcher off on both sides (its edge fades into the backdrop): the backdrop masks (within 2 levels of the view's
look's backdrop in that row, `agxToneMap(backdropColor(look, y), look.toneMapping)`, so a gradient counts as backdrop;
before MS-19 the top-left pixel) must agree on every pixel off the silhouette (a pixel whose 3 x 3 neighbourhood in the preview holds
both classes) that the two images draw more than 2 levels apart (a dark texel near the backdrop colour falls on either
side of the mask test, with the same colour in both views); 0 mismatches is the limit. Radiance, catcher on both: pixelmatch `threshold 0.1` with `maxDiffRatio`
and `maxMeanDelta` = measured x 1.25 and never above the previous limit, never widened; the render differs where it
has interreflection and noise. Logged as `[pt pair] <view>: ...`, values in `test-results/pt-pair-<view>.json`.
Measured on SwiftShader (local Windows dev machine, deterministic), MS-15 with rounded edges and the mirrored bounce
(MS-16's values in brackets; every limit stayed, none widened, `edges` is new at measured x 1.25):

| view                       | framing: mismatches (silhouette px) | radiance: pixels, ratio, mean delta           | limit: `maxDiffRatio`, `maxMeanDelta` |
| -------------------------- | ----------------------------------- | --------------------------------------------- | ------------------------------------- |
| `turntable-y030`           | 0 (1 604)                           | 201, 0.00307, 0.772 (185, 0.00282, 0.762)     | 0.00353, 0.953                        |
| `iso`                      | 0 (1 543)                           | 366, 0.00558, 0.959 (335, 0.00511, 0.942)     | 0.00639, 1.18                         |
| `alpha-plane`              | 0 (689)                             | 2 083, 0.03178, 2.187 (2 083, 0.03178, 2.189) | 0.0398, 2.48 (2.187 x 1.25 is above)  |
| `player-hold-34`           | 0 (1 322)                           | 1 208, 0.01843, 1.293 (1 215, 0.01854, 1.295) | 0.0232, 1.62                          |
| `cutout-checker`           | 0 (3 307)                           | 293, 0.00447, 0.731 (275, 0.00420, 0.726)     | 0.00525, 0.908                        |
| `edges`                    | 0 (1 979)                           | 43, 0.00066, 0.397                            | 0.00082, 0.496                        |
| `preset-marketplace`       | 0 (1 322)                           | 1 168, 0.01782, 1.229                         | 0.0223, 1.43                          |
| `preset-rim`               | 0 (1 322)                           | 1 300, 0.01984, 1.059                         | 0.0241, 1.13                          |
| `preset-marketplace-yaw30` | 0 (1 304)                           | 1 396, 0.02130, 1.219                         | 0.0266, 1.52                          |

MS-19 measured the table again with the backdrop mask by rows: every earlier view kept its numbers and limits. The two
look-preset pairs (`preset-marketplace`, `preset-rim`: the held-cube player baked under its look) are new at measured
x 1.25, measured again after the preset numbers were tuned against the references and the path tracer's
accents moved to the camera hit (round 2), Marketplace once more after its rim moved behind the key side and grew
(round 3: a different look, so a new baseline above round 2's 0.0222, 1.32), and all of them again with the
view-relative rim (round 4), where a limit stayed wherever the measurement x 1.25 would have raised it.
`preset-marketplace-yaw30` (the same player and look from the app's default yaw 30, where the rim follows the camera)
is new at measured x 1.25.

alpha-plane's large ground is an untextured box, baked per vertex, so its preview shows no ground shadow (world-density
charts for untextured meshes are not in MS-16); the catcher under it darkens its mean delta a little.

### Look presets

MS-19 ([look-presets.md](look-presets.md)). Both fixtures take `preset=<id>` (a `LOOK_PRESETS` id, default `studio`;
the realtime fixture bakes under it) and `rim=0` (the preset's rim light black); the variants `preset-marketplace`,
`preset-rim` and `preset-marketplace-fallback` are the `player-hold-34` view under a look, baked with 64 samples in
the preview, `preset-marketplace-yaw30` the same from yaw 30 (a pair only). Studio is the v0 look, so every golden from before holds unregenerated. New goldens: `rt-preset-marketplace`,
`rt-preset-rim`, `rt-preset-marketplace-fallback` (baked, default tolerance), `pt-preset-marketplace.s1.n64`,
`pt-preset-rim.s1.n64` (path-tracer tolerance); pairs above. Tests (`look presets` describes of `realtime.spec.ts`
and `pathtracer.spec.ts`, golden project):

- the Marketplace backdrop of an empty scene, every row at three columns, within 2 levels of its TS mirror on the
  float path, the fallback and the path tracer in 64-pixel tiles at 1 and 4 samples (measured worst 0.5 levels);
- `setLook` draws the bytes of a renderer created with the look, an invalid look (`bad`: catcher strength 1.5) names
  `catcher.strength` and changes no byte, Studio again gives the first bytes (preview and render);
- a look set while the render's `setScene` decodes gives the bytes of a render under that look from the start;
- Marketplace renders the same bytes in batches of 7 and 64-pixel tiles;
- the rim light, unshadowed: of the pixels it brightens by more than 12 levels in the preview (Rim against `rim=0`,
  unbaked) the render brightens 99.97 % too (3 277 preview, 3 553 render pixels: the jittered camera rays catch a
  little more of the grazing fillets);
- the Marketplace rim's white line (`pathtracer.spec.ts`): the held-cube player at 512 px, pitch 20, yaw 210 and 30,
  baked preview and render (16 samples). Silhouette pixels (`silhouettePixels` of `imageMetrics.ts`: more than 4
  levels off the row's backdrop in column 1, a backdrop pixel within 2 px) with every channel above 200
  (`whiteCount`): at least the measured count / 1.25 in both (896 preview / 826 render at 210, 503 / 520 at 30;
  floors 660 and 402), preview and render within 25 % of each other; blown-out pixels (every channel 250 or more) at
  most the measured share x 1.25 (none anywhere) and under 2 % of the model. The saturated test skin is the case a
  diffuse rim (round 3) never drew white on;
- the turntable (`realtime.spec.ts`): Marketplace on the same player unbaked (the bake only darkens), 512 px, pitch
  20, yaws 0 to 330 in steps of 30: no blown-out pixel (measured none), at least 85 white silhouette pixels (the
  fewest measured: 107, at yaw 0, the player's back);
- a lost preview context comes back with the look, byte-identical;
- (bake project) light baked under Marketplace is refused by a Studio renderer and taken once it shows Marketplace.

The look review page `review.html` (harness only, no build ships it) renders a `.bbmodel` the user picks (read from
the file input, nothing fetched; none: the harness player with a held cube) under a preset, side by side: the baked
preview (64 samples) and the render (seed 1, `samples`, default 256), `size` CSS pixels (default 512), yaw and pitch
inputs (initial values from the `yaw` and `pitch` URL parameters, defaults 210 and 20), a PNG download of each. The camera fits the model's outline (its visible vertices projected from yaw and
pitch) to 90 % of the view on the tighter axis, centred (`fitCameraToPoints`, tested); unticking "Fit" uses the
app's bounding-sphere framing. `environment.spec.ts` opens it at 4 samples and checks it finishes on the fixture
origin. Step 14 of MS-19 compares its Marketplace output with reference renders kept outside the repository.

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
size of `app`, `embed`, `site` and `site-assets`. `site` is a plain `vite build` of `packages/site` without the `/app/` copy that `build:with-app` adds; `site-assets` is the same build's woff2 and svg files. `pnpm test` measures them (`bench.spec.ts`; the bundle is built fresh into a temporary directory, so
it does not depend on `pnpm -r build`) and fails when a value exceeds its `max`, when a budget has no measurement, or
a measurement has no budget. The measured values are in `tools/harness/test-results/budgets-measured.json`, and
every run prints each one against its max (`[budget] <group>.<key>: measured … / max …`, from `bench.spec.ts` and
`test/bundleSize.test.ts`; Vitest runs with `silent: false` so passing tests print too). Both measure every target in `BUNDLE_TARGETS`
(`tools/harness/src/bundleSize.ts`), and `test/bundleSize.test.ts` fails when that list and the `bundleGzipBytes` rows
differ, so a new row cannot go unmeasured.

Measured on the local Windows dev machine (SwiftShader, 3 runs) when the budgets were set: frame time median 0.3, 0.3,
0.4 ms; time to 64 samples median 23.8, 23, 25.8 ms; gzip app 437 B, embed 115 B.

`frameTimeMs.rt-bench-512` is the realtime renderer on the benchmark scene (`fixtures/src/benchScene.ts`: 16 x 16 x 8
textured cubes, 2,048 cubes, 24,576 triangles, one mesh per cube in 128 group nodes of 4 x 4 cubes as the Blockbench
loader produces a grouped model, so 512 draw calls per frame after batching per node (checked by the spec), every
seventh with a partial-alpha face; 512 x 512, 4x MSAA, front and back face passes, opaque and transparency passes),
median of 30 frames after 5 warm-up frames. Max 2000 ms (MS-44), from the CI medians of the `bench` job: 608.5 ms on
a normal runner (run 39594658979) and 944.4 ms on a runner about 1.55x slower on this bench (1.71x on the other rt-bench row; 1.33-1.46x on the remaining benches) (run 39650722835,
where the earlier max of 750 ms failed). 2000 ms is 3.3x the normal CI median and 2.1x the slow one, the 3-4x-CI-median
rule of `timeToSamplesMs`, because runner speed varies up to about 2x between VMs of the same image. The last local
SwiftShader median is 375.2 ms (`budgets-measured.json` of the full build test of 2026-10-21). History: the first
local medians were 68.9, 70.2 and 80.7 ms (3 runs, 128 group nodes batched per node) and the max of 750 ms was 10x the
middle run, rounded up; renderer work since (MS-12's double-sided cubes and coverage per texel tap, MS-15's rounded
edges) raised the local median about 5x, so that max had shrunk to 1.2x a normal CI median. SwiftShader cannot
stand in for a laptop GPU: the 60 fps criterion is evidenced by a manual run of the `fps=1` page on real hardware
(16.7 ms or less of frame work), recorded with the machine and GPU in the task.

`frameTimeMs.rt-load-first-frame-200k-order` times `setScene` plus the first frame of a generated scene at the
loader's limits (100 000 quads, 200 000 triangles, 400 000 vertices) at render order 1, which builds the exact key's
de-indexed geometry and its shared-edge flags at upload: local SwiftShader 348, 344 and 354 ms before the flags, 506
and 527 ms with them; since round 7 436 and 447 ms; max 3500 ms (10x of the first measurement).

`frameTimeMs.rt-bench-order-512` is the same scene with one mesh at render order 1, so every frame uses the exact
depth key (fragment depth, de-indexed geometry); max 2000 ms like the raster bench (MS-44): CI medians 537.9 ms on
the normal runner (run 39594658979) and 919.5 ms on the slow one (run 39650722835), so 3.7x and 2.2x; last local
median 326.8 ms (`budgets-measured.json`, 2026-10-21). History, MS-12 local SwiftShader medians: `rt-bench-512` 92,
118 and 120 ms (raster key, cubes double-sided as the loader marks free-format faces, coverage per texel tap),
`rt-bench-order-512` 117, 145 and 148 ms with MSAA, 83 and 107 ms since exact frames draw single-sampled (MS-12
round 7); its max was 750 ms then.

- `frameTimeMs` max 5: the median is below 1 ms and `performance.now` is coarsened to 0.1 ms without cross-origin
  isolation, so 5x the median (2 ms) would be 20 ticks and one GC pause from flaking on a shared runner. 5 ms is 12-16x the
  local median and still catches about 12x and above over the local median.
- `timeToSamplesMs` max 300: about 3.7x the CI median (80.6 ms) and 12x the worst local median (25.8 ms); the first limit of 150 left under 2x on shared runners.
- `timeToSamplesMs.pt-bench-128-n256`: the path tracer on the benchmark scene (24 576 triangles), 256 samples at
  128 x 128 (one 256-pixel tile, so one draw call per sample) until the GPU finished, median of 3. Local SwiftShader
  medians 6096, 5160 and 4970 ms (3 runs, MS-17); max 52 000 ms is 10x the middle run, rounded up, as for
  `rt-bench-512` was first set, until a CI artefact allows 3-4x the CI median. Under 60 s locally, so the bench stays at 128 x 128.
  Real hardware (RTX 3080, ANGLE D3D11): 88 ms at 128 x 128, 234 ms at 512 x 512.
- `frameTimeMs.pt-load-200k`: `setScene` of the generated 200 000-triangle scene of
  `rt-load-first-frame-200k-order` (validate, flatten, BVH build in JavaScript, upload) plus its first sample. Local
  SwiftShader 1554, 919 and 941 ms; max 10 000 ms (10x the middle run, rounded up).
- `bundleGzipBytes` app 4500 (measured 2490; MS-31 grew the app 437 -> 2490), embed 2200: measured plus about 2 kB, so a real dependency shows up while noise does not.
  `site` 11 600 (MS-31: the landing page's js, css and html, gzip level 9; measured 9595, 9595, 9595 bytes, plus about
  2 kB) and `site-assets` 110 400 (its woff2 fonts and svg, each gzipped; measured 100 311 three times, times 1.1
  rounded up). The landing page's browser tests are described in docs/site.md.
- `bakeTimeMs.bake-bench-n16` (MS-16): `LightBaker.bake` of the benchmark scene in its worker, 16 samples with the
  shadow catcher (lightmap 2048 wide, catcher 512 x 512), from the call to the final lighting, median of 3. Local
  SwiftShader 22 873, 22 113 and 22 141 ms; max 222 000 ms (10x the middle run, rounded up). Each run is asserted
  against the max as it completes, and the bench test's timeout is 3 x that max + 300 s, so a slow bake fails its
  budget instead of the timeout.
- `mainThreadBlockMs.bake-bench` and `mainThreadBlockMs.bake-post-200k` (MS-16): **the most one task of the page's
  main thread blocked**: its CPU time plus the time it waited synchronously for the GPU process, from a Chrome trace
  over the bake window (`src/mainThreadTrace.ts`: CDP categories `toplevel,gpu`; top-level tasks `RunTask` with their
  thread CPU time `tdur`, thread `CrRendererMain`; GPU waits are the command-buffer client's
  `CommandBufferProxyImpl::WaitForGetOffset` (a readback or state query: `readPixels`, `getError`, `finish`) and
  `CommandBufferProxyImpl::WaitForToken` (an upload waiting for transfer-buffer space: `texSubImage2D`), found in this
  Chrome's traces of such calls after heavy draws, each counted as its wall minus its own CPU; the trace throws
  without a main thread or a task, when no task carries CPU time, or when a task of 1 ms or more lacks it (Chrome
  leaves it off zero-length tasks)): the three benchmark bakes, and the 1-sample bake of the 200 000-triangle
  `large-order` document (its `bake()` call, mesh stream and updates). Every task counts, those Playwright's
  `evaluate` runs (which call `bake()`) included, which the Long Tasks API does not report. Max 50 ms, fixed (RAIL's
  50 ms response budget). Wall time is printed beside it, not asserted: the page-side wall-time block
  (`eventLoopLag.ts`: long tasks, timed phases), the heartbeat lag and the trace's longest task as wall / CPU with its
  largest wall − CPU gap. On a shared, loaded machine wall time also counts the OS not running the thread: full build
  tests read 72 ms of wall time for a `bake()` call doing about 1 ms of work, and under 30 local CPU spinners the
  trace showed a 9.4 ms wall / 0.6 ms CPU task (round 6); that is excluded, while a wait for the GPU process (a wait
  event, wall time without CPU too) is counted, since the page cannot respond meanwhile (round 8). `realtime.spec.ts`
  proves both halves: at least 80 ms of busy work (a workload calibrated to 100 ms at its fastest measured speed)
  reads 99-106 ms in a timer task and in an `evaluate` (a wall-clock spin of 80 ms reads only 78 ms of CPU, which is
  why the probe counts work, not time); a `readPixels` after four frames of the benchmark scene at 512 x 512 waited
  685.8 ms, the trace counted 685.4 ms of GPU wait beside 3.1 ms of CPU, blocking 688.4 ms.
  History of the earlier wall-time measure:
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
    sample): the longer of the call's own duration (option checks and validation; since round 5 the call posts nothing,
    the document's meshes stream in later tasks) and the
    block over the bake. Measured 16.2 and 14.9 ms; max 50 ms, fixed like the row above. Round 5: the full build test
    put the `bake-call` phase at 44.6 ms under load (a structured clone of every mesh in one task). Meshes now stream as
    transferred chunks in later tasks and only when the worker lacks them, and the fixture times every worker
    `postMessage` (`worker-post`): `bake-call` 0.7 ms idle and 1.1 ms under load (12 CPU spinners and a parallel
    path-tracer browser), `worker-post` at most 0.4 ms, block 1.4 and 1.6 ms, `bake-post-200k` 2.5 and 4.0 ms.
    Round 6: a full build test read a single `bake-call` of 72 ms (heartbeat 66.4 ms, no long task: the call runs in a
    Playwright `evaluate`). Locally the call does 0.3-1.8 ms of work (600 calls under 30-40 CPU spinners, each in its own
    task, beside an allocation-free loop of equal cost), V8's `--trace-gc` shows no pause over 2.6 ms in 300 collections
    over three bench bakes, and a Chrome trace shows the renderer main thread losing up to 11.5 ms of wall time inside
    tasks with no CPU behind it (the worker thread up to 82 ms): the OS not running the thread. The bench therefore
    traces the bake runs (`src/mainThreadTrace.ts`, CDP top-level tasks with thread CPU time) and prints the main
    thread's longest task as wall / CPU ms and its largest wall − CPU gap, so a slow phase on a loaded machine shows
    whether it was page work. Limit and measure unchanged in round 6; round 7 made the trace the measure (above). In the same runs
    `rt-load-first-frame-200k-order` (now with the lightmap layout) measured about 600 ms of its 3500.

MS-15 (rounded edges: sharp-edge detection at `setScene`, two more vertex attributes and the rounding in every mesh
fragment, 9 instead of 5 attribute texels per triangle in the path tracer): `budgets.json` unchanged, every budget
passes. Two bench-only runs on the local Windows dev machine (SwiftShader), against MS-16's last full test runs on the
same machine (215-217, 208, 1140-1230, 945-970, 6126-6320 ms and 25.8-29.3 s): `rt-bench-512` 274.8 and 285.5 ms
(about +30 %: the bench's 2 048 small cubes are nearly all within the rounding band, and SwiftShader runs the
fragment work on the CPU), `rt-bench-order-512` 201.0 and 241.3 ms, `rt-load-first-frame-200k-order` 956.3 and
1300.9 ms (its quads have no sharp edge), `pt-load-200k` 954.9 and 1344.3 ms, `pt-bench-128-n256` 3567.9 and
4862.3 ms, `bake-bench-n16` 18.6 and 24.9 s (the bake binds width 0), `bake-bench` 3.3 and 2.8 ms, `bake-post-200k`
8.0 and 9.1 ms; bundles 437 and 115 B (no dependency). The spread between the two runs is the machine's; real hardware
is not measured here. `sharpEdges` alone of 16 667 separate cubes in one mesh (200 004 triangles, 200 004 sharp
edges) takes 0.19 s in Node on the dev machine (2.2 s before welding and slot search moved to typed arrays and hashing
in round 1).

`frameTimeMs.rt-load-first-frame-200k-edges` and `frameTimeMs.rt-load-first-frame-edges-hostile` (MS-15) time
`setScene` plus the first frame like `rt-load-first-frame-200k-order`, on generated scenes whose detection runs on
fresh meshes (`fixtures/src/edgesScene.ts`): `edges-200k`, those 16 667 cubes (200 004 triangles at the loaders'
limit, every edge sharp), and `edges-hostile`, nine meshes that are each a plate of 100 x 100 cells of 0.01 units
walled on all four sides (20 800 triangles each, 187 200 in all). Within the 4-unit reach every plate triangle visits
all 404 sharp edges of its patch: about 5 · 10⁷ work units per plate, so the document's `MAX_EDGE_WORK` (10⁸) stops
the slot search in the third plate (round 2: the earlier cap counted checks per mesh, so one such plate at that cell
size took 10 s and nine about 30 s; unit-tested in `sharpEdges.test.ts`). Local SwiftShader 997, 1215 and 913 ms;
hostile (one 300 x 300 plate, round 1) 891 and 938 ms, the nine plates 951 ms; the large-order load beside them 1254,
1149 and 797 ms. Max 3500 ms each, the limit of the load budget they extend: about 3x the measurement, so a return of
the first detection (2 s more on `edges-200k`) or an unbudgeted hostile document fails it, while the CI runner keeps
its margin as for the sibling.

`frameTimeMs.rt-load-first-frame-edges-weld` (MS-15 round 3): the same load of `edges-weld`, 100 000 quads (200 000
triangles, 400 000 vertices) on a grid of 65 536-unit steps, each quad with its own vertices: every quantised
coordinate is a multiple of 2^20 and every edge is shared, the worst case of the multiplicative hash with linear
probing that matching used before (about two minutes at this size; `sharpEdges` alone took 2.0 s for 60 000 such
vertices). Matching sorts now: 752 ms local SwiftShader for the whole load (`sharpEdges` alone 0.15 s for 400 000
vertices), max 3500 ms as for the other load budgets. The same run: `edges-200k` 1158 ms, `edges-hostile` 1194 ms,
`large-order` 896 ms.

Memory of detection at the loaders' vertex limit (MS-15 round 4): `sharpEdges` of the `edges-weld` mesh (400 000
vertices, 200 000 triangles, input 11.4 MB) in Node 22 with `--expose-gc`, a fresh Vitest worker, collected before:
the process's peak resident set grows by 62.8, 62.9 and 63.9 MB (`process.resourceUsage().maxRSS`, three runs; to
about 143 MB), in 264-419 ms. Of that the result kept with the mesh is 16.0 MB (`vertexOf`, `indices`, `distances`,
`angles`); the rest is sort keys, ranks and edge tables, garbage once it returns (right after: heap +29 MB, array
buffers +38 MB before collection). The renderers keep one result per document (`sceneSharpEdges`, latest options).

First CI run (2026-10-20, ubuntu-latest): frame time 0.9 ms (max 5, 5.5x), time to 64 samples 80.6 ms (max 300), gzip app 437 B, embed 115 B.
Limits derive from the CI numbers: re-derive from the `budgets-measured.json` artefact (in the e2e shard that ran
`bench.spec.ts`), with the numbers in the commit.
Changing a `max` is a reviewed change: explain it in the commit with the measured numbers, never raise it to hide a
regression.
