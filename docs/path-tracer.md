# Path tracer

`@modelshot/pathtracer` renders a `SceneDocument` by path tracing in a WebGL2 fragment shader: the final render, with
global illumination and soft, texel-shaped shadows. It reads the same camera, materials, alpha rule, sides, render
order, light rig and tone mapping as the realtime preview ([realtime-renderer.md](realtime-renderer.md)), so the two
images of a view agree apart from shadows, interreflection and noise. The package is private and not yet wired into
the app or the embed.

```ts
const tracer = PathTracer.create(canvas, { preserveDrawingBuffer: true });
tracer.resize({ cssWidth: 512, cssHeight: 512, devicePixelRatio: window.devicePixelRatio });
const { warnings, triangles } = await tracer.setScene(doc, { emission: [undefined, [4, 2.2, 0.8]] });
tracer.setCamera(camera); // the shared SceneCamera
tracer.start({ seed: 1, samples: 256 });
const frame = () => {
  if (tracer.step(4) > 0) requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
```

## API

- `PathTracer.create(canvas, options)`: creates the WebGL2 context. Options: `background` (scene-linear, default the
  look's backdrop, as in the preview), `maxBounces` (1..16, default 4), `maxTriangles` (default 200 000, the loaders'
  limit), `maxTextureSide` (default 4096, capped by `MAX_TEXTURE_SIZE`), `maxTexturePixelsTotal` (default 64 Mi),
  `tileSize` (16..4096, default 256), `maxPixels`, `preserveDrawingBuffer`.
- `setScene(doc, { emission })`: validates, flattens, builds the BVH, decodes textures, swaps the scene in. A later call
  or `dispose()` supersedes a pending one: it resolves `{ applied: false }` and closes what it decoded. Resolves
  `{ applied, warnings, triangles }`.
- `setCamera(camera)`, `resize(cssSize)`: the shared `SceneCamera` and the canvas size, as for the preview.
- `start({ seed, samples })`: a request for exactly `samples` samples per pixel (1..65 536) from `seed`
  (0..2^32 − 1); anything else throws a `RangeError`.
- `step(maxSamples = 1)`: draws up to `maxSamples` more samples, never past the request, presents the mean and returns
  how many it drew. The caller paces it (there is no clock or animation loop inside); a no-op returning 0 without a
  camera, when complete, cancelled, while the context is lost or after `dispose()`.
- `samplesDone`, `targetSamples`, `running`; `cancel()` stops the request and keeps the image of the samples done.
- `readAccumulation()`: the RGBA32F per-pixel sums (divide by `samplesDone`), for the denoiser and supersampling of
  MS-18.
- `onContextRestored(listener)`, `dispose()` (every GL object, decoded image and listener).

`setScene`, `setCamera`, `resize` and `start` restart the accumulation at sample 0.

Emission is a per-material linear RGB input (`SetSceneOptions.emission`, indexed like `materials`; negative or
non-finite channels count as 0). The scene format has no emission field yet; MS-32 maps one here.

## Pipeline

1. `validateScene` (the realtime renderer's, so both reject the same documents; its error becomes
   `PathTracerError` `INVALID_SCENE` with the path).
2. `flattenScene`: the visible meshes (own flag and node visibility) placed by their node's world matrix; per triangle
   its corners, vertex normals, UVs, the face's UV rectangle, material, sidedness and render order. Triangles with a
   non-finite position, normal, UV or rectangle, or with no area, are skipped and counted (`DEGENERATE_TRIANGLES`
   warning). More visible triangles than `maxTriangles` throw `SCENE_TOO_LARGE` before anything is read or allocated.
3. `buildBvh`: binned SAH (12 bins per axis), leaves of at most 4 triangles, in JavaScript on the main thread (with
   upload and a first sample about 1 s for 200 000 triangles on the dev machine, `pt-load-200k`). Deterministic: ties go to the lower axis and
   bin, partitions are stable. Depth is at most 31 for any input: a node whose triangles would need every remaining
   level if split at the median, or whose centroids coincide, is split at its index median instead; the shader's
   32-entry traversal stack therefore never overflows.
4. `packGeometry` / `packMaterials`: RGBA32F data textures 2048 texels wide (nodes 2 texels, triangle positions 3,
   attributes 5, materials 3); rows over `MAX_TEXTURE_SIZE` throw `SCENE_TOO_LARGE` before allocating.
5. Textures are decoded by the realtime renderer's `decodeTextures` (the same header checks, limits, placeholders and
   warnings; bytes go through a Blob, nothing is fetched) and shelf-packed into one SRGB8_ALPHA8 `TEXTURE_2D_ARRAY`
   (GLSL ES 3.00 cannot pick a sampler by a dynamic index): one layer of the smallest power-of-two width that holds
   everything, else layers of min(`MAX_TEXTURE_SIZE`, 4096); more layers than `MAX_ARRAY_TEXTURE_LAYERS` throw
   `SCENE_TOO_LARGE`. The untextured colour and the placeholder checker are the preview's (`UNTEXTURED_IMAGE`,
   `PLACEHOLDER_IMAGE`).
6. Per sample, a trace pass per tile (scissor, at most `tileSize` square, so no draw call runs long enough to trip a
   driver watchdog) reads the running sum from one RGBA32F target and writes sum + sample into the other; then they
   swap. A present pass divides by the sample count and applies AgX.

## Determinism

The image is a pure function of scene, camera, size, seed and sample count. Random numbers come from a PCG hash
(`rng.glsl`, mirrored by `pcgHash.ts` and its test vectors) chained over seed, sample index and pixel, then over a
dimension; there is no clock and no `Math.random`. Accumulation adds exact floats in sample order without blending
(no `EXT_float_blend`, no RGBA16F rounding), and every pixel's value depends only on its own coordinates, so batching
and tiling change no byte (tested: one pass of 64, batches of 1 and 7, tiles of 64).

