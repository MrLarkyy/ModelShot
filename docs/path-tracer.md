# Path tracer

`@modelshot/pathtracer` renders a `SceneDocument` by path tracing in a WebGL2 fragment shader: the final render, with
global illumination and soft, texel-shaped shadows. It reads the same camera, materials, alpha rule, sides, render
order, light rig and tone mapping as the realtime preview ([realtime-renderer.md](realtime-renderer.md)), so the two
images of a view agree apart from interreflection and noise once the preview has its baked light (`LightBaker`,
below), and apart from shadows too without it. The package is private and not yet wired into
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
- `setScene(doc, { emission, shadowCatcher })`: validates, checks the material count, flattens, builds the BVH and packs the data
  (synchronously, before its first `await`), then decodes the textures, lays them out and swaps the scene in. Resolves
  `{ applied, warnings, triangles }`. A call that fails keeps the current scene and closes whatever it decoded.
  Superseding: a later call that passes the synchronous checks, or `dispose()`, supersedes a pending one, which
  resolves `{ applied: false }` and closes what it decoded; a later call rejected by those checks (`INVALID_SCENE`,
  `SCENE_TOO_LARGE` for materials, triangles or data rows) does not, and the pending one still applies.
- `setCamera(camera)`, `resize(cssSize)`: the shared `SceneCamera` and the canvas size, as for the preview.
- `start({ seed, samples })`: a request for exactly `samples` samples per pixel (1..65 536) from `seed`
  (0..2^32 − 1); anything else throws a `RangeError`.
- `step(maxSamples = 1)`: draws up to `maxSamples` more samples, never past the request, presents the mean and returns
  how many it drew. The caller paces it (there is no clock or animation loop inside); a no-op returning 0 without a
  camera, when complete, cancelled, while the context is lost or after `dispose()`.
- `samplesDone`, `targetSamples`, `running`; `cancel()` stops the request and keeps the image of the samples done.
- `readAccumulation()`: the RGBA32F accumulation per pixel (rows bottom to top), for the denoiser and supersampling
  of MS-18 and for tests: rgb the radiance sums (divide by `samplesDone`), alpha the count of traversals stopped by
  the per-ray node cap (not divided; 0 in ordinary scenes, see Limits and errors).
- `onContextRestored(listener)`, `dispose()` (every GL object, decoded image and listener).

`setScene`, `setCamera`, `resize` and `start` restart the accumulation at sample 0.

Emission is a per-material linear RGB input (`SetSceneOptions.emission`, indexed like `materials`; negative or
non-finite channels count as 0). The scene format has no emission field yet; MS-32 maps one here.
`SetSceneOptions.shadowCatcher` (default `true`) puts the shadow catcher under the model (see Lighting); its plane is
computed in `setScene` with the scene and kept through a context loss.

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

The light bake (Light baker below) traces its key rays as shadow rays and its fill rays as bounce rays, with the same
functions (`shadowTransmittance`, `closestHit`, `surfaceAt` in one shared GLSL source), so preview and render share
one set of ray rules.

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

- Key: a disc of angular radius `KEY_ANGULAR_RADIUS` (0.04 rad, `LIGHT_RIG_V0.keyAngularRadius`) around
  `KEY_DIRECTION` with irradiance π · `KEY_COLOR`, sampled at every path vertex with one shadow ray in a direction
  drawn uniformly in the cone (`keyConeDirection`, `keyLight.glsl`). The cosine stays `n · KEY_DIRECTION`, so Lambert
  albedo / π times that is the preview's `albedo · KEY_COLOR · max(n · k, 0)` on an unoccluded surface, with soft
  shadows that keep the texel's shape near their caster (penumbra ≈ 2 · 0.04 · distance to the occluder). The radius
  is the largest that keeps alpha-plane's shadow edge within 2 px (0.05 measured 2.96 px, 0.045 1.98 px, 0.04
  0.99 px).
