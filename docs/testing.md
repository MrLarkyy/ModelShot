# Testing

`pnpm test` runs two layers, in order; either failing fails the command. CI runs the same layers in separate jobs
(CI, below).

1. `pnpm test:unit`: Vitest, every package plus `tools/harness/test` (comparator, golden store, budgets, bundle size,
   model-view helpers) and `tools/wiki/test` (page table, link and anchor check over the real docs, publish against a local bare repo).
2. `pnpm test:browser`: Playwright in a pinned headless Chromium on software WebGL (SwiftShader), `tools/harness`, the landing page's suite in `packages/site` (its own Playwright config, docs/site.md), the app's in `packages/app` (its own config, docs/app.md), the embed's in `packages/embed` and the deploy suite in `tools/deploy` (below).

Run `pnpm browsers` once per machine (and after a Playwright version bump) to install the browser. Playwright is pinned
to an exact version in `tools/harness/package.json`, which pins the Chromium revision.

## Time-bounded unit tests

No Vitest test reads the wall clock (`performance.now`, `Date.now`; ESLint refuses both, and `process.hrtime`, in `packages/*/test`, `*.test.ts`, `tools/harness/test` and `tools/wiki/test`).
Wall time also counts the time the OS does not run the thread, so a test that passes on an idle machine failed under load
(MS-42: three loader tests and the 10 000 coincident-triangle BVH test, which spent its time in about 400 000 per-triangle `expect` calls of the invariant checker, not in the 16 ms build, timed out beside about 30 busy cores). A test that
limits work is written in this order:

1. A deterministic work check: output sizes, an early refusal with the right error code, a spy proving a stage never ran
   (`cubeToMesh` not called for a 100 000-deep outliner, `decodePrimitive` once for 1000 instances), BVH structure (the
   exact depth of 10 000 coincident triangles pins the shape, a balanced tree from the median split by index; 2L − 1 nodes
   for L leaves pins that the tree is binary). Structure says nothing about cost, so the two BVH builds also carry a
   thread CPU bound (200 ms coincident, 400 ms chain; idle 16 and 31 ms), which pins the build cost.
2. Where the cost of a hostile input itself is the claim, `expectCpuBelow(maxMs, work)`
   (`packages/formats/test/support/expectCpuBelow.ts`, copies in `packages/scene/test/`, `packages/renderer-rt/test/` and
   `packages/export/test/` because those packages cannot import formats tests; each copy has its own
   self-test). It runs `work` synchronously, reads `process.threadCpuUsage()` (Node 22.19 or later) around it, and asserts
   the CPU time of the current thread: blocked or descheduled time is not counted, a promise-returning callback throws.
   Build the fixture outside `work`; the clock ticks in steps of about 15.6 ms on Windows, so bounds under 50 ms are
   only for work that measures 0 ms. A bound keeps its old number, now in CPU milliseconds; one is never widened to
   make a test pass. Thread CPU excludes the time V8 garbage-collection helper threads spend, so it bounds the test
   thread's own work, not the whole process.
3. Each package project has `testTimeout: 60_000` (`vitest.config.ts`), a hang backstop only, never a budget.

A real time budget (frame time, bake time) belongs to the bench ([Budgets](#budgets)), measured on a machine that runs
nothing else.

CPU ms per converted test, the maximum of 3 runs on an idle machine (Windows, Node 22.23), against its bound:

| Test                                                                                                                         | Idle CPU ms |        Bound |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------: | -----------: |
| obj/bounded: default triangle limit                                                                                          |        1046 |         5000 |
| scene/sharpEdges: 400 000 vertex grid                                                                                        |        1016 |         5000 |
| obj/bounded: ear clipping worst case                                                                                         |         656 |        15000 |
| bbmodel/bounded: concave 16-gons at the triangle limit                                                                       |         626 |         5000 |
| bbmodel/animations: 100 000 name-keyed animators                                                                             |         532 |         3000 |
| bbmodel/bounded: element limit                                                                                               |         469 |         5000 |
| bbmodel/hostile: 100 000 Hytale collections                                                                                  |         329 |         2000 |
| gltf/bounded: triangle and vertex limits                                                                                     |         298 |         5000 |
| bbmodel/animations: a million keyframes refused                                                                              |         250 |         2000 |
| obj/robustness: 300 000 distinct keywords                                                                                    |         141 |         3000 |
| player/loadSkin: 2 MiB of dynamic blocks                                                                                     |         110 |         1000 |
| player/loadSkin: 1024 x 512 16-bit skin                                                                                      |          94 |         1000 |
| obj/robustness: 100 000 `mtllib` lines                                                                                       |          78 |         2000 |
| bbmodel/hostile: 100 000-deep outliner                                                                                       |          63 |         1000 |
| scene/animateScene: 10 000 nodes, 3 frames                                                                                   |          47 |          600 |
| gltf/bakeMesh: 300 000 addressed vertices                                                                                    |          31 |         2000 |
| obj/hostile: 20 MB line                                                                                                      |          15 |         2000 |
| pathtracer/buildBvh: 4096-triangle chain                                                                                     |          31 |          400 |
| pathtracer/buildBvh: 10 000 coincident triangles                                                                             |          16 |          200 |
| bbmodel/hostile: the most textures all layered, loadSkin zlib bomb, bbmodel/textureFrames (three tests, bounds 50, 50, 1000) |           0 | 1000 or less |

## CI

`.github/workflows/ci.yml` has three jobs, each with `timeout-minutes: 20`:

- `check`: install, typecheck, lint, format check, `pnpm -r build`, `pnpm run test:unit` (Vitest, bundle size
  included).
- `e2e`: a matrix of 14 shards (golden 1-2 of `--project=golden --shard=<k>/2`, golden-pt 1-6 of
  `--project=golden-pt --shard=<k>/6`, pair 1-3 of `--project=pair --shard=<k>/3`, bake 1-3 of
  `--project=bake --shard=<k>/3`) (`fail-fast: false`), each on its own VM: install, the pinned Chromium, `pnpm -r build`,
  then `playwright test --project=<project> --shard=<k>/<n>`, then on golden shard 1 only `pnpm --filter @modelshot/site run test:browser` and `pnpm --filter @modelshot/app run test:browser` (each runs even when an earlier step failed), uploading `tools/harness/test-results/`, `packages/site/test-results/` and `packages/app/test-results/` as `browser-test-results-<golden-k|golden-pt-k|pair-k|bake-k>`.
- `bench`: its own VM, same install and build, `playwright test --project=bench` (the budget test and the three `@timing` measure tests of `realtime.spec.ts`), uploading
  `browser-test-results-bench` (its measurements are in `serial/`); the budgets are measured on a machine that runs nothing else.

`.github/workflows/wiki.yml` builds the GitHub wiki from `docs/` (`tools/wiki`, with a link check) and publishes it on a push to `main` that touches `docs/` or `tools/wiki/` (`contents: write` on that job only). A new docs page needs its row in `tools/wiki/pages.mjs`, or the check fails.

Why: on one runner the browser suite alone outran the 20-minute limit (run 39545935955 on 4861384 was cancelled in
`pnpm test`; the e2e part ran over 19 minutes with one worker, the baked-light tests about 37 s each). Shards are
separate VMs, so each keeps one worker and the budgets measure an otherwise idle machine; neither the timeout nor
the worker count changed. For the shards to split the suite the `golden` project is `fullyParallel` (its tests share
no state; with one worker nothing runs at once, it only lets a shard take part of a file), and `bench` no longer
depends on `golden` (a dependency put every golden test into the bench's shard: shard 1 had all 219 tests, 2-4
none). Playwright shards a project into contiguous ranges by test count, not by time, so a block of slow tests
lands in one or two shards; each block is its own project with its own shards. `golden` runs `environment`, `export`,
`golden*`, `modelView`, `realtime.spec.ts`, `textureFilter.spec.ts` and `textureWrap.spec.ts` without the tests titled `baked lighting`
(`grepInvert`), which `bake` runs, apart from the three `@timing` ones, which `bench` runs, and without the one titled
`like the baked preview`; `golden-pt` runs `pathtracer.spec.ts` without the tests titled `like the baked preview`,
which `pair` runs (the 16 preview-vs-render pairing tests of `pathtracer.spec.ts`, `textureFilter.spec.ts` and `textureWrap.spec.ts`). Each test is in exactly one project, and the plain `playwright test` runs every project, while `pnpm test` runs them in the two phases above (`bench` last, alone).

Shard sizes (MS-39, `--list --project <p> --shard <k>/<n>`), each with the sum of its tests' CI times: the per-test
times of main's run 39878163371 (MS-30's merge, so its three cut-out seam tests are counted), MS-22's 31 export tests
from main's run 39928740239 (MS-22's merge, job golden-1: 1.4 minutes together, 1.3-8.7 s each), plus local times for
MS-39's six new tests (four path-tracer tests, 29 s, and two pairs, 47 s). These are sums of test times, not job times; a job adds the install and build, and the VMs
differ by up to 2x. The build takes about 6 s (`bake-2` in run 39878163371: a 14.4-minute job for 4.4 minutes of tests, mostly the install, see Playwright install).

| Project     | Tests | Shards | Tests per shard             | Minutes per shard (sum)           |
| ----------- | ----: | -----: | --------------------------- | --------------------------------- |
| `golden`    |   216 |      2 | 108 / 108                   | 6.3 / 3.9                         |
| `golden-pt` |    93 |      6 | 16 / 16 / 16 / 15 / 15 / 15 | 2.6 / 4.3 / 6.3 / 3.7 / 1.0 / 1.5 |
| `pair`      |    16 |      3 | 6 / 5 / 5                   | 5.3 / 2.8 / 2.5                   |
| `bake`      |    22 |      3 | 8 / 7 / 7                   | 6.4 / 4.3 / 3.5                   |
| `bench`     |     4 |      1 | 4                           | its own job                       |

The test counts are MS-60's (after MS-38); the minutes are MS-39's sums, without the tests added since.