## Scene-format rules on every ray

The rules of [scene-format.md](scene-format.md), realised per ray type:

| ray    | alpha (`texelCoverage` of `@modelshot/looks`)                                   | single-sided faces                      | render order                       |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| camera | invisible skipped; partial taken with probability `a` (stochastic transparency) | front only                              | key with depth along the view axis |
| bounce | as camera                                                                       | front only                              | key with distance along the ray    |
| shadow | invisible skipped; opaque blocks; partial multiplies by `1 − a`                 | only a face whose front faces the light | ignored: any blocking hit blocks   |

- The texel is the nearest one of the hit's UV, clamped to the face's texel rectangle (`faceTexelRange`, the
  preview's chunk), read with `texelFetch`: no filtering, no mipmaps, nothing from a neighbouring atlas region.
  Texel edges come out area-averaged because every sample jitters its camera ray uniformly inside the pixel (a box
  filter).
- Stochastic transparency draws one number per (sample, path vertex, triangle), so each partial surface a ray meets is
  taken independently and the result is order-independent.
- Order key: `t × depthScale − (renderOrder + back) × RENDER_ORDER_TIE_DISTANCE`, `back` = `BACK_SIDE_RENDER_ORDER`
  on the back of a double-sided face; the smallest key wins. A BVH node is skipped when its entry key minus the
  scene's largest order term is behind the best key (the term is 0 when every order is 0, so plain front-to-back
  culling).
- A double-sided face hit from behind shows the same texel (mirrored as seen from behind) with the normal flipped
  toward the ray; rays leaving a surface start on the side the ray came from, offset by 10⁻⁴ of the scene scale, and
  skip the triangle they leave.
- Camera rays honour `near` and `far` (distances along the view axis, as the preview clips), so a camera inside the
  model frames the same.

## Lighting

Materials are Lambert (albedo = the texel's linear colour) plus emission. The light rig is the preview's
(`lightRig` chunk of `@modelshot/looks`): a directional key and a sky/ground fill.

- Key: a delta light of irradiance π · `KEY_COLOR`, sampled at every path vertex with a shadow ray toward
  `KEY_DIRECTION`. Lambert albedo / π times that is the preview's `albedo · KEY_COLOR · max(n · k, 0)`, now with hard,
  texel-shaped shadows.
- Fill: rays that escape the scene after a bounce see `environmentRadiance(d) = mix(GROUND, SKY, ½ + ¾ d.y)`
  (positive for every direction; the lowest channel straight down is 0.0875). The cosine-weighted mean of d.y over the
  hemisphere around n is ⅔ n.y, so an unoccluded Lambert surface receives exactly `mix(GROUND, SKY, ½ + ½ n.y)`: the
  preview's `hemisphereFill(n)`. An unoccluded convex surface therefore converges to the preview's value; only
  shadows and interreflection differ (tested in `looks` numerically and by the pair test).
- Camera rays that escape show the `background` (the same default and AgX as the preview).
- Cosine-weighted bounces up to `maxBounces`, Russian roulette from the third bounce (survival = the largest
  throughput channel, at least 5 %). A sample whose radiance is NaN or infinite counts as 0 instead of poisoning the sum.

## Limits and errors

`PathTracerError` codes: `WEBGL2_UNAVAILABLE`; `FLOAT_TARGETS_UNAVAILABLE` (no `EXT_color_buffer_float` or RGBA32F
targets not renderable) and `HIGHP_UNAVAILABLE` (fragment shaders without 32-bit highp): there is no inexact fallback,
which would break determinism, and the preview remains; `SHADER_COMPILE` / `SHADER_LINK` with the driver's info log;
`INVALID_SCENE` with the path; `SCENE_TOO_LARGE` for triangles over `maxTriangles`, data rows over `MAX_TEXTURE_SIZE`
or texture layers over `MAX_ARRAY_TEXTURE_LAYERS`, always before allocating. Warnings: the realtime renderer's
texture codes (with `texture`) and `DEGENERATE_TRIANGLES` (with `count`).

Shaders are static `.glsl` files under `src/shaders/` (`trace.frag`, `present.frag`, `fullscreen.vert` and the chunks
`rng`, `sceneData`, `primaryRay`, `surfaceHit`, `bvhTraverse`) composed by `linkShader` with the shared look chunks
(`agx`, `texelAlpha`, `faceTexels`, `lightRig`); no shader text is built from user input. The shading normal is
computed in one place (`surfaceAt` in `surfaceHit.glsl`), where edge rounding (MS-15) will plug in.

## Context loss

Drawing pauses (`step` returns 0) while the context is lost. On restore every GPU resource is rebuilt from the
retained CPU data (packed geometry, material table, layer plan and decoded images) and the current request restarts at
sample 0; rendering it again gives the same bytes (tested against the golden).

## Budgets

`timeToSamplesMs.pt-bench-128-n256` (the benchmark scene, 24 576 triangles, 256 samples at 128 × 128) and
`frameTimeMs.pt-load-200k` (`setScene` of the 200 000-triangle scene plus its first sample); numbers in
[testing.md](testing.md#budgets). On real hardware (RTX 3080, ANGLE D3D11, Windows) 256 samples of the benchmark scene
take about 234 ms at 512 × 512 and 88 ms at 128 × 128 (`pt.html?scene=bench&size=512&samples=256&timing=1` shows
the paced manual readout).

## What v0 lacks

Denoising and supersampling (MS-18), look presets (MS-19), emission from the scene format (MS-32), user lights
(MS-33; one directional key and the environment here), edge rounding (MS-15), a Web Worker or WASM build of the BVH,
glossy or transmissive materials, textured environments, and WebGPU.