- Fill: rays that escape the scene after a bounce see `environmentRadiance(d) = mix(GROUND, SKY, ½ + ¾ d.y)`
  (positive for every direction; the lowest channel straight down is 0.0875). The cosine-weighted mean of d.y over the
  hemisphere around n is ⅔ n.y, so an unoccluded Lambert surface receives exactly `mix(GROUND, SKY, ½ + ½ n.y)`: the
  preview's `hemisphereFill(n)`. An unoccluded convex surface therefore converges to the preview's value; only
  shadows and interreflection differ (tested in `looks` numerically and by the pair test).
- Camera rays that escape show the `background` (the same default and AgX as the preview).
- Shadow catcher (`shadowCatcherPlane` of the realtime renderer): a camera ray that meets the plane from above,
  inside its rectangle and nearer than the model, traces one key ray in the cone and one cosine-weighted fill ray
  (escaped: `environmentRadiance`) and shows `background × catcherShade(fill, keyT, xz, rect)` of the look. The shade
  is affine in fill and key, so the mean over samples equals the preview's shade of its baked means. The plane is
  invisible to every other ray, so the model renders exactly as without it.
- Cosine-weighted bounces up to `maxBounces`, Russian roulette from the third bounce (survival = the largest
  throughput channel, at least 5 %). A sample whose radiance is NaN or infinite counts as 0 instead of poisoning the sum.

## Limits and errors

`PathTracerError` codes: `WEBGL2_UNAVAILABLE`; `FLOAT_TARGETS_UNAVAILABLE` (no `EXT_color_buffer_float` or RGBA32F
targets not renderable) and `HIGHP_UNAVAILABLE` (fragment shaders without 32-bit highp): there is no inexact fallback,
which would break determinism, and the preview remains; `SHADER_COMPILE` / `SHADER_LINK` with the driver's info log;
`INVALID_SCENE` with the path; `SCENE_TOO_LARGE` for more materials than the material table holds (1.4 M) or
triangles over `maxTriangles` (both before any vertex is read or any array allocated), data rows over
`MAX_TEXTURE_SIZE` (before the data arrays are allocated, after flattening and the BVH build), or texture layers over
`MAX_ARRAY_TEXTURE_LAYERS` (found after decoding: the decoded images are closed). Every one comes before any GPU
allocation and leaves the current scene in place. Warnings: the realtime renderer's texture codes (with `texture`) and
`DEGENERATE_TRIANGLES` (with `count`).

Per-ray work is bounded: a traversal visits at most `MAX_NODE_VISITS` (2048) BVH nodes, so a draw call stays short
whatever the model (10 000 coincident cubes give identical node boxes that no test prunes;
`pt.html?scene=coincident-cubes` renders a sample in about 2.3 s on SwiftShader, page load included). Past the cap the
traversal stops the same way on every run: a camera or bounce ray keeps the best hit found so far, a shadow ray counts
as blocked. Every capped traversal (camera, bounce or shadow) is counted into the alpha channel of the accumulation
(`readAccumulation`; the image reads only rgb), and `pathtracer.spec.ts` asserts 0 on every golden view and on the
costliest real views measured: the benchmark scene, the 200 000-triangle grid of the load budget (its view and
edge-on) and a field of 16 384 cut-out plants (`scene=grass-field`) seen edge-on from the ground and at 2°. Counted
with lower caps, the benchmark scene needs at most 128 to 256 visits and the plant field edge-on 512 to 1024, so 2048
leaves at least twice the worst measured need; the coincident cubes reach it (one capped camera ray per pixel they
cover).

Shaders are static `.glsl` files under `src/shaders/` (`trace.frag`, `bake.frag`, `present.frag`, `fullscreen.vert`
and the chunks `rng`, `sceneData`, `primaryRay`, `surfaceHit`, `bvhTraverse`, `pathSampling`, `keyLight`) composed by
`linkShader` with the shared look chunks (`agx`, `texelAlpha`, `faceTexels`, `lightRig`, `shadowCatcher`); no shader
text is built from user input. The shading normal is
computed in one place (`surfaceAt` in `surfaceHit.glsl`), where edge rounding (MS-15) will plug in.

## Light baker

