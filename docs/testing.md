# Testing

`pnpm test` runs two layers, in order; either failing fails the command and the CI job.

1. `pnpm test:unit`: Vitest, every package plus `tools/harness/test` (comparator, golden store, budgets, bundle size).
2. `pnpm test:browser`: Playwright in a pinned headless Chromium on software WebGL (SwiftShader), `tools/harness`.

Run `pnpm browsers` once per machine (and after a Playwright version bump) to install the browser. Playwright is pinned
to an exact version in `tools/harness/package.json`, which pins the Chromium revision.

## Browser tests

Fixtures in `tools/harness/fixtures` are self-contained WebGL2 pages served by a local Vite server on
`127.0.0.1:4410`. A fixture publishes `window.__msFixture`; the spec waits for `ready`, reads the drawing buffer with
`gl.readPixels`, flips it, and encodes a PNG in Node. Every golden render asserts a SwiftShader renderer, so a local GPU
never produces or checks a golden. Fixture pages make no request off `127.0.0.1:4410` (`environment.spec.ts`), and fixture
image code uses no clock or random source (lint rule; timing lives in `fixtures/src/bench.ts` only).

## Goldens

- Location `tools/harness/goldens/`, one file per name for every platform.
- Names: `name.png` for raster fixtures, `name.s<seed>.n<samples>.png` for path-traced ones. Seed (0..2^32-1) and
  sample count (1..4096) are part of the spec; rendering another seed or count fails the comparison.
- Comparison: pixelmatch (perceptual, anti-aliased pixels counted) with `threshold 0.1` and `maxDiffRatio 0.001`. A
  failure writes `<name>-actual.png`, `<name>-expected.png` and `<name>-diff.png` into `tools/harness/test-results/`;
  CI uploads that folder as the `browser-test-results` artefact.
- A missing golden fails the test. Goldens are written only by `pnpm golden:update [pattern]` (Playwright
  `--update-snapshots=changed`); the command is refused when `CI` is set. Review every changed image as an image before
  committing.
- A per-golden tolerance override needs a non-empty `reason` in the spec, and GPU-variance evidence (the CI diff
  artefact) in the commit.

## Path-tracer goldens

Fix the seed, the sample count, the resolution and the camera. The accumulation stops after exactly N samples, never
after a time. Random numbers come from a seeded integer hash, never `Math.random`.

## Budgets

`budgets.json` (root, `"version": 1`) holds `max` values for frame time, time to 64 samples and gzip bundle size of
`app` and `embed`. `pnpm test` measures them (`bench.spec.ts`; the bundle is built fresh into a temporary directory, so
it does not depend on `pnpm -r build`) and fails when a value exceeds its `max`, when a budget has no measurement, or
a measurement has no budget. The measured values are in `tools/harness/test-results/budgets-measured.json`.

Changing a `max` is a reviewed change: explain it in the commit with the measured numbers, never raise it to hide a
regression. Timing maxima are about 5x a local median because shared CI runners are slower and noisier.