Playwright install: `playwright install --with-deps` took 12-15 s on most jobs but 4.5 to 9.4 minutes on some (main run
40368207797: `bake-3`, `golden-2`, `golden-pt-5`; run 39878163371: 13 s to 9.7 minutes). The browser download is not the slow part:
in `golden-2` `apt-get update` took 4 s and the .deb files (fonts, `libnss3`, `xvfb`; 24.9 MB) took 9 min 15 s from a mirror
at 45 kB/s. The local action `.github/actions/playwright` (used by `e2e`, `bench` and the pages `verify` job) restores
`~/.cache/ms-playwright`, keyed by the Playwright version, and the .deb files in `~/.cache/playwright-apt`, keyed by the runner
image and the Playwright version, so apt installs from `/var/cache/apt/archives` without downloading. A job that misses a
cache saves it right after the install, so a red test run still fills it (an apt cache with no .deb files is never saved); shards that miss at the same time only warn.
After the change, the cold run 40912380522 (MS-61's merge, both caches missed) took 14-31 s for the install step on all 15
jobs (the mirror was fast that time) and saved the browser cache (113 MB) and the apt cache (21.8 MB). The next, warm run 40915565605 restored both caches on every job, apt
downloaded nothing (`Need to get 0 B/21.9 MB of archives`), and the install step took 10-23 s; a slow mirror no longer
reaches it, only `apt-get update` (4 s) still uses the network.

351 tests in all. The path-tracer tests had been part of `golden` (241 tests in 5 shards of 48-49): the shard that held
48 of them summed to 16.0 minutes, the others 1.8-7.2, and the same block in shard 2 of 4 ran 16.3 and 17.4 minute jobs
on main. `golden-pt` has 6 shards because its two longest tests (a denoised 2x render in batches, 3.0 minutes, and a
denoised 2x render paired with the preview, 1.9 minutes) are four tests apart in the file: with 3, 4 or 5 shards one
shard holds both and sums to 10.0-10.8 minutes, with 6 the largest is 7.0 (both with run 39855838515's times; 6.3 with
run 39878163371's).

Why: the shard holding the baked tests ran into the 20-minute job limit with 4 shards (cancelled in runs 39612706830 and
39624802150; the 23 baked lighting tests alone took 13-15 minutes on the slow VM of the second), and the 6 pairing tests
alone are about 11 minutes together on a normal VM. The VMs differ in speed by up to about 2x on the same image (the
cut-out checker bake took 1.3 minutes on one, 39 s on another), so a shard needs room for the slow case; the bench no
longer shares a VM with the bakes.

Timeouts: the harness default is 60 s (30 s until MS-74: six parallel local workers stretched a 3.4 s test to 24 s). On the runners (SwiftShader, 3-5x slower than local) some tests
came near or over it; the worst of runs 39594658979 and 39612706830 per test: the baked goldens
`rt-bake-cutout-checker` and its fallback over 30 s, `rt-bake-turntable-y030` over 30 s, `rt-bake-alpha-plane` 24.5 s;
the path-tracer determinism batches test 35.0 s (over 30 s), its same-seed test 15.2 s, `pt-alpha-plane` 22.4 s, the
transparency tests up to 22.5 s, the lifetime tests 14.9-18.6 s, the 10 000 coincident cubes test 10.0 s. A suite or
test whose CI time reaches a third of the default carries a timeout: 180 s for the baked goldens (bakes took 33-42 s in run 39624802150), 300 s for the baked lighting describe, 720 s for its determinism test (1.6 minutes on a normal runner, over 3 on a slow one, 5.2 at six local workers), 300 s for the baked-preview pairing tests (up to 1.3 minutes, about 2.6 on a slow VM; MS-38's texture-filter pairing test 53.8 s at six local workers), 120 s for the texture-filter render golden (3.1 s at six local workers), 120 s for the path-tracer goldens, determinism and lifetime describes and the coincident cubes test, 180 s for the
transparency describe (66 s at six local workers), 300 s for the exact-key silhouette test (29.5 s serial), 600 s for the
exact-key catcher test (49 s serial) and the preset rim probes (42.6 s serial), 120 s for the realtime shimmer test (`texel anti-aliasing halves shimmer`, eight renders: 22-35 s alone locally, 30.3 and 31.1 s in the full serial suite, 24.1 s at six local workers), 180 s for the partial-alpha seam describe (MS-60: 5.4-11.8 s a test at six local workers, 6.9-15.4 s serial), 600 s for the partial-edge per-row pairing test (MS-60: 96 s serial, 3.5 minutes at six local workers); each at least 3x the worst CI time and twice the worst local time. A
hang now fails after that time, not after the 60 s default; several hangs in one
shard can reach the 20-minute job limit, and the job is then cancelled instead of reporting the failures.

FFmpeg: `playwright install` fetches FFmpeg with every browser (playwright-core has no flag to skip it). The first
mirror (`playwright.download.prss.microsoft.com`) does not resolve on the runner; the downloader falls back to
`cdn.playwright.dev` and the step passes in both runs, so the install is not a failure cause and the workflow is
unchanged.

## Browser tests

`pnpm test:browser` in `tools/harness` (`src/runBrowserTests.ts`) runs two phases. Phase 1 is `playwright test --grep-invert @timing`: every golden, path-tracer, bake and pairing test with several workers. Playwright hands out the tests of one run in the order of the `projects` list, so the list starts with the projects whose tests run longest (`pair`, `bake`, `golden-pt`, then `golden`): the many short golden tests fill the workers at the end instead of one long test running on alone. Phase 2 is `playwright test --project=bench --workers=1`: the `bench` project is every test tagged `@timing` (the budget test in `bench.spec.ts` and the three `baked lighting` tests that check the main-thread measures), run alone on an idle machine, with its own output directory `test-results/serial`. Phase 2 runs after a failed phase 1 (exit 1) but not after a kill or interrupt (any other exit code, a signal or a failed launch), which stops the runner with that non-zero code; SIGINT, SIGTERM and SIGBREAK are forwarded to Playwright. The script takes no arguments: use `pnpm exec playwright test <filter>` for a filtered run. The exit code is non-zero if either phase failed. A plain `playwright test` mixes the two, so use the script for a full local run. A test whose result depends on how busy the machine is gets `{ tag: '@timing' }`; every other project excludes the tag. There is no project dependency: it would skip the timing tests after a golden failure and pull the goldens into the CI bench job.

The worker count (`src/workerCount.ts`) is `MS_PW_WORKERS` (integer 1..32, anything else fails naming the variable), else 1 when `CI` is set, else the smaller of 6, one per four logical CPUs (SwiftShader runs several threads per page) and one per 2 GiB of RAM, at least 1. Timeouts stay fixed numbers; lower `MS_PW_WORKERS` if a loaded machine times out.

Fixtures in `tools/harness/fixtures` are self-contained WebGL2 pages served by a local Vite server on
`127.0.0.1:<port>`. The port is `MS_HARNESS_PORT`, else a stable per-checkout port in 4410..4909 derived from the harness
directory, so two worktrees can test at once; a server already on that port is never reused. A fixture publishes `window.__msFixture`; the spec waits for `ready`, reads the drawing buffer with
`gl.readPixels`, flips it, and encodes a PNG in Node. Every golden render asserts a SwiftShader renderer, so a local GPU
never produces or checks a golden. Every spec uses the shared `test` from `src/harnessTest.ts`, which fails any request off the fixture origin on any page,
and every `openFixture` asserts SwiftShader. `openFixture` waits 20 s for `__msFixture` (the module sets it as it
evaluates). On a timeout it prints the page's failed requests, responses >= 400, console errors and page errors under
`[fixture reload]`. If the page threw (a page error), it fails at once; otherwise it reloads once. A second boot timeout
fails with that list when the test has 40 s left for both waits (a fixture opened early under the 60 s default). A page once loaded without running its module (pt-gltf-contact in a full `pathtracer.spec.ts`
run); the cause is unknown, so the reload is a guard and the printed list is the trace to find it. Fixture image code uses no clock or random source (lint rule; timing lives in `fixtures/src/bench.ts` only).

The embed suite (`packages/embed/e2e`, `pnpm --filter @modelshot/embed run test:browser`, part of the root
`test:browser`) runs two servers on two origins: the production embed build (`serve:e2e`, `vite preview`) on
`MS_EMBED_PORT`, else a per-checkout port like the harness's, and `e2e/hostServer.mjs` on `MS_EMBED_HOST_PORT`, else
that port plus 1000, which serves the host page and the test models in place (`/cors/`, `/nocors/`, a 404, 65 MiB
bodies with and without `Content-Length`, a stalled body, a non-model) and lists what it was asked at `/__requests`.
The specs cover the element and a plain iframe, lazy loading, CORS and other download errors, limits with the host
page staying responsive, the requests made and the background colour per look; no goldens (pixel checks are coarse
differences after "Preview lit."). See [embed.md](embed.md#tests).

The deploy suite (`tools/deploy/e2e`, `pnpm --filter @modelshot/deploy run test:browser`, part of the root
`test:browser`) builds `@modelshot/deploy...` itself, then serves the assembled `tools/deploy/dist` on `MS_DEPLOY_PORT`, else a
per-checkout port, under `/ModelShot/` like GitHub Pages, and a host page on that port plus 2000. With `MS_DEPLOY_URL`
set it serves only the host page and tests the deployed site instead; `pages.yml` runs it that way after each deploy (`ci.yml` does not run it yet).
See [hosting.md](hosting.md#tests).

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
  example `pnpm golden:update golden.spec` (Playwright `--update-snapshots=all`; the pattern selects spec files, not
  golden names); every golden of the selected spec files is rewritten, a change inside the tolerance too. On the
  OS and SwiftShader build that rendered the committed goldens an unchanged render gives a byte-identical PNG, so git
  shows only real changes; on another platform an update may rewrite unchanged goldens with last-bit differences (CI on
  Linux passes the Windows-made goldens by tolerance), so commit only the goldens you meant to change. A pair
  comparison (`compareAgainst`) never writes the golden it compares against. The command is refused when `CI` is set. Review every changed image as an image before
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
`fixtures/src/rtScenes.ts`, so the path-tracer fixture can render the same scene and camera for a paired golden.
Every frame the fixture draws for a test is the finished one: it renders until `needsRender` is false (at most 8
calls), so a still exact-key frame shows all 4 of its rotated-grid samples (MS-35); the load bench (`timeScene`) and
the frame bench time single calls. `depth=inside` puts the near plane at far x 1e-4 for an orbit view too. The
fixture models in `fixtures/models/` are ours (CC0, `LICENSE` there); `rt-showcase.bbmodel` has an atlas whose 6 x 6
face rectangles sit in a ring of magenta sentinel texels, opaque, cut-out and 50 % texels, a zero-thickness sprite,
two overlapping partial-alpha planes in different meshes, rotated and mirrored face UVs and a 64 x 64 brick face.

- Goldens: `rt-turntable-y000`, `-y030`, `-y060`, `-y090` (perspective 35°, pitch 20°), `rt-iso` (orthographic
  isometric), `rt-closeup` (half the fit distance, atlas texels about 28 px), `rt-far` (three times the fit
  distance, brick texels about 0.45 px), `rt-fallback` (no-float path), `rt-fit-flat-cube` (frame-to-fit of a plate
  with zero height), `rt-gltf-nodes-y030` and `rt-obj-shapes-y030` (perspective 35°, pitch 20°, yaw 30°: the glTF
  and OBJ loader fixtures, below), `rt-partial-edge` (MS-60, the partial-edge quad at 4x MSAA: partial seams, a
  partial outline and opaque|partial seams anti-aliased). Default tolerance.
- Bleeding: no turntable frame has a pixel whose red and blue both exceed green by more than 24 levels (the magenta
  sentinel after lighting and AgX). Without the face-rectangle clamp the 0° frame has 441 such pixels. The same holds
  for `gltf-nodes` at yaw 0°, 30°, 60°, 90°, 180° and 270°; with every UV rectangle widened to the whole image its 0°
  frame has 179 such pixels (MS-13). Its fixture colours are chosen so that no geometric edge pixel mixing two of them
  leans magenta; since MS-30 the cut-out edge of its red `MASK` plane over the blue cube is anti-aliased and mixes
  them (4 pixels at 0°), so for `gltf-nodes` a pixel within 0.01 in linear light (`agxInverse` of the studio look) of
  a blend of up to three of its 8 neighbours that do not lean magenta does not count (`sentinelPixels` given a
  `linear` mapping). With the face-rectangle clamp removed from `texelSample.glsl` that measure still finds 179
  pixels at 0° (plain: 183), 152 at 30°, 234 at 90°, 251 at 180°, and 574 in the showcase's 0° frame (plain: 577).
  Turntable and player frames keep the plain measure.
- Loader fixtures (MS-13): scene `gltf-nodes` is `packages/formats/test/fixtures/gltf/scene-nodes.gltf` through
  `loadGltf` (a node hierarchy with TRS, quaternion, non-uniform scale, a matrix node and a mirrored node, a cube
  instanced twice on an atlas with magenta sentinel rings, a `MASK` cut-out plane, a 50 % `BLEND` plane, a
  double-sided plane, factor-only colours, a `KHR_texture_transform` panel on `TEXCOORD_1` and a triangle strip);
  scene `obj-shapes` is `fixtures/obj/shapes.obj` with its `.mtl` and PNG through `loadObj` (quads, a concave star
  from negative indices, faces without `vn` or `vt`, a `map_Kd` cut-out, `Kd` only, `d 0.5`). Both are static
  imports, CC0, `LICENSE` next to them. The path-tracer fixture has goldens of both (`pt-gltf-nodes-y030.s1.n128`,
  `pt-obj-shapes-y030.s1.n128`, MS-39); both are also preview-vs-render pairs.
- Shimmer: between yaw 30° and 30.25°, the share of pixels changing by more than 64 levels must be at most half of
  the same share with nearest sampling (`aa=0`), in the `far` and `closeup` framings.
- Order independence: reversing the mesh order gives a byte-identical image on the float path and on the fallback,
  for the showcase and for `gltf-nodes`.
- A cut-out texel over the backdrop shows exactly the backdrop colour.
- Anti-aliased cut-out seams (MS-30), scene `cutout-edge` (`fixtures/src/cutoutEdge.ts`: one double-sided 8 x 8 unit
  quad, `MASK`, a generated 8 x 8 texture with an opaque one-texel ring around a checker of opaque white and alpha-0
  texels; `look=edge`, yaw 20°, pitch 15°, about 24 px per texel), measured by `src/cutoutSeams.ts` against the same
  view at `aa=0` and over `scene=empty`: (a) no pixel more than 1 px from a hard-cutout boundary changes by more than
  2 levels; (b) at least half of the model/backdrop transitions inside the ring have a strict mix on one side (neither
  within 2 levels of backdrop nor texel; one pixel ramp, so at most one side of a pair can be a mix, and 4 samples
  give 5 levels); (c) the covered area, each pixel's position between backdrop and texel in linear light
  (`src/agxInverse.ts`, as the MSAA resolve averages before AgX), equals the hard shape's pixel count within 0.5 px
  per row with a boundary; (d) every inner texel centre shows the backdrop exactly (cut) or the texel within 1 level.
  With `msaa=0` (the renderer's `maxMsaaSamples`) the same seams have 0 mixes. The fallback (`aa=1` and `aa=0` give
  the same model/backdrop map, 0 mixes) stays hard. The exact key (`cutout-edge-inside`, `depth=inside`, MS-35) meets
  (a)-(d) on its converged frame against `aa=0&msaa=0`: 0 far changes, 1 238 of 1 742 transitions mixed, area 16 588.9
  against 16 609 (149 rows); at `msaa=0` it stays single-sampled, 0 mixes. Silhouettes (MS-35, `exact-key frames
anti-alias silhouettes like raster frames`): `turntable-y030` at `aa=0`, framed (raster, MSAA) and `depth=inside`
  (exact), against the same view at `msaa=0`: mixed share of the model/backdrop transitions at least 0.5 in both and
  the exact one at least 0.8 x the raster one (measured 0.664 and 0.857); `msaa=1` exact frames stay single-sampled (0
  mixes); the shown frames (texel AA on) differ by more than 8 levels in at most 968 pixels (measured 774 x 1.25, on
  silhouettes and texel seams).
  `rt.drawStatesPerFrame()` (`fixtures/src/drawStates.ts`) records program, `SAMPLE_ALPHA_TO_COVERAGE` and the draw
  framebuffer's `SAMPLES` at every draw: on only in opaque draws into a target with at least 2 samples (turntable,
  `cutout-edge`, a baked checker), off in every draw of `aa=0`, exact, fallback frames, and for backdrop, catcher, OIT
  and present (either present program).
- Anti-aliased partial-alpha seams in the OIT pass (MS-60), scene `partial-edge` (`fixtures/src/partialEdge.ts`: the
  `cutout-edge` quad and camera with `BLEND`, a generated texture of white texels: a ring of alpha-128 texels around
  a checker of alpha-128 and alpha-0 texels in rows 1-4 and of alpha-128 and opaque texels in rows 5-6, so
  partial|invisible seams, opaque|partial seams and a face outline of partial texels only; `partial-edge-under` has
  the opaque texels partial, what an opaque texel covers), against the same view at `aa=0&msaa=0` (nearest texels at
  pixel centres) with `cutoutSeams`: (a) 0 far changes (also away from the boundaries against `partial-edge-under`),
  (b) at least half of the transitions mixed, (c) the covered area within 0.5 px per boundary row, (d) texel centres within 1 level, alpha-0 centres exactly the
  backdrop. Regions: rows 0-4 with a texel past the outline (partial seams and outline: 1 238 of 1 473 transitions
  mixed, area 15 152.0 against 15 161, limit 61.5 over 123 rows), the left outline alone (82 of 113, 1 029.9 against
  1 033, limit 54 over 108 rows) and the opaque|partial strip between the centres of rows 5 and 6 over
  `partial-edge-under` (183 of 280 mixed, 26 of them on the opaque side, at least 13 required; area 1 442.5 against
  1 416, the accepted A2C residual of docs/realtime-renderer.md, limit 0.15 px per seam crossing, 42 over 280).
  With the opaque side's coverage of 1 from before MS-60 (checked by reverting `opaque.frag.glsl` locally) the strip
  has 0 opaque-side mixes and an excess of 39.5 px, so it fails on the mixes. `msaa=0`: the seams inside the ring
  still ramp (903 of 1 038 mixed, 10 156.3 against 10 170, 92 rows), the outline and the strip stay hard (0 mixes).
  Exact key: the converged `partial-edge-inside` equals its `aa=0` frame within 2 levels in rows 0-4 (no ramp of its
  own, the 4 passes' mean antialiases), and `partial-edge-inside&msaa=0` (drawn once) ramps (875 of 1 038, 10 154.4
  against 10 170). The fallback keeps the same model/backdrop map with and without texel AA, and `breakFramebuffers`
  with partial geometry switches to it without a page error. `scene=partial-edge-pair` (a second quad overlapping
  the first) is byte-identical with `reverse=1` at 4 samples, `msaa=0`, `depth=inside` and both.
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

World-density charts (MS-41): `rt-bake-gltf-contact` (new, catcher off: the ground is the scene's lowest surface) bakes
`packages/formats/test/fixtures/gltf/contact-shadow.gltf` (generated, CC0 by the directory's LICENSE: an 8 x 8 ground
of two triangles and a smooth 2 x 2 x 2 box of 8 shared vertices on it, base colours only), seen from the shadow side
(`look=contact`); its pair is `pt-gltf-contact.s1.n128`. `rt-bake-alpha-plane` was regenerated on purpose: its
untextured ground box is world-charted now and shows the plane's shadows the render has (it had none per vertex). The
chart census (`test/lightmapCensus.test.ts`, unit) lists the world-charted meshes of every baked view: the variants
that bake and the views the pair tests bake (`alpha-plane`'s ground, `gltf-contact`'s ground and box, and `edges`'
untextured wedge, plane and smooth sphere; none in the others), and pins the layout keys of the views without one to
their origin/main values, so no baked golden or pair changes by a chart mode unnoticed. The probe test projects two ground points of the contact scene: 4 units out from the box in
its cast shadow and 48 units further in the open. Measured (SwiftShader): baked contact 144.5 levels of luminance
against 207 unbaked (0.70; per vertex the ground had only its four corner texels, all far from the box, so 1.0), the
open point 206.8 against 207; the path-traced golden 152.9 against its open 206.9 (0.74). Limits: contact at most 0.8
of unbaked (0.1 above the measured shadow for the noise of 64-sample texels, well below the 1.0 without one), open
within 3 %, the render's contact at most 0.8 of its open point, preview and render contact within 10 % of each other.

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
- Exact depth key (`render-order`, always exact): baking with and without the catcher changes no model pixel at
  `msaa=0`; on the converged frame (MS-35) none with no backdrop pixel within 1 px (a silhouette pixel mixes the model
  with what lies behind it, the catcher included: 9 such pixels change).
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
- Sharp-edged meshes change only beside their edges: every pixel that rounding changes (1 886 float since MS-54 round 4, 1 895 before MS-54; 1 723 fallback, 1 729 before MS-54)
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

MS-60 (anti-aliased partial seams and partial outlines in the OIT pass) regenerated no golden: every existing one
passes its comparison, so none was rewritten; new are `rt-partial-edge` and `pt-partial-edge.s1.n128`. Against the
committed goldens (pixels with any channel changed, largest change in levels), all on partial texels (the showcase's
glass panes and 50 % texels, the glTF and OBJ fixtures' partial faces): `rt-turntable-y000` 470 (44), `-y030` 381
(79), `-y060` 251 (43), `-y090` 166 (34), `rt-iso` 343 (82), `rt-closeup` 1 065 (79), `rt-far` 100 (62),
`rt-gltf-nodes-y030` 210 (20), `rt-obj-shapes-y030` 138 (49), `rt-bake-turntable-y030` 286 (89). Unchanged (0
pixels): the fallback, player, preset, cut-out (`rt-bake-cutout-checker`), `rt-edges`, `rt-outline-hull`,
`rt-bake-alpha-plane`, `rt-bake-gltf-contact`, `rt-fit-flat-cube` and `rt-texture-wrap-inside` frames; `rt-texture-wrap`
(opaque textures only, no OIT draw) differs from its golden by 2 531 pixels (17) with origin/main's renderer too.
Against their limits (threshold 0.1: `maxDiffRatio` 0.001, `maxMeanDelta` 1), ratio and mean delta: `rt-turntable-y000`
0 / 0.012, `-y030` 0.00005 / 0.024, `-y060` 0.00003 / 0.015, `-y090` 0 / 0.008, `rt-iso` 0.00006 / 0.017,
`rt-closeup` 0.00015 / 0.035, `rt-far` 0 / 0.007, `rt-gltf-nodes-y030` 0 / 0.007, `rt-obj-shapes-y030` 0.00002 /
0.011, `rt-bake-turntable-y030` 0.00020 / 0.027, `rt-texture-wrap` 0 / 0.023; the largest use is a fifth of the ratio
(`rt-bake-turntable-y030`) and under 4 % of the mean, none more than half its tolerance, so none was regenerated.

Goldens regenerated on purpose in MS-30 (anti-aliased cut-out seams on the MSAA path; same views, bake seed and
samples), the ones that failed their comparison, each set by its own `build golden --update --filter`:
`rt-turntable-y060`, `rt-iso`, `rt-closeup`, `rt-gltf-nodes-y030`, `rt-obj-shapes-y030`, `rt-bake-cutout-checker`,
`rt-bake-alpha-plane`, `rt-bake-turntable-y030`. MS-30's own change, against the same build with alpha-to-coverage
gated off (byte-identical to origin/main's renderer), lies on cut-out seams only: 236 pixels (mean 0.070 levels),
266 (0.086), 454 (0.131), 345 (0.106), 716 (0.175), 826 (0.225), 897 (0.401) and 269 (0.086). Three of them also take
up the drift MS-15 left in tolerance (rounded edges; against their old golden 663, 711 and 1 389 pixels):
`rt-gltf-nodes-y030`, `rt-obj-shapes-y030`, `rt-bake-cutout-checker`. Within tolerance and so not rewritten: the
other turntable frames, `rt-far`, `rt-fit-flat-cube`, the player and preset frames and the rest; as required
`rt-fallback`, `rt-player-slim-fallback`, `rt-preset-marketplace-fallback`, `rt-bake-cutout-checker-fallback`,
`rt-player-legacy-opaque-hat-34`, `rt-edges`, `rt-bake-gltf-contact`, `rt-outline-hull`, every `pt-*` and every
model-view golden. The `cutout-edge` test measured 1 742 transitions inside the ring, 1 053 with a mix (60 %), area
16 590.4 against the hard shape's 16 609 pixels (limit 74.5, 149 rows); with the shader's band kept but A2C off
(the failure its gate prevents) the area is 17 419 and no transition mixes. Frame time on SwiftShader,
`rt-bench-512` median 389 ms against 361 ms with A2C gated off (`rt-bench-order-512`, exact frames, never A2C: 313
against 298, the run-to-run spread); budget 2 000.

Goldens regenerated on purpose in MS-54 (centroid normal, world position and edge distances, the edge footprint
mapped back to unit steps; same views, bake seed and samples): the raster-key MSAA frames, where the change lies on
silhouettes and on triangle edges inside faces (quad diagonals, the sphere's facets), judged as diff images. Pixels
against the same views rendered with origin/main's shaders (count, largest level): `rt-turntable-y000` 253 (7),
`-y030` 391 (6), `-y060` 390 (8), `-y090` 368 (7), `rt-iso` 411 (7), `rt-closeup` 557 (7), `rt-far` 185 (13),
`rt-edges` 681 (20), `rt-gltf-nodes-y030` 248 (12), `rt-obj-shapes-y030` 219 (10), `rt-outline-hull` 531 (11),
`rt-bake-turntable-y030` 350 (6), `rt-bake-alpha-plane` 131 (9, the ground's far silhouette; the cut-out squares
unchanged), `rt-bake-cutout-checker` 163 (3), `rt-bake-gltf-contact` 91 (1); with the baked vertex light centroid too, the
same two move again, 34 (max 3) and 254 pixels (max 4), along silhouettes and triangle edges only. `rt-far`, `rt-turntable-y000`, `-y030`
and `-y090` also take up drift main had left within tolerance (against their old golden 487, 449, 660 and 498 pixels,
up to 102 levels). Drift explained and regenerated too, so every rt golden equals the current output (the same view
rendered twice gives the same bytes; diff images judged): MS-15 left `rt-player-hold-34` (2 340 pixels, up to 47
levels, all along the rounded cube edges) and `rt-player-legacy-opaque-hat-34` (1 497, 43) in tolerance, MS-30 left
`rt-fit-flat-cube` (107, 37, its cut-out seams), and with them `rt-far` (rounded edges and seams) and
`rt-turntable-y000`, `-y030`, `-y090` (the flower's and the frame's cut-out seams). The exact-key player and preset
frames, single-sampled, moved in round 1 at most 4 pixels by 1 level (rounding in the changed program): rewritten with
the drift are `rt-player-classic-front` (1), `-classic-back` (1), `-walk-hold-34` (4), `-wave-front` (2),
`rt-preset-marketplace` (2) and `rt-preset-marketplace-fallback` (2). Unchanged: the other rt goldens, every `pt-*`
and model-view golden; `export-animation-f0.s1.n16` renders 2 pixels 1 level off its golden, twice alike (not an rt
golden, left; the export goldens below say where it came from). Round 3 (the shading point back at the pixel centre wherever the pixel lies on the face,
`prepareShading`) rewrote 29 rt goldens, pixels (max levels) against round 2: `rt-bake-alpha-plane` 1 614 (3),
`rt-bake-gltf-contact` 1 846 (4), `rt-bake-turntable-y030` 307 (2), `rt-bake-cutout-checker` 105 (1) and `-fallback`
100 (1), `rt-closeup` 553 (3), `rt-edges` 635 (20), `rt-fallback` 316 (1), `rt-far` 40 (1), `rt-gltf-nodes-y030` 141
(2), `rt-iso` 372 (1), `rt-obj-shapes-y030` 113 (2), `rt-outline-hull` 661 (3), `rt-turntable-y000` 553 (2), `-y030`
337 (2), `-y060` 370 (2), `-y090` 441 (1), the exact-key frames `rt-player-classic-back` 731 (2), `-classic-front` 241
(1), `-hold-34` 281 (1), `-legacy-34` 170 (1), `-legacy-opaque-hat-34` 133 (1), `-slim-34` 229 (1), `-slim-fallback`
225 (1), `-walk-hold-34` 308 (1), `-wave-front` 111 (1), `rt-preset-marketplace` 1 320 (9) and `-fallback` 1 313 (9),
`rt-preset-rim` 939 (16) (against origin/main: `rt-preset-rim` 939 (16), `rt-preset-marketplace` 1 320 (9),
`rt-player-classic-back` 732 (2)). Diff images judged: the rounded-edge bands along sharp edges, the sphere's triangle
edges and silhouettes; nothing else. Round 4 (the step back to the centre on any sample pattern, determinant bound 1/16
(1/32 since round 5, no golden moved) instead of 0.25) rewrote 6 rt goldens by a few pixels along triangle edges inside faces, pixels (max levels) against
round 3: `rt-edges` 13 (3, inside the sphere), `rt-far` 12 (3), `rt-turntable-y060` 4 (2), `-y000` 2 (1),
`rt-bake-cutout-checker` 2 (1), `rt-outline-hull` 1 (1); every exact-key, fallback and `pt-*` golden byte-unchanged.
A round-4 trial that kept the centroid at smooth silhouettes too (corners and neighbour normals per triangle) was
measured and reverted: the `edges` view's sphere outline band (704 pixels, either side of its `msaa=0` pixels) gave
14.1790 against `pt-edges` (14.1520 at the centre) and 1.2233 against a 4 x 4 supersampled `msaa=0` preview (1.1282),
26 pixels moved, 16 of them farther from the render; the RTX 3080 alike (14.1903 / 14.1548). The rule and the reason
are in docs/realtime-renderer.md; the `rt-edges` golden pins the centre on smooth silhouettes.
MS-35 (still exact-key frames converge to 4 rotated-grid samples) rewrote the goldens of exactly the exact-key float
frames, pixels more than 8 levels off their old golden (max levels): `rt-player-hold-34` 1 866 (145),
`rt-player-classic-front` 1 433 (93), `rt-preset-marketplace` 2 085 (225) and the other `rt-player-*` views but
`-slim-fallback`, all along silhouettes, the outer layer's edges, texel seams and the catcher's edge; `rt-preset-rim`
4 021 (206) also takes Rim's new rim (its screen-right sides keep their texels), and `pt-preset-rim.s1.n64` that rim
in the render. Every raster frame, `*-fallback` and other `pt-*` golden came out byte-identical; the rewritten ones
are the same bytes in a second run. Diff images judged.
After the MS-52 merge `rt-texture-wrap-inside` (`depth=inside`, an exact-key frame) was regenerated on the converged frame: 2 035
pixels more than 8 levels off the MS-52 golden (95), all on silhouettes, face edges and seams; its wrap probes (texel centres) pass unchanged, and
`rt-texture-wrap` and `pt-texture-wrap.s1.n64` are byte-identical.
Single-sampled frames move too: SwiftShader snaps vertices to 1/16 px, so even fully
covered pixels interpolate up to 0.04 px off `gl_FragCoord`, and the step to the centre takes that up (a 0.0625 px
threshold that left it measured 168 pixels at width 0.1 in the edge-band probe below, against round 3's 135). Pairs re-measured
after the MS-59 merge, round 4 (13, `pair` project; pixels differing, ratio, mean delta), all within their limits,
none changed: `turntable-y030` 141, 0.00215, 0.713, `iso` 265, 0.00404, 0.879, `alpha-plane` 232, 0.00354, 1.335,
`player-hold-34` 1 208, 0.01843, 1.290, `cutout-checker` 223, 0.00340, 0.611, `edges` 41, 0.00063, 0.373,
`preset-marketplace` 1 271, 0.01939, 1.237, `preset-rim` 1 401, 0.02138, 1.103, `preset-marketplace-yaw30` 1 389,
0.02119, 1.279, `outline-hull` 172, 0.00262, 0.423, `gltf-contact` 6 988, 0.10663, 5.628, `obj-shapes-y030` 245,
0.00374, 0.461, `gltf-nodes-y030` 316, 0.00482, 0.948.
Probes: **MSAA silhouette pixels are shaded on the face**:
the baked `turntable-y030` preview against its render (the `pt-turntable-y030` golden PNG), the mean largest-channel
difference over the 2 px outline band both draw (`outlineBand`), 1.6961 over 4 028 pixels against the render MS-59
regenerated (1.7219 when shaded at the pixel centre; before MS-59 1.7461 and 1.7726 over 3 919), at most measured x 1.25
= 2.12 and below the midpoint 1.709 (a revert of the centroid qualifiers measures 1.7219 and fails); frame on the raster
key with MSAA (asserted). **The edge band keeps its width across quad diagonals**: the `edges` view with MSAA against
`msaa=0`, off every mesh's outline (more than 1 px from a `maskBoundary` of the mesh's pixels from `hide=`): 0 pixels
over 2 levels at the look's width; at width 0.1 133 pixels differ at all (135 with the 0.25 determinant bound in round 3, 227
with the skewed footprint, 147 with the shading point at the centroid inside faces too, 142 when shaded at the pixel
centre), at most 140, the midpoint to 147 (below 133 x 1.25), so a shading point left at the centroid inside faces
fails.

Both probes, like every golden, are calibrated on SwiftShader (`assertSwiftShader`). Measured once on a real GPU (MS-54,
ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11), a throwaway Playwright config with
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` and the SwiftShader assertion bypassed locally, nothing
committed), pixels over 2 levels / pixels differing at width 0.1 / outline band mean (against the render before
MS-59), against SwiftShader:

| Shaders                                            | RTX 3080          | SwiftShader      |
| -------------------------------------------------- | ----------------- | ---------------- |
| before MS-54 (pixel centre)                        | 0 / 142 / 1.7569  | 0 / 142 / 1.7726 |
| centroid, footprint not mapped                     | 9 / 510 / -       | 0 / 227 / 1.7402 |
| centroid, footprint mapped (round 2)               | 10 / 431 / 1.7515 | 0 / 147 / 1.7443 |
| centroid, shading point at the centre inside faces | 2 / 173 / 1.7515  | 0 / 135 / 1.7461 |
| the same, determinant bound 1/16 (round 4)         | 1 / 152 / 1.6997  | 0 / 133 / 1.6961 |
| the same, determinant bound 1/32 (round 5, final)  | 1 / 151 / 1.6997  | 0 / 133 / 1.6961 |

A GPU's centroid is a covered sample position: inside a face, along a quad's diagonal, shading there moved the pixel
against `msaa=0` (8 of round 2's 10 pixels came from the centroid normal: 8 / 422 with only `v_normal` centroid).
`prepareShading` steps each centroid input back to the pixel centre unless the pixel reaches over a sharp edge. Round
3's residual (2 / 173) was read out per fragment on the GPU (debug colours for kept-by-slot, `mapped`, skew,
determinant, distance to the centre): 24 of the 34 pixels differing at width 0.1 that the pixel-centre shaders did not,
among them (199, 149) inside the sphere, had a fragment with `mapped` false, its determinant at 0.25: the GPU's 4x
offsets shorten a lane step to 0.25 px, so the bound 0.25 skipped the step back and left the centroid. With the bound at
1/16, 1 / 152; at 1/32, below the smallest non-zero pattern determinant 1/16, 1 / 151. The pixel left over 2
levels, (69, 129) at 3 levels, and the cube's and wedge's pixels at x 70-73 reach
over a sharp edge, where the centroid sample is kept by design (stepping back there too leaves the pixel but loses the
outline band on SwiftShader, 1.7696); 3 more differ by 1 level from rounding in the changed program. The outline band
in the last two rows is against the render MS-59 regenerated (1.6997 on the GPU); the revert checks hold on
SwiftShader only.

For a manual run on real hardware open `rt.html?scene=bench&size=512&fps=1`: it draws continuously and shows the
median frame work (draw until the GPU finished) and display interval over the last 120 frames, with the renderer
string.

**Outline hull** (MS-50, `test.describe('outline hull')`): `fixtures/models/outline-hull.bbmodel` (self-made, CC0), a
board inside a Blockbench cube with from > to on every axis (an inverted hull, `auto`-sided texture, so single-sided
and `cameraOnly`); variant `outline-hull` (yaw 30°, pitch 30°). Golden `rt-outline-hull`, default tolerance. Probes
(`src/outlineHullProbe.ts`) against `scene=outline-hull-board` (the shell keeps its vertices, so the same framing, but
draws nothing): the board-centre luminance (3 x 3) within 2 levels of the board alone (measured equal), and over 200
pixels the hull darkens to below 50 (the rim; measured 2 383, 2 385 before MS-54); the same unbaked and baked (`bake=16`, measured equal,
rim 2 284, 2 289 before MS-54).

**Texture wrap** (MS-52, `e2e/textureWrap.spec.ts`, project `golden`): `fixtures/src/textureWrapScene.ts` builds a
hytale_prop and a free .bbmodel in code (generated images, no asset file) with faces past their texture: three
24 x 8 boxes showing u -4 .. 20 of a 16 x 16 still texture (Hytale default, free default: clamp; stored
`wrap_mode: "repeat"`) and two boxes showing v -3 .. 11 of frame 0 of a two-frame strip (clamp, repeat), its frame 1
the sentinel; a sentinel image follows each still texture, so it lies beside it in the path tracer's texture layers.
Variants `texture-wrap` (fixed look `wrap`) and `texture-wrap-inside` (`depth=inside`, the exact depth key, whose mesh
pass carries the most varyings). Goldens `rt-texture-wrap`, `rt-texture-wrap-inside` (default tolerance) and
`pt-texture-wrap.s1.n64` (threshold 0). Probes (`textureWrapLayout.ts` points, 3 x 3 means): each probe past the
image or frame matches the texel inside it that its wrap mode reads (hue >= 0.995, luminance within 8 levels) and not
the one the other mode would read; 0 `sentinelPixels` in all three images. Its preview-vs-render pair (the pair rules
below, limit kept in the spec so `pathtracer.spec.ts` keeps its list): framing 0 mismatches (3 444), radiance 46 px,
0.00070, 0.671, limit 0.00088, 0.839 (measured x 1.25).

**Texture filter** (MS-38, `e2e/textureFilter.spec.ts`, project `golden`): `fixtures/src/textureFilterScene.ts` builds
a glTF in code (generated 8 x 8 PNGs, no asset file) and loads it through `loadGltf`, so the filters come from its
samplers: quads facing +z (`textureFilterLayout.ts`) showing a yellow/teal checker under a LINEAR sampler and the same
image under a NEAREST one (two scene textures sharing bytes), a LINEAR `MASK` texture with a cut-out 2 x 2 block whose
texels are black, a LINEAR texture shown at u -2 .. 10 with `wrap: 'repeat'` set on the loaded document (column 0
white, column 7 orange), and the checker LINEAR and repeated at 8 texels per unit (minified); a sentinel image follows
each linear texture, so it lies right of it in the path tracer's texture layers. Variants `texture-filter` (look
`filter`, about 7 pixels per texel) and `texture-filter-far` (look `filter-far`, three times as far: the minified quad
at about 3 texels per pixel, realtime only). Goldens `rt-texture-filter`, `rt-texture-filter-far` (default tolerance)
and `pt-texture-filter.s1.n64` (threshold 0). Probes read the one pixel at a `filterQuadPoint` (a 3 x 3 mean flattens
the blend's peak at a texel centre and reaches the one-pixel alpha seam), in the preview and the render: at a checker
texel centre the linear quad's neighbours weigh at most 0.25 in linear light (measured up to 0.091 preview, 0.147
render; taps shifted by half a texel would weigh 0.5); a quarter texel off the centre and on the seam the linear quad
lies a tenth or more of the way between the two texels in every channel where they differ by over 40 levels, the
nearest quad equals its texel (hue >= 0.995, luminance within 8); the cut block's centre equals the backdrop of its row
within 10 levels, and 0.3 texel off each side of the block the mask is no darker than 1.5 texels further away (within
3 levels; measured equal: the black of the cut texels adds no fringe); on the repeat quad u 8.5 reads column 0, u -0.5
column 7, u 8 lies between them (the blend crosses the wrap seam); 0 `sentinelPixels`. Far view: the minified quad's
inner 60 % stays within 5.3 levels of its mean in every channel (measured 4.2, x 1.25) and 0 sentinel pixels. Its
preview-vs-render pair (limit kept in the spec, as for texture wrap): framing 0 mismatches (2 600), radiance 7 px,
0.00011, 0.396, limit 0.00014, 0.495 (measured x 1.25).

Seam regression (same spec): the linear quad is 2 x 2 cells with alternating diagonals, so some triangles' last-vertex
face rects end at the cell border u = 4 or v = 4. 16 probes sit 0.1 texel either side of those borders (u 3.9 / 4.1
and v 3.9 / 4.1) on texel-centre rows and columns (1.5, 2.5, 5.5, 6.5). Each expected weight is read from the measured
tone-mapping curve of the same row or column (texel centres 1.5 to 2.5), not from the ideal bilinear weight; tolerance
0.035 (measured max 0.007 preview, 0.028 render, x 1.25). With `linearTexelRange` disabled 7 of the 16 probes fail in
both renderers.

## Path-tracer goldens

Fix the seed, the sample count, the resolution and the camera. The accumulation stops after exactly N samples, never
after a time. Random numbers come from a seeded integer hash, never `Math.random`.

`e2e/pathtracer.spec.ts` renders `fixtures/pt.html` (`@modelshot/pathtracer` on SwiftShader, 256 x 256, 4 bounces,
seed 1). The page takes the realtime fixture's scenes and views (`rtScenes.ts`: `variant`, `scene`, `look`, ...) so
every path-traced golden pairs with a preview of the same view, plus `seed`, `samples`, `batch` (samples per `step`),
`tile` (tile side), `size`, `maxTriangles`, `track=1`, `timing=1`, `geometryWorker=0` (setScene builds the geometry on
the main thread, MS-40) and the render quality of the request (MS-18):
`supersample=1..4`, `denoise=0|1`, `noise=<threshold>`, which the sample bench uses too, and `transparent=1` (`readRGBA`
gives `readImage()`'s straight alpha); `cameraonly=1` makes every mesh camera-only (MS-59); the path-tracer-only variant `emissive` sets an
emission on the showcase's brick material. A golden spec names its view in `variant` (`PathTracedGoldenSpec.variant`,
put in the URL, not in the file name); so are its quality fields (`supersample`, `denoise`), so the name of such a
golden says them (`-x2-denoised`).

| golden                                 | view                                                  | checks                                           |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `pt-turntable-y030.s1.n64`             | showcase, perspective 35°                             | golden; determinism; bleeding; pair; no workers  |
| `pt-iso.s1.n64`                        | showcase, orthographic isometric                      | golden; pair                                     |
| `pt-closeup.s1.n64`                    | showcase, half the fit distance (texels ~28 px)       | golden                                           |
| `pt-alpha-plane.s1.n128`               | alpha-plane.bbmodel, model-view camera                | golden; shadow probes; back side; pair           |
| `pt-alpha-ramp-blend.s1.n128`          | the 16 x 16 alpha ramp (blend, cutoff 0.01)           | golden; stochastic transparency                  |
| `pt-render-order.s1.n16`               | render-order.bbmodel, model-view camera               | golden; render-order probes                      |
| `pt-emissive.s1.n64`                   | showcase, bricks emitting (4, 2.2, 0.8)               | golden; the post beside the bricks brightens     |
| `pt-player-hold-34.s1.n64`             | MS-20 player, hold preset, cube in the hand           | golden; pair with `rt-player-hold-34`            |
| `pt-cutout-checker.s1.n128`            | generated cut-out checker and box, `checker`          | golden; checker shadow probes; pair              |
| `pt-edges.s1.n128`                     | generated `edges` scene (MS-15)                       | golden; rounded-edge probes; pair                |
| `pt-preset-marketplace.s1.n64`         | `player-hold-34` under Marketplace (MS-19)            | golden; tile/batch determinism; pair             |
| `pt-preset-rim.s1.n64`                 | `player-hold-34` under Rim (MS-19)                    | golden; pair                                     |
| `pt-outline-hull.s1.n64`               | outline-hull.bbmodel, board in an inverted hull       | golden; board and rim probes; pair (MS-50)       |
| `pt-closeup-reference.s1.n2048`        | `closeup`, 2048 samples, no denoiser (MS-18)          | rendered on golden update only; AC1, AC2, drift  |
| `pt-closeup-denoised.s1.n64`           | `closeup`, `denoise` (MS-18)                          | golden; AC1; AC2                                 |
| `pt-turntable-y030-x2-denoised.s1.n16` | `turntable-y030`, `supersample=2`, `denoise` (MS-18)  | golden; determinism; bleeding; pair              |
| `pt-gltf-contact.s1.n128`              | contact-shadow.gltf, `contact`, no catcher            | golden; contact probes; pair (MS-41)             |
| `pt-gltf-nodes-y030.s1.n128`           | scene-nodes.gltf, perspective 35°, pitch 20°, yaw 30° | golden; sentinel bleeding; catcher; pair (MS-39) |
| `pt-obj-shapes-y030.s1.n128`           | shapes.obj, same view                                 | golden; pair (MS-39)                             |
| `pt-partial-edge.s1.n128`              | generated partial-alpha checker quad, `edge` (MS-60)  | golden; pair; per-row seam area                  |
| `pt-texture-wrap.s1.n64`               | generated wrap boxes, `wrap` look (MS-52)             | golden; wrap and frame probes; sentinel; pair    |
| `pt-texture-filter.s1.n64`             | generated glTF filter quads, `filter` look (MS-38)    | golden; filter and fringe probes; sentinel; pair |

MS-40 (`geometry worker`): the accumulated float sums (`readAccumulation`, base64) of the `edges` view at 16 samples
and of the 200 000-triangle `large-order` document at 4 samples are the same bytes with the geometry worker and with
`geometryWorker=0`; with `Worker` made to throw (`addInitScript`) the tracer builds on the main thread
(`geometryInWorker` false) and `pt-turntable-y030` still matches its golden. No golden changed.

All eight earlier `pt-*` goldens were regenerated in MS-16 on purpose (same seeds, samples and size): the key became
a 0.04 rad cone, the shadow catcher appeared under every model, and the random dimensions per path vertex grew from
4 to 6. Their probes were measured again (below). Round 2 gave the catcher's fill ray its own number for partial
texels (it shared the camera ray's): `pt-turntable-y030`, `pt-iso`, `pt-closeup`, `pt-emissive` and
`pt-alpha-ramp-blend`, where catcher fill rays meet partial texels (the glass panes, the ramp), were regenerated
again, by at most 5 levels (mean 1) over their whole catcher; the others did not change.

MS-59 made the catcher estimate a control variate (path-tracer.md, shadow catcher): an unblocked catcher sample is
exactly 1, so the lit catcher has no noise and only blocked samples carry any. Regenerated on purpose (same seeds,
samples and size; changed pixels, max channel delta, mean delta per channel): `pt-turntable-y030` 7 172 px, 4, 0.052;
`pt-iso` 7 646, 3, 0.056; `pt-closeup` 1 332, 4, 0.013; `pt-alpha-ramp-blend` 975, 1, 0.006; `pt-render-order` 133, 2,
0.001; `pt-emissive` 7 147, 4, 0.052; `pt-player-hold-34` 8 490, 3, 0.071; `pt-cutout-checker` 10 900, 2, 0.072;
`pt-edges` 8 011, 3, 0.052; `pt-preset-marketplace` 3 377, 1, 0.020; `pt-preset-rim` 1 780, 1, 0.013;
`pt-outline-hull` 7 984, 1, 0.057; `pt-closeup-denoised` 653, 3, 0.005; `pt-turntable-y030-x2-denoised` 1 096, 2,
0.006; `pt-gltf-nodes-y030` 4 001, 2, 0.025; `pt-obj-shapes-y030` 2 269, 1, 0.015;
`pt-texture-wrap` 6 455, 3, 0.048 (MS-52, regenerated after the MS-59 merge); `pt-closeup-reference` (re-rendered
on the update) 408, 1, 0.002; the export goldens (alpha included) `export-still-transparent` 1 461, 11, 0.040 and the
turntable and animation frames 826-1 030, at most 9, at most 0.012. Every change lies on the catcher (and the glass
panes that show it); no model pixel and no shadow shape moved. `pt-alpha-plane` (its ground hides the catcher; 29
pixels by 1 level, within the tolerance) and `pt-gltf-contact` (no catcher) were not regenerated, nor any `rt-*`
golden: the preview's `catcherShade` arithmetic is unchanged. The pairs pass at their limits, which stay (before ->
after, ratio / mean delta): `turntable-y030` 0.00217 / 0.724 -> 0.00215 / 0.715, `iso` 0.00409 / 0.889 -> 0.00407 /
0.880, `alpha-plane` 0.00354 / 1.334 (same), `player-hold-34` 0.01843 / 1.293 -> 0.01843 / 1.290, `cutout-checker`
0.00340 / 0.623 -> 0.00340 / 0.611, `edges` 0.00061 / 0.390 -> 0.00061 / 0.377, `preset-marketplace` 1.237 -> 1.236,
`preset-rim` 1.109 -> 1.108, `preset-marketplace-yaw30` 1.281 -> 1.280, `outline-hull` 0.438 -> 0.425,
`obj-shapes-y030` 0.470 -> 0.463, `gltf-nodes-y030` 0.956 -> 0.948, `gltf-contact` and the denoised 2x turntable pair
(0.00177 / 0.620) unchanged; each ratio the same or lower. "An unblocked catcher shades exactly 1" renders
`turntable-y030` with `cameraonly=1` (every mesh camera-only: fill and key rays skip it, so no catcher ray is ever
blocked) at 1 sample, seeds 1 and 7: catcher on and off are byte-identical opaque and with `transparent=1` (RGBA), at
tolerance 0; the same view with the model casting differs in 3 169 and 3 112 pixels (not vacuous). Before the change
it failed with 16 734 pixels. The noise-threshold test pins no sample count (368 and 800 samples at 0.1 and 0.07 on
`closeup`).

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
  turntable pixel and no `gltf-nodes` pixel (seed 1, 128 samples) shows the magenta sentinel; the emissive bricks raise the post's south face by 14.6 levels (at
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
`goldenPathTracerEdges.spec.ts` (MS-72; the `golden` project picks it up by its `golden*.spec.ts` match): a new sharp
angle set with `setEdges` renders byte for byte as `reloadScene()` at that angle, and the initial bytes again at 30°;
a pose-only `setScene` overlapped by `setEdges` makes no layer texture upload and renders those bytes too.

**Pair tests** (preview vs render): `rt.html` baked (`bake=64`) and `pt.html` of the same view. Framing, with the
shadow catcher off on both sides (its edge fades into the backdrop) and the preview without MSAA (`msaa=0`, coverage
at the pixel centre; see below): the backdrop masks (within 2 levels of the view's
look's backdrop in that row, `agxToneMap(backdropColor(look, y), look.toneMapping)`, so a gradient counts as backdrop;
before MS-19 the top-left pixel) must agree on every pixel off the silhouette (a pixel whose 3 x 3 neighbourhood in the preview holds
both classes) that the two images draw more than 2 levels apart (a dark texel near the backdrop colour falls on either
side of the mask test, with the same colour in both views); 0 mismatches is the limit. Radiance, catcher on both: pixelmatch `threshold 0.1` with `maxDiffRatio`
and `maxMeanDelta` = measured x 1.25 and never above the previous limit, never widened; the render differs where it
has interreflection and noise. Logged as `[pt pair] <view>: ...`, values in `test-results/pt-pair-<view>.json`.
Measured on SwiftShader (local Windows dev machine, deterministic), MS-15 with rounded edges and the mirrored bounce
(MS-16's values in brackets; every limit stayed, none widened, `edges` is new at measured x 1.25):

| view                       | framing: mismatches (silhouette px) | radiance: pixels, ratio, mean delta                    | limit: `maxDiffRatio`, `maxMeanDelta`      |
| -------------------------- | ----------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `turntable-y030`           | 0 (1 627)                           | 123, 0.00188, 0.697 (MS-60; MS-54 142, 0.00217, 0.723) | 0.00235, 0.871 (MS-60; was 0.00271, 0.904) |
| `iso`                      | 0 (1 517)                           | 250, 0.00381, 0.869 (MS-60; MS-54 266, 0.00406, 0.888) | 0.00476, 1.086 (MS-60; was 0.00508, 1.111) |
| `alpha-plane`              | 0 (692)                             | 232, 0.00354, 1.335 (MS-54; MS-30 232, 0.00354, 1.334) | 0.00443, 1.669 (MS-54; was 0.00443, 1.67)  |
| `player-hold-34`           | 0 (1 322)                           | 683, 0.01042, 0.999 (MS-35; 1 208, 0.01843, 1.293)     | 0.01304, 1.25 (MS-35; was 0.0232, 1.62)    |
| `cutout-checker`           | 0 (3 295)                           | 223, 0.00340, 0.611 (MS-60; MS-30 223, 0.00340, 0.623) | 0.00426, 0.764 (MS-60; was 0.00426, 0.78)  |
| `edges`                    | 0 (1 971)                           | 41, 0.00063, 0.373 (MS-60; MS-54 41, 0.00063, 0.386)   | 0.00079, 0.466 (MS-60; was 0.00079, 0.483) |
| `preset-marketplace`       | 0 (1 322)                           | 598, 0.00912, 0.793 (MS-35; 1 269, 0.01936, 1.237)     | 0.01141, 0.992 (MS-35; was 0.0223, 1.43)   |
| `preset-rim`               | 0 (1 322)                           | 860, 0.01312, 0.704 (MS-35; 1 407, 0.02147, 1.109)     | 0.01641, 0.881 (MS-35; was 0.0241, 1.13)   |
| `preset-marketplace-yaw30` | 0 (1 304)                           | 723, 0.01103, 0.856 (MS-35; 1 387, 0.02116, 1.281)     | 0.0138, 1.071 (MS-35; was 0.0265, 1.52)    |
| `outline-hull`             | 0 (1 448)                           | 172, 0.00262, 0.423 (MS-60; MS-54 172, 0.00262, 0.437) | 0.00329, 0.529 (MS-60; was 0.00329, 0.547) |
| `gltf-contact`             | 0 (629)                             | 6 987, 0.10661, 5.627 (MS-41, new, no catcher)         | 0.133, 7.03                                |
| `obj-shapes-y030`          | 0 (1 852)                           | 241, 0.00368, 0.455 (MS-60; MS-54 246, 0.00375, 0.469) | 0.0046, 0.569 (MS-60; was 0.00468, 0.587)  |
| `gltf-nodes-y030`          | 0 (2 218)                           | 291, 0.00444, 0.943 (MS-60; MS-54 319, 0.00487, 0.955) | 0.00555, 1.179 (MS-60; was 0.00609, 1.194) |
| `texture-wrap`             | 0 (3 444)                           | 46, 0.00070, 0.671 (MS-52, new; textureWrap.spec.ts)   | 0.00088, 0.839                             |
| `partial-edge`             | 0 (3 844)                           | 2, 0.00003, 1.124 (MS-60, new)                         | 0.00004, 1.405                             |
| `texture-filter`           | 0 (2 600)                           | 6, 0.00009, 0.390 (MS-60; MS-38 7, 0.00011, 0.396)     | 0.00011, 0.488 (MS-60; was 0.00014, 0.495) |

MS-60 (anti-aliased partial seams, opaque|partial seams and partial outlines in the preview's raster frames)
re-measured every pair: `turntable-y030`, `iso`, `cutout-checker`, `edges`, `outline-hull`, `obj-shapes-y030` and
`gltf-nodes-y030` came closer to the render (rows above; `iso`'s framing preview at `msaa=0` now ramps its partial
seams, 1 517 silhouette pixels against 1 533), so their limits are tightened to measured x 1.25; `alpha-plane`, the
player and preset views, `gltf-contact` and `texture-wrap` measured as before; after MS-38's merge `texture-filter`
(textureFilter.spec.ts) came closer too, 6 px against 7, its limit tightened the same way. `partial-edge` adds a per-row check
(`src/rowCoverage.ts`, project `golden-pt`): in rows inside texel rows 1-4 (partial|invisible seams and the outline)
and 5-6 (opaque|partial seams), the covered area of preview and render, each against its own texel colours. The
criterion is the mean per-row difference within 0.5 px, where the render's noise averages out: measured 0.232 px
(signed 0.142) over 152 rows. Secondary, the worst row within 0.5 px plus the render's noise, 1.06 px (seed 1
against seed 2 at most 0.851 px a row, x 1.25): measured 1.127 px (row 1; rows 2-4 0.761, 0.678, 0.739; the strip
0.612 and 0.492).

MS-30 (anti-aliased cut-out seams in the preview's MSAA frames, as the render anti-aliases them by sampling)
re-measured every pair: `turntable-y030`, `iso`, `alpha-plane` and `cutout-checker` came closer to the render (rows
above), so their limits are tightened to measured x 1.25; every other view measured as before, its limit stays.

MS-54 (the preview's MSAA edge pixels shaded at a covered sample: centroid normal, position and edge distances,
docs/realtime-renderer.md) re-measured every pair. `turntable-y030`, `iso`, `alpha-plane`, `edges`, `outline-hull`,
`obj-shapes-y030` and `gltf-nodes-y030` moved by a pixel or two and up to 0.004 levels (rows above), so their limits
are min(previous, measured x 1.25); `player-hold-34`, the three `preset-*` views (exact depth key: each pass
single-sampled, the centroid is the centre), `cutout-checker` and `gltf-contact` measured exactly as before and keep
theirs. The denoised 2x turntable pair: 113 px, 0.00172, 0.618 under the turntable's limits.

MS-35 (a still exact-key frame converges to the mean of 4 rotated-grid passes, docs/realtime-renderer.md; every
fixture frame is converged) re-measured the four exact-key views, `player-hold-34` and the three `preset-*` (the
player's outer layer has a render order): all came much closer to the render, which also samples the silhouette
within the pixel (rows above), so their limits are min(previous, measured x 1.25). `preset-rim` is measured with Rim's
new rim (look-presets.md). Framing stays at `msaa=0`, single-sampled at the pixel centre: 0 mismatches. Every other
view draws raster frames, unchanged bytes, and keeps its numbers. A 2 x 2 supersampled preview (an earlier round of
MS-35) measured 0.01018 / 0.829, 0.01582 / 0.810, 0.01357 / 0.928 and 0.01125 / 1.049.

Framing takes the preview at `msaa=0` since MS-39: with MS-30's 4-sample alpha-to-coverage, `obj-shapes-y030` had 1
mismatch at (191, 135), on the wedge's cut-out slope seen at a grazing angle, where an opaque texel row covers about 2 %
of the pixel (the 512-sample render 117, 119, 124 against the backdrop 115, 118, 124). One of the preview's 4 samples
landed on it (147, 140, 130, about a quarter covered); the render, and the preview at `msaa=0` or `aa=0`, show the
backdrop. A sample count cannot draw 2 % coverage, so that is a radiance difference, which the radiance tolerance
measures against the MSAA preview; framing compares geometric coverage at the pixel centre. Every view has 0
mismatches so; the silhouette counts in the table are the `msaa=0` ones (the denoised 2x turntable pair as well: 0
mismatches). Radiance did not change.

MS-41 (world-density charts) measured the views it changes: `alpha-plane` 682 px, 0.01041, 1.567 (its ground is
world-charted and shows the render's shadows; before 2 083, 0.03178, 2.187), so its limit is tightened to measured x
1.25, 0.013 and 1.96; `edges` 40, 0.00061, 0.390 (its untextured meshes are world-charted; the limit stays). New
`gltf-contact` (catcher off on both sides, `PAIR_WITHOUT_CATCHER`, as its render has none): 6 987 px, 0.10661, 5.627,
limit 0.133, 7.03. Its ground agrees; the box's sides do not: the render lights them with the bounce of the bright
ground and the bake has no interreflection (box top, lit alike: 207, 176, 162 in both; west side low 85 baked, 132
unbaked, 150 rendered). Same albedo in both, so no material difference.

MS-39: `obj-shapes-y030` and `gltf-nodes-y030` (128 samples, catcher on) are new at measured x 1.25. The first
measurement of `gltf-nodes-y030` was 2 931 px, 0.04472, 2.305, the ground 157 rendered against 188 baked: its ground
lies in the catcher's plane, and the path tracer let the catcher win against a model hit by comparing distances, per
sample, on float rounding. A camera ray with a model hit now never sees the catcher (path-tracer.md, Lighting), as the
preview draws it first; the test 'a model surface at the catcher height hides the catcher' compares ground patches
with the catcher on and off byte for byte. That moved three goldens on purpose, each with a model surface in the
catcher's plane: `pt-gltf-nodes-y030` and `pt-obj-shapes-y030` (the ground and the floor, new in this task) and
`pt-outline-hull` (the shell's bottom edge, 1 403 px of 65 536, mean delta 0.493); the other pt goldens did not
change. `outline-hull`'s pair fell to 0.00266, 0.438, so its limit is tightened to measured x 1.25. `obj-shapes-y030`
was 0.00739, 1.289 with the old rule.

MS-19 measured the table again with the backdrop mask by rows: every earlier view kept its numbers and limits. The two
look-preset pairs (`preset-marketplace`, `preset-rim`: the held-cube player baked under its look) are new at measured
x 1.25, measured again after the preset numbers were tuned against the references and the path tracer's
accents moved to the camera hit (round 2), Marketplace once more after its rim moved behind the key side and grew
(round 3: a different look, so a new baseline above round 2's 0.0222, 1.32), and all of them again with the
view-relative rim (round 4) and its narrow tuning (round 5), where a limit stayed wherever the measurement x 1.25
would have raised it. `preset-marketplace-yaw30` (the same player and look from the app's default yaw 30, where the
rim follows the camera) came in round 4 at measured x 1.25 (0.0266, 1.52) and its ratio fell to 0.0265 in round 5. A
narrow rim raises a pair's numbers (the preview filters the fillet normal per pixel, the render averages jittered
rays): Rim at exponent 10 measured 0.02567, 1.263, over its limits, so it ships at exponent 5. Round 6 searched for a Rim rim that spares its screen-right side faces within the limits (look-presets.md, presets):
from behind ((0.45, 0.12, −0.88), (0.5, 0.12, −0.86)) the side faces stay within 3 levels, but colour 6 at exponent
5, which keeps a white line (414-430 near-white outline pixels at 512 px), measures ratio 0.0267; colour 3 at exponent
2 has already lost the line (0 in the render) and still measures 0.0255; the configurations under 0.0241 (colour
1.2-3, exponent 1-3, albedo share 0.3-1) draw no near-white outline pixel in the rows whose outline was counted (the share-1 row, (0.45, 0.12, −0.88), colour 3, exponent 2, pair 0.02408, passes but its outline was not counted). The shipped rim keeps the line (587-641)
and greys the side faces (measured, held by the face probe below). MS-35 made the search moot: with the player's
exact-key frames antialiased, the rim from behind fits. Its candidates (512 px; side face worst levels at yaw 210 / 30,
outline white preview / render at 210 and 30, `preset-rim` pair), measured on a 2 x 2 supersampled preview and the
shipped one re-measured converged: MS-19's (0.9, 0.12, −0.42) colour 4: 75 / 56, 436 / 379, 493 / 451, 0.01134 / 0.691
(greys the side faces); (0.45, 0.12, −0.88) colour 4: 0 / 0, 95 / 54 (43 % apart), 99 / 87, 0.01486 / 0.758 (line
too faint); colour 8: 0 / 0, 418 / 371, 437 / 403, 0.01582 / 0.810, shipped; converged 0 / 0, 371 / 371, 395 / 403,
0.01312 / 0.704.

alpha-plane's large ground is an untextured box, baked per vertex, so its preview shows no ground shadow (world-density
charts for untextured meshes are not in MS-16); the catcher under it darkens its mean delta a little.

### Look presets

MS-19 ([look-presets.md](look-presets.md)). Both fixtures take `preset=<id>` (a `LOOK_PRESETS` id, default `studio`;
the realtime fixture bakes under it) and `rim=0` (the preset's rim light black); the variants `preset-marketplace`,
`preset-rim` and `preset-marketplace-fallback` are the `player-hold-34` view under a look, baked with 64 samples in
the preview, `preset-marketplace-yaw30` the same from yaw 30 (a pair only). Studio is the v0 look, so every golden from before holds unregenerated. New goldens: `rt-preset-marketplace`,
`rt-preset-rim`, `rt-preset-marketplace-fallback` (baked, default tolerance), `pt-preset-marketplace.s1.n64`,
`pt-preset-rim.s1.n64` (path-tracer tolerance); pairs above. Tests (`look presets` describes of `realtime.spec.ts`
and `pathtracer.spec.ts`, `golden` and `golden-pt` projects):

- the Marketplace backdrop of an empty scene, every row at three columns, within 2 levels of its TS mirror on the
  float path, the fallback and the path tracer in 64-pixel tiles at 1 and 4 samples (measured worst 0.5 levels);
- `setLook` draws the bytes of a renderer created with the look, an invalid look (`bad`: catcher strength 1.5) names
  `catcher.strength` and changes no byte, Studio again gives the first bytes (preview and render);
- a look set while the render's `setScene` decodes gives the bytes of a render under that look from the start;
- Marketplace renders the same bytes in batches of 7 and 64-pixel tiles;
- the rim light, unshadowed: of the pixels it brightens by more than 12 levels in the preview (Rim against `rim=0`,
  unbaked, pixel centres: `msaa=0`, as for framing) the render brightens 99.5 % too (418 preview, 754 render pixels:
  the jittered camera rays catch more of the grazing fillets). The converged preview would also count silhouette
  slivers lit in 1 of its 4 samples, which 16 render samples need not hit (94.4 %; 95.9 % at 256 samples);
- the preset rims' line and the faces' texels (`pathtracer.spec.ts`, `RIM_PROBES[preset][yaw]`): the held-cube player at 512 px, pitch 20,
  yaw 210 and 30, baked preview and render (16 samples). `silhouettePixels` of `imageMetrics.ts` splits the model
  (more than 4 levels off the row's backdrop in column 1) into the outline band (a backdrop pixel within 2 px) and
  the interior; `whiteCount` counts pixels with every channel above a level. Outline near-white (above 200): at least
  the measured count / 1.25 in both (575 preview / 548 render at 210, 412 / 448 at 30; floors 438 and 330), preview
  and render within 25 % of each other. Interior near-white: at most the measured count x 1.25 (309 / 394 at 210,
  101 / 113 at 30; caps 493 and 141; the round-4 rim washed upward faces: 4 097). Interior blown out (250 or more): at
  most the measured share x 1.25 (none) and under 2 %. The saturated test skin is the case a diffuse rim (round 3)
  never drew white on. MS-35 measured Marketplace again on the converged preview (574 / 548, 453 / 448; interior 375 /
  394, 105 / 113; limits kept) and added Rim's rows: outline 371 / 371 at 210 and 395 / 403 at 30 (floors 296 and
  316), interior 194 / 187 and 134 / 137 (caps 243 and 172), blown out none;
- the turntable (`realtime.spec.ts`): Marketplace on the same player unbaked (the bake only darkens), 512 px, pitch
  20, yaws 0 to 330 in steps of 30: interior blown-out share at most 0.00122 (MS-35, converged: worst 0.00097, yaw
  60, the inner side of a thick band at a 45° silhouette; before 0.00164, cap 0.00205), at least 71 outline white
  pixels (the fewest measured: 89 single-sampled, 85 converged, at yaw 0, the player's back; the render 92; a 2 x 2
  supersampled preview had 61 and was dropped for it, a 4 x 4 one 84);
- the head's top and screen-right side keep their texels (`realtime.spec.ts`, Marketplace and Rim): the 3 x 3 pixels
  around the projection of (0, 32, 0) and of the right side's centre (x = −4 from yaw 210, x = 4 from yaw 30, y 28),
  unbaked, 512 px, pitch 20, with the preset's rim and with it black, at most 3 levels apart per channel (measured 0:
  (244, 54, 54) Marketplace head top at 210; the round-4 rim made it (232, 208, 214)), Rim's right side included since
  MS-35 moved its rim behind ((32, 8, 9) at 210 and (97, 13, 14) at 30 with and without it; MS-19's rim greyed them to
  (95, 83, 83) and (117, 69, 69) and was held at 94 levels);
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

### Render quality

MS-18 ([path-tracer.md](path-tracer.md#render-quality)), the describe `render quality` of `pathtracer.spec.ts`. Every
limit is a measured value with a margin, measured on the local Windows dev machine (SwiftShader, deterministic), never
widened.

- **Reference**: `pt-closeup-reference.s1.n2048`, the closeup at 256 x 256, seed 1, 2048 samples, no denoiser. Its test
  renders it only under `--update-snapshots` (`pnpm golden:update pathtracer.spec`, or the run tool's filtered golden
  update): 129 s locally, so its own timeout is 20 min (CI runners are 3-5x slower); every other run only reads the PNG.
  **Drift guard**: the 16 x 16 block means of a 64-sample closeup rendered in the run stay within 1 level of the
  reference's (measured 0.77, x 1.25), so a tracer change that moves the light (MS-50's hull rays, a look change)
  fails here and asks for the reference to be rendered again, instead of failing AC1 for the wrong reason.
- **AC1**, error against the reference in 8-bit levels (`imageError`, RGB): the plain 64-sample closeup measures RMSE
  1.880 (MAE 0.870), the denoised one 1.110 (MAE 0.399). Limits: RMSE at most 1.39 (1.110 x 1.25) and at most 0.65 of
  the plain one's (measured 0.590 x 1.1; the MSE ratio is 0.35). The plan's "at most half the plain RMSE" is not
  reached: what remains is concentrated in pixels across a silhouette (57 % of the squared error is within the edge
  mask), where two surfaces lit apart share a pixel in a proportion no neighbour has. Tuning, RMSE of the denoised
  closeup in the order tried: guides from 8 rays of the first samples 2.172 (worse than no denoiser), from the 64 rays
  of the first 64 samples 1.750, from 64 stratified rays 1.537; with 1024 rays at partial texels and the depth weight
  1.160 (256 rays instead: 1.291); albedo sigma 0.5 instead of 0.1 1.164; luminance sigma 2 instead of 4 with
  silhouette pixels left unfiltered 1.149, the same filtering them too 1.110 (shipped); from there luminance sigma 1.5
  1.113, no luminance floor 1.115, no depth weight 1.190; normal power 32 instead of 128 changed nothing (1.151 vs
  1.149).
- **AC2**, pixel art stays sharp: `edgeSharpness` of the denoised closeup on `edgeMask(reference, 24)` (8 772 pixels on
  either side of a luma step of 24 levels or more) at least 0.9, measured 1.0028 (the projection of the luma steps onto
  the reference's: 1 for the reference, under 1 blurred); the RMSE more than 2 pixels from any such edge within the AC1
  limit, measured 0.669 on 43 836 pixels; no magenta sentinel texel in the denoised closeup or the denoised 2x turntable
  (the face-rectangle probe).
- **2x**: the 2x turntable at 16 samples against the 1x at 64, catcher off, `silhouetteMismatches` 0 (off 1 605
  silhouette pixels); `accumulationSize` 512 x 512 and `progress.supersample` 2; the Marketplace backdrop at 2x in
  64-pixel tiles within 0.5 levels of its TS mirror (limit 2, as at 1x).
- **Determinism**: the denoised 2x turntable (16 samples) gives the bytes of a one-pass reference rendered in the same
  run in batches of 7, 3 and 1, in 64-pixel tiles, and after a context loss and restore, also one in the middle of the
  guide (MS-56; the whole guide, 256 tiles, is drawn again). The guide is spread over steps: guide draws per `step(1)`
  and `step(4)`, tile 256 and 64, stay within the budget bound and add up to every guide tile, no sample is drawn
  before the last, a guide-only step returns 0 with `guiding` true and traces and presents nothing and leaves the
  default framebuffer bound.
- **Guiding** (MS-56): `guiding` is false and `step(1)` draws 0 after a context lost mid-guide (straight after
  `loseContext()` and after the event), after `cancel()`, after `dispose()` and after a restore whose GPU rebuild
  failed.
- **Convergence** (64 x 64 closeup, maximum 1024 samples): `noise=0.1` stops at 368 with a noise of 0.0968, `noise=0.07`
  at 800 with 0.0686, each converged, not running, remaining 0, at a multiple of 16; denoised without a threshold
  draws all 1024. The plan's thresholds 0.05 and 0.0125 were for a 256-pixel closeup, which does not reach 0.05 within
  1024 samples at 64 pixels (0.0608) and would take minutes at 256.
- **Progress**: before the first sample `remainingMs` null and `noise` null; after 8 of 32 samples at 2x a noise, an
  elapsed and a remaining time above 0; done, remaining 0. The scale stays within 2^22 traced pixels: 1024 x 1024 at 2x
  traces 2048 x 2048, 1448 x 1448 at 2x falls back to 1x.
- **Fields**: `supersample` 0, 5, 2.5, NaN, "2"; `denoise` 1, "yes", null; `noiseThreshold` 0, −1, 1.5, NaN, Infinity
  each throw a `RangeError` naming the field.
- **Pair**: the denoised 2x turntable (16 samples) against `rt-turntable-y030` baked, under the turntable's pair
  limits (0.00271, 0.904 since MS-54): framing 0 mismatches, 113 pixels differ, ratio 0.00172, mean delta 0.618 (MS-54;
  the plain 64-sample render measures 0.00217, 0.723; at MS-18 168 px, 0.00256, 0.670 under 0.00353, 0.953).
- **Lifetime**: `dispose()` after a denoised 2x request with a threshold leaves no WebGL object (`track=1`).
- **Defaults**: `supersample=1&denoise=0` (the fields given explicitly) renders the bytes of the turntable request
  without them.
- **Emitter over black**: `variant=emissive-dark` (the bricks glowing at 4x the `emissive` variant over a copy of
  their texture whose texels are sRGB 2, so the albedo floor 0.01 makes one sample's luminance variance about 1e6,
  over half precision) at 1 sample, denoised against plain: of the 7 019 pixels above 150 levels in the plain render
  none falls under 30 denoised, and no pixel over 30 turns black (under 2). SwiftShader did not show the NaN with the
  half-float filter images either (its conversion does not yield Inf here), so this browser test pins the outcome.
  The cause is pinned by two unit tests: `pathTracerShaders.test.ts` checks that the zero-weight skip in
  `denoise.frag` comes after the weight line and before the tap is added to the sums, and `resolveTargets.test.ts`
  (a recording stub of WebGL2) checks that the filter images are allocated as RGBA32F and the guides as RGBA16F.
- **Lost context**: a threshold request (0.01) whose context is lost inside the first noise readback (the fixture's
  `loseDuringNoise`) stops after 2 samples with `converged` false and `noise` null; without the guard it reported
  converged. `readAccumulation` gives null from the moment the context is lost, before its event, as after it
  (browser test, the fixture's `lose`); without the check it returned zeros.
- **Programs**: with `track=1`, a plain request leaves 2 live programs (trace, present); a threshold request adds
  `noise` (3), a denoised 2x one `guide`, `denoise`, `resolve` (6); after a loss and restore only trace and present
  are linked again, a plain render adds none, a threshold request `noise` again. The scale survives a loss:
  `progress.supersample` 2 and `accumulationSize` 128 x 128 while the context is lost. `tracerPrograms.test.ts` (stub
  WebGL2): a program that fails to compile is compiled once, a second `require` throws the same error without
  compiling again, other programs still link, and a rebuilt context starts over.

Times on the local machine: the denoised 64-sample closeup page about 8-9 s against 5 s plain (most of the difference
is the guide's 1024 rays at partial texels); the determinism test about 47 s.

## Export goldens

MS-22 ([export.md](export.md)): `e2e/export.spec.ts` in the `golden` project, on `fixtures/export.html`
(`fixtures/src/exportFixture.ts`, decoders in `fixtures/src/exportDecode.ts`). Every render is 64 x 64, seed 1, 16
samples, through `exportStill` / `exportClip` with a real `PathTracer`; the fixture keeps each `readImage()` the export
took, so a decoded file is compared with the very frames that were encoded.

- Goldens: `export-still-transparent.s1.n16.png` (the alpha-plane scene without its ground and back plane under the
  model-view camera, transparent, shadow catcher on, as PNG) and `export-turntable-f0..f3.s1.n16.png` (the frames of a
  transparent 4-frame turntable of the showcase from the `turntable-y030` camera, as APNG) and
  `export-animation-f0..f3.s1.n16.png` (the showcase bobbing 3 units up and down over 1 s, 4 frames at 4 fps, as
  APNG: the model rises, its floor and shadow stay), read by `expectGolden` with threshold 0 like the path-tracer
  goldens; the fixture hands the decoded file's pixels to `readRGBA`. Nothing compares
  bytes against a committed PNG. Drift (MS-67): MS-22 wrote `export-animation-f0` before MS-39 let a model hit beat the
  shadow catcher (`7c67fd6`); that merge moved the frame's pixels (26, 43) and (26, 44) by 1 level, inside tolerance, so
  the golden stayed until MS-59 regenerated the export goldens with its catcher change (`98a3451`). The main before
  MS-39 renders the MS-22 golden byte for byte, the main after it the 2 pixels off, and `golden:update` on `48c4e08`
  rewrites all export goldens with identical bytes: f1..f3 did not move under MS-39, nothing is nondeterministic.
- Still: the PNG decodes (the formats package's `decodePngRgba`) to exactly the bytes of `readImage()`; alpha is 255 at
  the opaque texel probe, 0 at the cut-out texel probe and at the corners where camera rays escape (catcher off); with
  the catcher on, its shadow under the opaque texel is black with alpha 1 − shade (191 measured; 188 before MS-59).
  Haze (MS-59): the transparent still with the catcher on has at most 34 pixels of alpha 1..3 (27 measured, x 1.25;
  490 before the control variate). Alpha 1..15, MS-22's haze count, went 1 164 -> 722; its alpha 4..15 part, 674
  before and 695 after, is unbiased speckle of real occlusion (one blocked fill sample of 16), falling as 1/√n, so it
  is not bounded.
- Per format, the decoded frames against the rendered ones: APNG through `decodePngRgba` of each frame rebuilt as a
  PNG, exact; GIF (ImageDecoder) within the palette bound of export.md (18; 10 measured), alpha 255 exactly where the
  render's is at least 128 and 0 elsewhere; WebP (ImageDecoder) within 2 (1 measured where alpha is partial); WebM and
  MP4 by a demux of our own containers in the page and `VideoDecoder`, mean error per channel within 5 (VP9 4.0 and
  H.264 2.4 measured, max 80 at edges), each with `ALPHA_DROPPED`. The Chromium of the harness encodes H.264; where a
  browser cannot, the mp4 test accepts the fallback with its warning and the log line names the format used. A run
  logs each format's size, decoder and time (`[export] ...`; about 0.6-2.4 s for 4 frames locally).
- Fallback: with the probe stubbed in the page to refuse `webm` (VideoEncoder.isConfigSupported) or `webp`
  (convertToBlob), the clip comes back as APNG with one `FORMAT_FALLBACK` warning naming both, and decodes exactly.
- Independent readers: WebM and MP4 played by a `<video>` element (MP4 where `canPlayType` accepts its codec): 64 x 64,
  duration 0.5 s (4 frames at 8 fps), the frame seeked to at 2.5 / 8 s within the video mean bound of frame 2 (2.4 and
  1.8 measured). The frame is drawn in the element's `requestVideoFrameCallback` once the presented media time is frame
  2, not on `seeked` (Chromium can fire it before the new frame is presented, so a busy machine drew the frame from
  before the seek), and the read fails after 20 s naming the last media time instead of hanging; the APNG through the
  browser's ImageDecoder: 4 frames of 125 000 µs, opaque pixels exact.
- Animation: one `setScene` per pose, every one with the same `catcherBounds` (the union of the poses: floor y 0, top
  23 with the bob); decoded frames exactly `readImage()`.
- Transparent quality paths: stills plain, with `supersample: 2` and with `denoise`, catcher off and on: PNG = readImage,
  alpha 255 / 0 / 0 at the opaque texel, the cut-out texel and the corner, no warning; the canvas of the transparent
  request against the opaque canvas (`preserveDrawingBuffer`), every pixel: within 1 plain and supersampled (0
  measured: the canvas composites in linear light, which pins coverage = 1 − shade per sample), within 43 denoised (14
  without, 34 with the catcher measured; 35 and 44 before MS-59). The readback composite of the supersampled and denoised stills against the
  opaque ones: solid pixels within 18 without the catcher (0 and 14 measured), every pixel within 79 with it (36 and 63
  measured).
- Context loss: after a finished render `readImage()` is an image; right after `WEBGL_lose_context.loseContext()`, before
  the event, and after it, `null`; after a restore, an export whose context goes at sample 2 of frame 1 rejects with
  `CONTEXT_LOST`.
- Determinism: frame 0 of two runs is the same bytes; frames 0 and 1 differ.
- Cancel: aborting at sample 3 of frame 1 rejects with `CANCELLED`, the tracer has 3 samples and is not running, and a
  further `step` draws nothing.
- Preview vs render: the transparent still composited over the look's backdrop (TS mirror, `backdropColor` and
  `agxToneMap`) against the opaque still of the same seed. Catcher off: pixels of alpha 0 or 255 match within 2 (0
  measured); silhouette pixels are left out, as tone mapping before the mix (the readback) and after it (the canvas)
  give partial pixels different levels (26 measured). Catcher on: every pixel within 45, 36 measured (the silhouettes
  and the partly transparent shadow) times 1.25.

Vitest covers the rest without a GPU (`packages/export/test`): every option out of type or range, the limits, frame
planning, the render loop against a fake renderer (progress, cancel, context loss), PNG and APNG against an independent
decoder (bitwise CRC, the platform's inflate, all filters), GIF against a textbook LZW decoder, the WebP, WebM and MP4
structure parsed back, codec levels by size and rate (720p60, 1080p60), the fallback chains, the video path with a
stubbed WebCodecs encoder, one catcher for every pose of an animation and the `SUPERSAMPLE_LOWERED` warning against a
fake renderer, the path tracer's `catcherBounds` (`catcherBounds.test.ts`), a scan of the sources for network calls,
`gif.test.ts`'s cost bound: the palette and LZW of a 4096 x 4096 frame of 2^24 distinct colours within 3 000 ms of
thread CPU time (`expectCpuBelow`, as the other packages bound work; 453 ms measured locally, the sort-based median cut
it replaced took 36.7 s), and `bundleSize.test.ts`: no encoder or muxer in the entry chunk and its static imports,
every one in a chunk loaded on demand. Their gzip size is the budget `bundleGzipBytes.export` and the time of a whole
export `frameTimeMs.export-turntable-64-f4-n16` (Budgets, below).

## Model-view fixture

`fixtures/model-view.html?variant=<name>` renders a real loader result (`loadBbmodel` or `loadGltf` on a formats test
fixture, imported statically in `fixtures/src/modelViewScenes.ts`; the URL only picks one of the variants below,
looked up as an own key) with one fixed camera,
light and look (`fixtures/src/modelViewCamera.ts`), in two independent ways that read the same material table and
shading include:

- `raster`: an orthographic depth-only pass from the light (DEPTH_COMPONENT24, 1024², alpha-tested, slope polygon
  offset, back faces of single-sided runs culled as seen from the light, camera-only runs skipped), then the camera pass with the same culling,
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
  triangle blocks (a single-sided one only if its front faces the light; a camera-only one never). Triangles and their vertex normals live in
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

| variant                           | golden                     | checks                                                                                           |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `alpha-plane-raster`              | `alpha-plane-raster.png`   | golden; probes; pair                                                                             |
| `alpha-plane-raycast`             | `alpha-plane-raycast.png`  | golden; probes; pair; byte-identical re-render                                                   |
| `mesh-shapes-raster`              | `mesh-shapes-raster.png`   | golden (triangle, out-of-order quad, n-gons, null-texture face, rotated mesh, smooth arch); pair |
| `mesh-shapes-raycast`             | `mesh-shapes-raycast.png`  | golden; pair                                                                                     |
| `render-order-raster`             | `render-order-raster.png`  | golden; render-order probes; pair                                                                |
| `render-order-raycast`            | `render-order-raycast.png` | golden; render-order probes; pair                                                                |
| `gltf-nodes-raster`               | `gltf-nodes-raster.png`    | golden (glTF hierarchy, baked transforms, factor textures); `MASK` probes; pair                  |
| `gltf-nodes-raycast`              | `gltf-nodes-raycast.png`   | golden; `MASK` probes; pair                                                                      |
| `player-raster`                   | `player-raster.png`        | golden; skin probes; pair                                                                        |
| `player-raycast`                  | `player-raycast.png`       | golden; skin probes; pair                                                                        |
| `alpha-plane-camera-only-raster`  | none                       | probes: the camera-only cutout plane is seen but its shadow is absent                            |
| `alpha-plane-camera-only-raycast` | none                       | probes: the camera-only cutout plane is seen but its shadow is absent                            |

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
size of `app`, `app-entry`, `embed`, `embed-frame`, `site`, `site-assets` and `export`. `embed` is the element script `modelshot-embed.js` (its own Vite lib build, `vite.element.config.ts`) with any chunk it imports statically, what a host page loads; `embed-frame` is every JS, CSS and HTML file of the frame page's build (entry, lazy bake chunk, load and bake workers), what the iframe loads. `app` is every JS and CSS file of `packages/app`'s build (the entry, the lazy path tracer and export chunks, the loaders and the workers); `app-entry` is `index.html`, the stylesheet and the entry script with the chunks it imports statically, what the page loads before a model is opened. `site` is a plain `vite build` of `packages/site` without the `/app/` copy that `build:with-app` adds; `site-assets` is the same build's woff2 and svg files; `export` is `@modelshot/export` built as a library (Vite lib mode, the workspace packages external), the entry chunk and the chunks it imports statically, each gzipped, so the encoders, loaded on demand, are not counted. `pnpm test` measures them (`bench.spec.ts`; the bundle is built fresh into a temporary directory, so
it does not depend on `pnpm -r build`) and fails when a value exceeds its `max`, when a budget has no measurement, or
a measurement has no budget. The measured values are in `tools/harness/test-results/serial/budgets-measured.json`, and
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

`frameTimeMs.rt-frame-partial-edge-512` (MS-60): the `partial-edge` view at 512 x 512, raster key, 4x MSAA, the
quad filling most of the frame, so the transparency pass runs per sample into its multisampled targets with the seam
ramp, plus their two resolve blits; median of 30 frames after 5. Local SwiftShader medians 128.1 (the bench run),
142.8 and 165.2 ms against 80.5 ms with origin/main's renderer in the same session (SwiftShader blends and resolves
every sample; on GPU hardware that is the MSAA resolve's cost); max 1500 ms, 10x the middle run, rounded up, until a
CI artefact allows 3-4x the CI median. `rt-bench-512` in the same session: 926.6 and 931.1 ms against 899.9 ms on
origin/main (+3 %, the run-to-run spread; the machine was loaded, `rt-bench-order-512` 666.5 and 684.8 against 637.8).
The bundle grew by 687 B (`app`) and 689 B (`app-entry`) gzip against origin/main 03a9a9d (`test/bundleSize.test.ts`);
the bench's bundle check measures 205 004 / 205 300 and 66 571 / 66 800.

`frameTimeMs.rt-load-first-frame-200k-order` times `setScene` plus the first frame of a generated scene at the
loader's limits (100 000 quads, 200 000 triangles, 400 000 vertices) at render order 1, which builds the exact key's
de-indexed geometry and its shared-edge flags at upload: local SwiftShader 348, 344 and 354 ms before the flags, 506
and 527 ms with them; since round 7 436 and 447 ms; max 3500 ms (10x of the first measurement).

`frameTimeMs.rt-bench-order-512` is the same scene with one mesh at render order 1, so every frame uses the exact
depth key (fragment depth, de-indexed geometry); max 2000 ms like the raster bench (MS-44): CI medians 537.9 ms on
the normal runner (run 39594658979) and 919.5 ms on the slow one (run 39650722835), so 3.7x and 2.2x; last local
median 326.8 ms (`budgets-measured.json`, 2026-10-21). MS-35: a still exact frame draws one rotated-grid pass of its
sample history per `render()`, so the bench pins its draws to those of the single-sampled frame (`msaa=0`, 519 both)
and its median to at most 1.25x that frame's, measured alongside: local 349.3 ms against 340.0 ms (2026-10-27; the
raster bench 409.7 ms in the same run, the machine slower than on 2026-10-21). A 2 x 2 supersampled frame (an earlier
round) cost 938-1062 ms, about 2.9x, and was dropped for it. `rt-load-first-frame-200k-order` times the first call
only: 1 751.2 ms in that run. History, MS-12 local SwiftShader medians: `rt-bench-512` 92,
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
- `timeToSamplesMs.pt-bench-128-n64-x2-denoised` (MS-18): the final-render path on the same scene, 64 samples at 2x
  (256 x 256 traced) in one step, the guides, a noise estimate at every checkpoint from 2 to 64 and one denoised
  resolve at the end, until the GPU finished, median of 3. Local SwiftShader median 7209 ms (one bench run, where
  `pt-bench-128-n256` measured 4703; 6657 and 4886 with RGBA32F filter images and lazy programs, round 2); max 73 000 ms is 10x, rounded up, as for `pt-bench-128-n256`, until a CI
  artefact allows 3-4x the CI median (the plan's 1.5x would fail on runners 3-5x slower than this machine).
- `frameTimeMs.pt-bench-128-x2-denoised-step` (MS-56): the same request (64 samples at 2x, denoised) drawn by `step(1)`
  calls, each timed until the GPU finished (`finish()`: a guide-only step ends with the default framebuffer bound,
  checked by the guide-tile test), the longest step, median of 3 after one untimed run. Local SwiftShader, before the
  guide was spread: the first
  step drew the whole guide, 2515, 2384, 2592 and 2477 ms in four runs (the guide plus the first sample, program
  already linked). After: 229, 231, 238 and 230 ms, the slowest steps being a checkpoint's noise estimate and resolve
  (about 250 ms) and single guide tiles (up to about 240 ms where a tile meets partial texels); the guide steps take 5
  to
  240 ms. Max 1500 ms, not the 10x of the median (2600 ms) that the other rows use: that would be above the 2.4 s of
  the unspread guide and catch nothing; 1500 ms is about 6x the median, inside the 3-5x of a slower runner, and under
  the old step. The browser test `a denoised step(k) draws a bounded number of guide tiles` counts guide draws per
  step (`track=1`): never more than `max(1, floor(k x pixels / (side^2 x 64)))`, in total `ceil(W/side) x ceil(H/side)`,
  and no sample, no trace draw and no present before the last one.
- `frameTimeMs.pt-load-200k`: `setScene` of the generated 200 000-triangle scene of
  `rt-load-first-frame-200k-order` (validate, flatten, BVH build in JavaScript, upload) plus its first sample. Local
  SwiftShader 1554, 919 and 941 ms; max 10 000 ms (10x the middle run, rounded up). Since MS-40 the flatten and BVH
  build run in the geometry worker and the upload in bands: 2418 ms in a bench run on a loaded machine (the bake read
  28.3 s there against 22.1 s before); in one session the 200 000-triangle `setScene` alone took 2107 and 1961 ms with
  the worker, 1881 and 1840 ms with `geometryWorker=0`.
- `mainThreadBlockMs.pt-setscene-200k` (MS-40): the most one main-thread task blocked (CPU plus GPU wait, the trace
  of the rows below) during `setScene` of that 200 000-triangle document on `pt.html?scene=empty`: validation, the
  triangle count, the mesh stream to the geometry worker, taking its transferred buffers back, the banded upload (128
  rows, 4 MiB, per task) and the swap. The document is built first (`pt.prepareLarge()`), outside the trace;
  `pt.setLarge()` is the traced call, and the bench asserts it applied 200 000 triangles in the worker
  (`pt.geometryInWorker`). Max 50 ms, fixed like the bake rows. Local SwiftShader: 14.4 ms (382 tasks; CPU 14.4 ms,
  largest GPU wait 13.1 ms in one task, a band's `texSubImage2D`), the call to applied 3238 ms.
- `bundleGzipBytes` embed 3200 and embed-frame 177 200 (MS-24: the element and the frame page; measured 2949 and
  161 810 B, gzip level 9, plus 10 %, rounded up to 100). Before MS-24 embed was a 115 B stub with a max of 2200.
  embed-frame 195 100 (MS-52: the frame grew with MS-54, MS-56 and MS-52's texture wrap to 177 303 B, over the 177 200;
  re-measured plus 10 %, rounded up to 100).
  `app` 205 300 and `app-entry` 66 800 (MS-23: the app opens, looks, renders and exports; measured 186 590 and 60 655 B, gzip level 9, plus 10 %, rounded up to 100). The app-entry row is what loads before a model is opened; the lazy tracer and export chunks count only in `app`.
  `app` 226 300 and `app-entry` 73 800 (MS-38: the app grew with later tasks and MS-38's linear texture filtering, its
  shared GLSL chunk in both renderers, to 205 708 B, over the 205 300; the entry carries the preview's copy of that
  chunk and with MS-35 measured 67 052 B, over the 66 800; re-measured plus 10 %, rounded up to 100).
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

`frameTimeMs.export-turntable-64-f4-n16` (MS-22): `bench.spec.ts` times `window.__msExport.turntable()` of
`export.html`, a transparent 4-frame APNG turntable of the showcase at 64 x 64 and 16 samples a frame from a fresh
path tracer (its scene upload, the frames, the encoding; no decoding), median of 3: local SwiftShader 915, 860 and 867
ms; max 9000 ms, 10x the median rounded up, as budgets are set before a CI measurement. `frameTimeMs.export-animation-64-f4-n16` and `export-animation-atlas2048-64-f4-n16` (MS-58): the same with
`window.__msExport.animation()`, the 4-frame APNG animation of the showcase bobbing, each pose sharing the textures
array so the tracer keeps its images (no decode, no texture upload). The bench also times it with `fullSetScene`, a
new textures array per pose (what a `setScene` did before), once with the showcase's own small atlas and once with a
generated 2048 x 2048 noise PNG (`atlasSide`, made once per page), one untimed run of each first, median of 3
interleaved, and logs both: showcase atlas pose 478-784 ms against full 553-789 ms (no difference, the atlas is a few
KB: the frame is the samples, the geometry and the encoding), 2048 atlas pose 532 ms against full 760 ms (-30%: the
decode and the 16 MB layer upload of each frame are gone). Local SwiftShader on a machine busy with other windows,
so the numbers swing; max 5000 and 6000 ms, 10x the median rounded up. No test asserts pose below full (it would flake
under load); the Vitest `textureReuse.test.ts` pins the reuse itself. `bundleGzipBytes.export`
(MS-22): local 6407 and 6433 B (the export package's own `bundleSize.test.ts`, which gzips the chunks as one text,
measured 5839); max 8041 B, 1.25x the larger. Both moved from the package's test and the e2e log into this file once
MS-41 freed it.

`frameTimeMs.rt-load-first-frame-200k-world` (MS-41): the same load of `world-200k` (`fixtures/src/worldLoadScene.ts`),
49 untextured meshes of 4096 triangles each (200 704, every mesh just at the world-chart gate): 42 smooth height fields
with no two triangles coplanar, so every triangle is its own world chart and every mesh is drawn de-indexed per corner,
and 7 edge fans, 4096 triangles on one edge (small book pages, so the first frame draws no deep overdraw). Round 1's
chart search walked every triangle of a shared edge: quadratic on a fan (230 ms per such mesh, 11.3 s for 49 in one
`setScene`, again in the bake worker); it now joins only across an edge of exactly two triangles, pinned in
`worldCharts.test.ts` (49 fans: about 0.5 s in Node; the bound is thread CPU time via `expectCpuBelow`, 3000 ms). Local SwiftShader 1335, 1433 and 1448 ms
(`large-order` 1572 ms and `edges-200k` 1700 ms in the same run; round 1, height fields only: 1111-1224 ms; the layout
alone 0.6-0.9 s in Node); max 3500 ms as for the other load budgets.

Memory of detection at the loaders' vertex limit (MS-15 round 4): `sharpEdges` of the `edges-weld` mesh (400 000
vertices, 200 000 triangles, input 11.4 MB) in Node 22 with `--expose-gc`, a fresh Vitest worker, collected before:
the process's peak resident set grows by 62.8, 62.9 and 63.9 MB (`process.resourceUsage().maxRSS`, three runs; to
about 143 MB), in 264-419 ms. Of that the result kept with the mesh is 16.0 MB (`vertexOf`, `indices`, `distances`,
`angles`); the rest is sort keys, ranks and edge tables, garbage once it returns (right after: heap +29 MB, array
buffers +38 MB before collection). The renderers keep one result per document (`sceneSharpEdges`, latest options).

First CI run (2026-10-20, ubuntu-latest): frame time 0.9 ms (max 5, 5.5x), time to 64 samples 80.6 ms (max 300), gzip app 437 B, embed 115 B.
Limits derive from the CI numbers: re-derive from the `budgets-measured.json` artefact (`test-results/serial/` in `browser-test-results-bench`,
uploaded by the CI `bench` job), with the numbers in the commit.
Changing a `max` is a reviewed change: explain it in the commit with the measured numbers, never raise it to hide a
regression.