`LightBaker` bakes the realtime preview's lighting (`BakedLighting` of the realtime renderer, see
[realtime-renderer.md](realtime-renderer.md#baked-lighting)) with this package's GLSL, in a module Worker on an
OffscreenCanvas WebGL2 context. There is no main-thread fallback.

- `LightBaker.create({ maxTriangles, testHooks })` starts the worker (`new Worker(new URL('./bake/bakeWorker.ts',
import.meta.url), { type: 'module' })`); without module workers or OffscreenCanvas it throws `PathTracerError`
  `WORKER_UNAVAILABLE`, as every pending bake rejects when the worker fails.
- `bake(doc, { samples = 64 (1..1024), seed = 1 (0..2^32 − 1), shadowCatcher = true, tileSize = 64 (16..512),
onProgress })` resolves `{ applied, warnings, lighting }`. The main thread only validates (`INVALID_SCENE`, options
  out of range: `RangeError`) and posts the document; texture bytes are posted only when `doc.textures` is not the
  array the previous call posted, else the worker reuses what it decoded. The worker validates again, lays out the
  lightmap (`SCENE_TOO_LARGE` over its limit, before the triangle limit), flattens, builds the BVH, packs the data,
  decodes the textures (header limits, a `Blob`, never a fetch), and checks its GL capabilities
  (`WEBGL2_UNAVAILABLE`, `FLOAT_TARGETS_UNAVAILABLE`, `HIGHP_UNAVAILABLE`).
- Per lightmap texel and sample: a point jittered in the texel (texel charts; the vertex itself, just inside its
  corner, for vertex charts) found through the chart table (UV of the texel point, barycentrics of the triangle that
  holds it, `surfaceAt`), one key ray in the cone (`shadowTransmittance`, skipping the texel's triangle, only where its
  side faces the key) and one cosine-weighted fill ray around the shading normal (escaped: `environmentRadiance`,
  below the surface 0) divided by `hemisphereFill(n)`. No interreflection. Catcher texels do the same on the plane
  with the normal up.
- Determinism: seeded `sampleHash(seed, sample, texel)`, exact float32 ping-pong sums in sample order, per-texel
  independence, so tiles of 32 or 64, the progress cadence and message order change no byte (tested). The lighting is
  a pure function of document, seed, sample count and catcher option.
- Progress: `onProgress({ samplesDone, samples, lighting })` after 4, 16, 64, … samples (each fourfold) below the
  total; the final lighting comes with the result. Half floats are converted in the worker (round to nearest even).
- Pacing: tiles of `tileSize`² texels per draw, at most one draw in flight (a fence, polled on later tasks), so the
  main thread's GL work is never queued behind the bake and a later request is seen after the current tile.
- Supersede: a later `bake` or `dispose()` stops a pending one after its tile; it resolves `applied: false`. Only the
  latest bake is ever applied.
- Context loss in the worker: the bake stops and, once the context is back, the scene is uploaded again from the
  retained CPU data and the bake restarts at sample 0, reaching the same bytes (`testHooks: true` enables
  `loseContext()` for that test).
- `dispose()`: the worker releases its GL objects and decoded images, then is terminated (`terminated`).

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

The light bake has `bakeTimeMs.bake-bench-n16` (the benchmark scene, 16 samples with the catcher, from `bake()` to
the final lighting, median of 3) and `mainThreadBlockMs.bake-bench` (the main thread's longest event-loop lag over
those bakes, fixed at 50 ms); not measured on real hardware yet.

## What v0 lacks

Denoising and supersampling (MS-18), look presets (MS-19; the key radius and catcher strength are rig data for them),
emission from the scene format (MS-32), user lights (MS-33; one directional key and the environment here), edge
rounding (MS-15), a Web Worker or WASM build of the render's BVH (the bake builds its own in its worker), glossy or
transmissive materials, textured environments, and WebGPU. The bake has no interreflection, no animated GI, and bakes
untextured meshes per vertex (no world-density charts yet), so a large untextured ground such as alpha-plane's shows no
baked shadow in the preview while the render has one.
