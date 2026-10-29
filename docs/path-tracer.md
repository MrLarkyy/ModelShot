# Path tracer

`@modelshot/pathtracer` renders a `SceneDocument` by path tracing in a WebGL2 fragment shader: the final render, with
global illumination and soft, texel-shaped shadows. It reads the same camera, materials, alpha rule, sides, render
order, light rig and tone mapping as the realtime preview ([realtime-renderer.md](realtime-renderer.md)), so the two
images of a view agree apart from interreflection and noise once the preview has its baked light (`LightBaker`,
below), and apart from shadows too without it. The package is private and not yet wired into
the app or the embed; `@modelshot/export` ([export.md](export.md)) drives it to export images and clips.

```ts
const tracer = PathTracer.create(canvas, { preserveDrawingBuffer: true });
tracer.resize({ cssWidth: 512, cssHeight: 512, devicePixelRatio: window.devicePixelRatio });
const { warnings, triangles } = await tracer.setScene(doc, { emission: [undefined, [4, 2.2, 0.8]] });
tracer.setCamera(camera); // the shared SceneCamera
tracer.start({ seed: 1, samples: 256 });
const frame = () => {
  if (tracer.step(4) > 0 || tracer.guiding) requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
```

## API

- `PathTracer.create(canvas, options)`: creates the WebGL2 context. Options: `look` (a look preset, default
  `DEFAULT_LOOK`, the preview's; [look-presets.md](look-presets.md)), `background` (scene-linear, a flat backdrop over the
  initial look's; three finite channels in 0..16, else a `RangeError`), `maxBounces` (1..16, default 4), `maxTriangles` (default 200 000, the loaders'
  limit), `maxTextureSide` (default 4096, capped by `MAX_TEXTURE_SIZE`), `maxTexturePixelsTotal` (default 64 Mi),
  `tileSize` (16..4096, default 256), `maxPixels`, `preserveDrawingBuffer`, `edges` (`Partial<EdgeLook>`, the
  preview's rounded edges over the initial look's; out of range a `RangeError` naming `edges.width` or
  `edges.sharpAngleDeg`), `geometryWorker` (default `true`: `setScene` builds the geometry in a module Worker;
  `false` builds it on the main thread, for a host that forbids workers; the bytes are the same).
- `geometryInWorker`: whether `setScene` builds in the worker; `false` with the option off, without Worker support, or
  once the worker could not start or failed.
- `setScene(doc, { emission, shadowCatcher, catcherBounds })`: validates, checks the material count, the visible
  triangle count (from the group counts) and `catcherBounds` (synchronously, before its first `await` and before
  anything is posted to the worker); then the geometry worker flattens, builds the BVH and packs the data, the
  textures are decoded and laid out, the data uploads in bands over several tasks and the scene is swapped in
  (Pipeline). Resolves `{ applied, warnings, triangles }`. A call that fails keeps the current scene and closes
  whatever it decoded. Superseding: a later call that passes every limit (whenever its geometry arrives), or
  `dispose()`, supersedes a pending one, which resolves `{ applied: false }` and closes what it decoded; a later call
  rejected for a limit (`INVALID_SCENE`, `SCENE_TOO_LARGE` for materials, triangles or data rows, the last one after
  the worker) does not, and the pending one still applies. A document whose `textures` array is the one of the shown
  scene (compared by object, like the meshes) is a pose or a visibility change of the same model: its textures are
  not decoded, laid out or uploaded again, the decoded images, the layer plan, the warnings and the GPU layer texture
  of the shown scene serve it, and with the same `materials` array and equal `emission` so does the material table;
  only the geometry is built (the whole BVH again, so the bytes equal a call with new arrays) and uploaded. The
  result and the pixels are those of a call with new arrays. A changed texture needs a new array: one mutated in
  place is not seen. `animateScene` documents share the arrays, so the frames of an animation export take this path.
- `setCamera(camera)`, `resize(cssSize)`: the shared `SceneCamera` and the canvas size, as for the preview.
- `setEdges(edges)`, `edgeLook`: the rounded edges (fields left out keep theirs; a bad value throws as for the option
  and changes nothing). A new width restarts the accumulation; a new sharp angle detects the edges again and rewrites
  the triangles' edge texels (`packTriangleEdges`), then writes the triangle attribute rows into the shown scene's
  texture in place (one `texSubImage2D`; the handles, the other data textures and the images stay, nothing is
  uploaded again). A scene whose `setScene` was still decoding when the angle changed is packed at the current angle
  before its first upload; one still uploading gets the same in-place rewrite when it is swapped in.
- `setLook(look)`, `look`: the look (an invalid one throws `LookPresetError` naming the field and changes nothing). The
  shadow catcher moves under the new key; edges as `setEdges`; a scene whose `setScene` is still decoding gets the
  look too (its catcher is placed when it is swapped in).
- `start({ seed, samples, supersample, denoise, noiseThreshold, transparent })`: a request for exactly `samples`
  samples per pixel (1..65 536) from `seed` (0..2^32 − 1). The quality fields (Render quality, below) are optional:
  `supersample` an integer 1..4 (default 1), `denoise` a boolean (default `false`), `noiseThreshold` a number in (0, 1]
  (default none), with which `samples` is the maximum. `transparent` (a boolean, default `false`) renders an alpha
  channel (Transparent renders, below). Left out, the render is byte for byte the one without them. Anything else
  throws a `RangeError` naming the field.
- `step(maxSamples = 1)`: draws up to `maxSamples` more samples, never past the request, presents the image and
  returns how many it drew. The caller paces it (there is no clock or animation loop inside); a no-op returning 0
  without a camera, when complete, converged, cancelled, while the context is lost or after `dispose()`. A denoised
  request first draws its guide, spread over steps (Render quality): a step then returns 0 while `guiding` is true,
  so drive it until it returns 0 and `guiding` is false. The first
  step of a request that needs a quality program links it (Render quality), so a shader failure there throws
  `PathTracerError` `SHADER_COMPILE` / `SHADER_LINK` from `step`.
- `contextLost`: true from the moment the context is lost (`isContextLost()`, before its event too) until a restore.
- `guiding`: a denoised request is drawing its guide, or has finished it and not yet drawn a sample, so `step` may
  return
  0 while the request is unfinished. False whenever `step` would draw nothing (no camera, lost context, complete,
  converged, cancelled, disposed).
- `samplesDone`, `targetSamples`, `running` (false once complete, converged or cancelled); `cancel()` stops the
  request and keeps the image shown: the mean of the samples done, or with `supersample` or `denoise` the image
  resolved at the end of the latest step that crossed a checkpoint (Render quality), which may hold fewer samples.
- `progress`: `RenderProgress` `{ samplesDone, targetSamples, supersample, noise, converged, elapsedMs, remainingMs }`.
  `supersample` is the scale traced at, `noise` the 0.99 quantile of the noise estimate at the last checkpoint (`null`
  without denoise or threshold, and before sample 2), `elapsedMs` from the request's first `step` to the end of its
  latest, `remainingMs` the time left at that pace (with a threshold, to the checkpoint where the noise, falling as
  1/√n, is predicted to reach it), `null` before the first sample and 0 when done. The clock is read for this alone.
- `accumulationWidth`, `accumulationHeight`: the traced size, the canvas size times `progress.supersample`.
- `readAccumulation()`: the RGBA32F accumulation per pixel at the traced size (rows bottom to top), for tests: rgb the
  radiance sums (divide by `samplesDone`), alpha the count of traversals stopped by the per-ray node cap (not
  divided; 0 in ordinary scenes, see Limits and errors).
- `readImage()`: the image presented now as a `RenderedImage` `{ width, height, data }`: 8-bit sRGB RGBA with straight
  alpha, rows top to bottom, as `ImageData` takes it. An opaque request's alpha is 255 and its pixels are the canvas's;
  a transparent request's carry its coverage. `null` before the first sample, while the context is lost (also when it
  went during the read, which would leave zeros), and after `dispose()`. It draws into a transient RGBA8 target that is
  deleted before it returns, so the canvas keeps its opaque context and nothing lives past the call.
- `onContextRestored(listener)`, `dispose()` (every GL object, decoded image and listener).

`setScene`, `setCamera`, `resize`, `setEdges`, `setLook` and `start` restart the accumulation at sample 0.

Emission is a per-material linear RGB input (`SetSceneOptions.emission`, indexed like `materials`; negative or
non-finite channels count as 0). The scene format has no emission field yet; MS-32 maps one here.
`SetSceneOptions.shadowCatcher` (default `true`) puts the shadow catcher under the model (see Lighting); its plane is
computed from the scene's bounds and the look's key when the scene is swapped in (again on `setLook`) and kept through a
context loss. `SetSceneOptions.catcherBounds` (a `SceneBounds`, finite `min ≤ max`, else a `RangeError` naming it)
replaces the scene's bounds for the catcher alone: an animation export passes the union of all its poses, so the
floor does not ride with a jump.

## Pipeline

1. `validateScene` (the realtime renderer's, so both reject the same documents; its error becomes
   `PathTracerError` `INVALID_SCENE` with the path).
2. `flattenScene`: the visible meshes (own flag and node visibility) placed by their node's world matrix; per triangle
   its corners, vertex normals (mapped by `mat4NormalMatrix` of the node's world matrix and normalised, as the
   preview's `u_normalMatrix`, so a scaled node shades alike), UVs, the face's UV rectangle, material, sidedness and
   render order. Edge distances stay in mesh units, as in the preview. Triangles with a
   non-finite position, normal, UV or rectangle, or with no area, are skipped and counted (`DEGENERATE_TRIANGLES`
   warning). More visible triangles than `maxTriangles` throw `SCENE_TOO_LARGE` before anything is read or allocated.
   With edge options (the render; the bake passes none) each triangle also carries its corners' four sharp-edge
   distances and the slots' angles (`flatEdges`, from `sceneSharpEdges` of the document, looked up once).
3. `buildBvh`: binned SAH (12 bins per axis), leaves of at most 4 triangles, in JavaScript (with upload and a first
   sample about 1-2 s for 200 000 triangles under software WebGL, `pt-load-200k`, see testing.md). Deterministic: ties
   go to the lower axis
   and bin, partitions are stable. Depth is at most 31 for any input: a node whose triangles would need every remaining
   level if split at the median, or whose centroids coincide, is split at its index median instead; the shader's
   32-entry traversal stack therefore never overflows.
4. `packGeometry` / `packMaterials`: RGBA32F data textures 2048 texels wide (nodes 2 texels, triangle positions 3,
   attributes 9, materials 3); rows over `MAX_TEXTURE_SIZE` throw `SCENE_TOO_LARGE` before allocating. Attribute
   texels: normals and UVs (0-3), the UV rectangle (4), corner k's edge distances (5 + k, `NO_EDGE` when empty) and
   the slots' angles (8).

   Steps 2-4 and the catcher's `sceneBounds` run off the main thread (MS-40), in one function (`prepareGeometry`) that
   the geometry worker and the main-thread fallback share, so both give the same bytes. The main thread checks the
   triangle count from the group counts first, so a document over `maxTriangles` never reaches the worker; then it
   streams the meshes the worker does not hold yet (by object, as the light bake's `streamMeshes`: 1 MiB transferred
   chunks, a yield every 2 MiB; never texture bytes) and the worker transfers the packed buffers back. Without Worker
   support, with `geometryWorker: false`, or once the worker could not start or failed (its pending builds then run
   again on the main thread, in call order), the main thread runs the same function. No timeout: the work is bounded
   by `maxTriangles` and the row limits, and `dispose()` terminates the worker.

5. Textures are decoded by the realtime renderer's `decodeTextures` (the same header checks, limits, placeholders and
   warnings; bytes go through a Blob, nothing is fetched) and shelf-packed into one SRGB8_ALPHA8 `TEXTURE_2D_ARRAY`
   (GLSL ES 3.00 cannot pick a sampler by a dynamic index): one layer of the smallest power-of-two width that holds
   everything, else layers of min(`MAX_TEXTURE_SIZE`, 4096); more layers than `MAX_ARRAY_TEXTURE_LAYERS` throw
   `SCENE_TOO_LARGE`. The untextured colour and the placeholder checker are the preview's (`UNTEXTURED_IMAGE`,
   `PLACEHOLDER_IMAGE`). A `setScene` with the shown scene's `textures` array skips this step and borrows the shown
   scene's images and layer texture (and its material table when `materials` and `emission` match); the images then
   belong to both scenes and are closed once, when neither shows them, and the swap deletes only the textures the new
   scene does not hold. `setEdges` keeps the shown scene, so the borrowed textures stay; only a context restore
   replaces it during the upload, and the swap then uploads the scene fresh from the images instead.
   The data textures and the images upload over several tasks while the current scene keeps drawing: at most
   `BAND_ROWS` (128) rows, 4 MiB, of a data texture per task, and images in groups of at most 4 MiB per task (a larger
   image in row bands of 4 MiB: a `RawImage` by a view of its rows, an `ImageBitmap` by `UNPACK_SKIP_ROWS`). A
   superseded upload, or one whose context was lost, deletes what it made; the swap then releases the
   old scene's textures, so for that moment both scenes' data are on the GPU (about 2 × 40 MB at 200 000 triangles).
   After a context restore and for the empty scene the upload is still one task; so is the rewrite of `setEdges` of a
   new angle (one `texSubImage2D` of the attribute rows, about 28 MB at 200 000 triangles).
6. Per sample, a trace pass per tile (scissor, at most `tileSize` square, so no draw call runs long enough to trip a
   driver watchdog) reads the running sum from one RGBA32F target and writes sum + sample into the other; then they
   swap. A present pass divides by the sample count and applies AgX. The quality path (Render quality) traces at the
   supersampled size, adds a second output to the trace, and at checkpoints runs the noise, denoise and resolve
   passes; present then shows the resolved image. A transparent request adds a third output, the sums of coverage and
   of its square (an RG32F target beside each RGBA32F one, at draw buffer 2; buffer 1 is `NONE` without moments),
   allocated only for such a request and freed with the accumulation.

### Transparent renders

`RenderRequest.transparent` makes alpha the share of camera rays that met something, per texel: a ray takes the
texel's alpha rule like any camera ray (a cut-out texel lets it through, a partial one stops it as often as its alpha,
whatever the draw order), so a hole in a texture is a hole in the alpha. The radiance holds no backdrop: a camera ray
that escapes adds 0 and coverage 0; one that meets the model adds its radiance and coverage 1; one that meets the
shadow catcher adds 0 and coverage 1 − shade (unclamped per sample, so the mean stays affine; never negative, and
exactly 0 where neither catcher ray is blocked), a black shadow-only layer. Over the backdrop, radiance + backdrop × (1 − coverage) is exactly the opaque request's mean in linear light.
Coverage reuses the camera ray's outcome and draws no random number of its own. Resolve takes the box mean of the
coverage. Denoised, the coverage is filtered with the radiance's edge-stopping weights (normal, albedo, depth,
luminance) and one more stop, a coverage step beyond the pixel's own coverage noise (from the squared sum), so the
noisy catcher shadow is smoothed while solid texels and silhouettes keep their alpha; the denoised radiance of escaped
and catcher rays stays 0 (the guide's albedo there is the backdrop). The noise estimate of a transparent request takes
the worse of the luminance's and the coverage's relative standard error, so a threshold does not stop a render whose
colour converged while its alpha is still noisy. The canvas composites in linear
light (it shows what the opaque request shows); `readImage()` unpremultiplies, tone-maps and writes the coverage
clamped to 0..1 as alpha. Composited over the tone-mapped backdrop the readback differs from the opaque image only
where alpha is partial (silhouettes, the catcher's shadow): tone mapping comes before the mix instead of after it
(measured in docs/testing.md, Export goldens). Denoised, the transparent canvas differs from the opaque one where the
filter saw different radiance (silhouettes, the shadow's edge; 14 levels without and 34 with the catcher measured).
The lit catcher has no haze (MS-59): its estimate is a control variate (Path tracing, shadow catcher), so a catcher
sample where nothing blocks is exactly coverage 0. Before, an unblocked fill sample could light the catcher above or
below 1 and the readback's clamp of the mean to 0..1 left a dark haze: in the 64 × 64, 16-sample export golden alpha
1..15 went from 1 164 pixels (MS-22's haze) to 722, alpha 1..3 from 490 to 27. The rest, alpha 4..15 (674 before, 695
after), is the model's real, faint occlusion of the dome: where one fill sample of 16 is blocked its pixel gets alpha 4
to 15, an unbiased speckle that falls as 1/√n with the sample count. A request without the field runs none of this.

## Render quality

`supersample`, `denoise` and `noiseThreshold` on `RenderRequest` (MS-18; MS-22's export passes them per image). The
default request (none of them) runs none of the passes below, allocates none of their targets and links none of
their programs: the context links `trace` and `present`; `guide` and `denoise` are linked on the first step of a
denoised request, `resolve` of a supersampled or denoised one, `noise` of one with denoise or a threshold, and a
restore links only what the current request needs again (`TracerPrograms`). A program that fails to compile or link
keeps its `PathTracerError`: every later step that needs it throws the same error without compiling again, until a
context restore; the failure comes before any target is made or cleared.

1. **Supersampling**: the trace runs at s·width × s·height (`u_viewportSize` and the backdrop's frame height scaled, so
   the view and the gradient are the same) with the jitter of every traced pixel, and resolve takes the box mean of
   each s × s block: the image of s² samples per canvas pixel, framed like scale 1. The scale is the largest
   s ≤ `supersample` whose targets fit min(`MAX_TEXTURE_SIZE`, `MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`) on both
   axes and `MAX_SUPERSAMPLED_PIXELS` (2^22) traced pixels; a larger request is lowered, never refused
   (`supersampledScale`, reported in `progress.supersample`).
2. **Moments** (denoise or a threshold): the trace writes a second target (`layout(location = 1)`, R32F, ping-pong like
   the sum, gated by `u_moments`) with the running sum of each sample's squared Rec. 709 luminance, so each pixel has
   the variance of its mean. Exact float adds in sample order, as the radiance sum.
3. **Guides** (denoise), once per request, before its first sample (`guide.frag`, in tiles an eighth of `tileSize`
   across, at least 16, as a pixel may trace 1024 rays), spread over steps (below): the mean albedo
   (floored at 0.01), shading normal and view depth of 64 camera rays per pixel through the points of a
   (0,2)-sequence (Van der Corput by Sobol', rotated per pixel), into two RGBA16F targets. They are camera rays, so they
   see camera-only faces (outline hulls) as the trace's primary rays do. Each ray accepts partial
   texels with the trace's rule and the key of sample i, so a cut-out texel is never seen; a pixel whose rays met a
   partial texel goes on to 1024 rays, so its alpha mix converges too. The guide is the converged coverage of the
   pixel's texels, not the coverage the request's samples happened to draw: what the samples got wrong at a texel
   edge or a partial texel becomes noise in the quotient below, which the filter removes, and resolve multiplies the
   right mix back in. An escaped ray gives the backdrop colour, normal 0 and no depth, a ray on the shadow catcher the
   backdrop colour, normal up and its depth.
   **Guide scheduling (MS-56).** `step(k)` has a budget of `k` samples' worth of pixels (`k` × traced width × height;
   `Infinity` is unbounded). The guide comes first, tile by tile from a cursor, each tile charged 64 times its pixels
   (a full guide tile costs one trace tile of the same side), as many as fit and at least one per step. A step that
   finishes the guide spends what is left on samples; a step that does not returns 0 with `guiding` true and presents
   nothing, as no sample exists yet. Every checkpoint and the final resolve come after the whole guide, and a guide
   pixel depends only on the seed and the pixel, so the bytes are those of drawing it in one step. A restart or a
   context restore resets the cursor and redraws the whole guide. A partial-texel tile (up to 1024 rays a pixel) can
   cost up to 16 times its charge (a pixel goes from 64 to 1024 rays); the per-step bench row below measures it.
   `step(1)` of a 128 × 128 request at 2x
   takes 64 steps of one guide tile of 32 × 32 pixels instead of one step of the whole guide.
4. **Denoise** (`denoise.frag`, 5 iterations, taps 1, 2, 4, 8, 16 pixels apart): an edge-avoiding à-trous filter
   (Dammertz et al. 2010) with SVGF's edge-stopping (Schied et al. 2017) and none of its temporal part, on the
   demodulated radiance (the mean over the guide albedo). Weights: the 5-tap B3 spline, times exp(−|Δalbedo|²/0.5²),
   times the cosine of the normals to the power 128 (backdrop pixels only with backdrop pixels), times
   exp(−|Δdepth| / (the change the centre's depth slope predicts + 0.5 % of its depth)), times
   exp(−|Δluminance| / (2·σ + 0.02)) with σ the standard deviation of the centre's mean (3 × 3 prefiltered,
   propagated through the iterations; the 0.02 keeps a cavity no sample lit from taking nothing from its neighbours).
   Only the light is smoothed: resolve multiplies the guide albedo in again, so texels keep their colour and their
   edges, and the filter stops at a silhouette (normal, depth), at a surface seen through a cut-out (depth) and at a
   shadow edge beyond the noise. RGBA32F ping-pong at the traced size: with the albedo floored at 0.01 the variance
   of one sample of a bright emitter over a black texel exceeds half precision. A tap of weight 0 adds nothing, so
   no 0 · Inf can make a NaN. The constants are measured against the
   2048-sample reference ([testing.md](testing.md#render-quality)).
5. **Resolve** (`resolve.frag`): box-downsamples the denoised radiance times the albedo (or the mean, undenoised) into
   a canvas-size RGBA32F image; present reads it with a sample count of 1.
6. **Noise** (`noise.frag`, denoise or a threshold): per canvas pixel the relative standard error of its mean
   luminance (the mean floored at 0.05, so near-black never holds a render back; a supersampled pixel's variance is
   that of the mean of its s² traced pixels), the worst in each 4 × 4 block, into one RGBA32F texel per block; the CPU
   reads them back and takes the 0.99 quantile (`noiseQuantile`, so a few firefly blocks cannot hold a render back
   for good).

Checkpoints are the sample counts 1, 2, 4, 8, 16 and then every 16. At each, noise is measured (from 2 samples on);
with `noiseThreshold` the render stops there once the quantile is at or under it (`converged`, `running` false). At
the end of a `step` that crossed a checkpoint or finished, resolve runs (with the denoiser) on the sums so far; between
checkpoints the image shown is the last resolved one. So denoising never runs per sample, and a readback is 1/16 of
the canvas.

Memory: about 88 bytes per traced pixel with denoising (32 the sums, 8 the moments, 16 the guides, 32 the filter
images), so the 2^22 cap is about 370 MB, plus 16 bytes per canvas pixel for the resolved image.

The scale is computed by `start`, `resize` and a restore from the target limits queried once with the context, and
the targets are made at it, so `progress.supersample` and `accumulationWidth` report the scale traced (also while
the context is lost). A noise readback that finds the context lost is discarded: zeros would pass any threshold, so a
loss never reads as convergence (tested).

## Determinism

The image is a pure function of scene, camera, size, seed and sample count. Random numbers come from a PCG hash
(`rng.glsl`, mirrored by `pcgHash.ts` and its test vectors) chained over seed, sample index and pixel, then over a
dimension; there is no clock and no `Math.random`. Accumulation adds exact floats in sample order without blending
(no `EXT_float_blend`, no RGBA16F rounding), and every pixel's value depends only on its own coordinates, so batching
and tiling change no byte (tested: one pass of 64, batches of 1 and 7, tiles of 64). With the quality fields the final
image is a function of the final sums and the guides (both depending on the samples only), and checkpoints are sample
counts, so a denoised 2x render gives the same bytes in batches of 1, 7 and 3, tiles of 64 and after a context restore,
also one lost in the middle of the guide (tested). Where a threshold stops depends on the noise, hence on the GPU's
floats: goldens and the exports use a
fixed sample count. A request without `transparent` runs the same arithmetic as before that field existed (the trace's
radiance sum, the present's opaque line and resolve's colour are unchanged; no path-tracer golden changed), and a
transparent one draws no extra random number, so its radiance of the model is the opaque one's.

## Scene-format rules on every ray

The rules of [scene-format.md](scene-format.md), realised per ray type:

| ray    | alpha (`texelCoverage` of `@modelshot/looks`)                                   | single-sided faces                      | render order                       |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| camera | invisible skipped; partial taken with probability `a` (stochastic transparency) | front only                              | key with depth along the view axis |
| bounce | as camera                                                                       | front only                              | key with distance along the ray    |
| shadow | invisible skipped; opaque blocks; partial multiplies by `1 − a`                 | only a face whose front faces the light | ignored: any blocking hit blocks   |

The light bake (Light baker below) traces its key rays as shadow rays and its fill rays as bounce rays, with the same
functions (`shadowTransmittance`, `closestHit`, `surfaceAt` in one shared GLSL source), so preview and render share
one set of ray rules. A camera-only face (`SceneMeshGroup.cameraOnly`) counts for camera rays alone; every other ray, bake rays included, skips it.

- The texel is the nearest one of the hit's UV, addressed by `faceTexel` (the preview's chunk): clamped to the face's
  texel rectangle (`faceTexelRange`), then into the image, repeated for a texture with `wrap: 'repeat'` and clamped to
  the edge texel otherwise ([`SceneTexture.wrap`](scene-format.md#scenetexture); a strip's image is its frame 0), before the image's place in the
  texture layers is added; read with `texelFetch`: no filtering, no mipmaps, nothing from a neighbouring atlas region
  even where a face's UVs pass its image. The flags ride in the material row (texel 1 w, `textureSamplingFlags`).
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

Materials are Lambert (albedo = the texel's linear colour) plus emission. The light rig is the look's, the preview's
(`lightRig` chunk of `@modelshot/looks`, uniforms uploaded by `uploadLookUniforms`): a directional key, a sky/ground
dome and two unshadowed accents ([look-presets.md](look-presets.md#lighting-model)).

- Key: a disc of angular radius `lights.key.angularRadius` (Studio 0.04 rad; the shader takes its cosine,
  `u_lookKeyCosRadius`) around `lights.key.direction` with irradiance π · `lights.key.color`, sampled at every path vertex with one shadow ray in a direction
  drawn uniformly in the cone (`keyConeDirection`, `keyLight.glsl`). The cosine stays `n · k`, so Lambert
  albedo / π times that is the preview's `albedo · key colour · max(n · k, 0)` on an unoccluded surface, with soft
  shadows that keep the texel's shape near their caster (penumbra ≈ 2 · 0.04 · distance to the occluder). The radius
  is the largest measured that keeps alpha-plane's shadow edge within 2 px with margin: 0.04 gives 0.99 px, 0.045
  sits at the limit (1.98 px) and 0.05 is over it (2.96 px).
- Fill: rays that escape the scene after a bounce see `environmentRadiance(d) = mix(ground, sky, ½ + ¾ d.y)` (`environment.ground` and `.sky` of the look)
  (never negative: the look checker keeps each dome channel within five times the other; Studio's lowest channel
  straight down is 0.0875). The cosine-weighted mean of d.y over the
  hemisphere around n is ⅔ n.y, so an unoccluded Lambert surface receives exactly `mix(ground, sky, ½ + ½ n.y)`: the
  preview's `hemisphereFill(n)`. An unoccluded convex surface therefore converges to the preview's value; only
  shadows and interreflection differ (tested in `looks` numerically and by the pair test).
- Fill and rim accents, added at the camera hit only without a ray: `albedo × fillLight(n)` and the rim's radiance
  `rimLight(n, −direction, albedo)`, seen back along the camera ray (the preview's `towardEye`; the rim's direction
  is turned into world space from the camera, [look-presets.md](look-presets.md#lighting-model)). The preview adds
  them without shadow and has no accent bounce: unshadowed at every vertex they would light faces the rig hides and
  bounce out of them. No random dimension is added, so the sample table and seeds are unchanged.
- Camera rays that escape show the look's backdrop at their pixel (`backdropHere()`: screen y over the full frame
  height, never the tile's), the preview's gradient; before the first sample `present` shows it too.
- Shadow catcher (`shadowCatcherPlane` of the realtime renderer): a camera ray that meets the plane from above,
  inside its rectangle and with no model hit (the catcher lies at the lowest point of the model, or of `catcherBounds`,
  which for an animation is the union of its poses, so a model surface in its plane, like a ground, always wins, as the
  preview draws the catcher first; a transparent request keeps the rule, so such a ground has alpha 1, not the
  catcher's 1 − shade), traces one key ray in the cone and one cosine-weighted fill ray and shows the pixel's backdrop
  × the shade of the look (transparent: radiance 0 and coverage 1 − shade, Transparent renders). The estimate is a
  control variate (MS-59): the analytic unoccluded fill `hemisphereFill(up)` less the `environmentRadiance` a blocked
  fill ray would have brought, and the key's 1 − keyT, through `catcherShadeOfLoss(fillLost, keyLost, xz, rect)`
  (`catcherShade` of fill = `hemisphereFill(up)` − fillLost, written from the losses). Where neither ray is blocked the
  numerator is exactly 0, so every sample is exactly 1 (the bare backdrop, coverage 0) whatever the GPU's division
  rounds; the noise sits where something blocks. The mean is unchanged, since the cosine-weighted mean of
  `environmentRadiance` over the up hemisphere is exactly `hemisphereFill(up)` (a unit test pins it per look). The fill
  ray accepts partial texels with its own random number (vertex 0's roulette dimension, unused there), not the camera
  ray's, so a catcher point seen through glass still has the glass's fill shadow, as in the bake. The shade is affine
  in both losses, so the mean over samples equals the preview's `catcherShade` of its baked means. A lightless look
  (sky, ground and key all 0: the light weight at most 1e-6) has nothing a model could take, so both functions return
  exactly 1 there and the catcher is invisible in the preview and the render alike. The plane is invisible to every
  other ray, so the model renders exactly as without it.
- Rounded edges: `surfaceAt` bends the interpolated normal with the shared `roundedNormal` (`edgeRounding` chunk of
  `@modelshot/looks`, the preview's function) before a back side flips it. Each slot's direction toward its edge is
  minus the gradient of its distance over the triangle, computed exactly from the corners (the preview takes it from
  screen derivatives); the footprint is 0, as the jittered samples average the band over the pixel. `u_edgeWidth` is
  `EdgeLook.width`; the light bake binds 0 (its lightmap texels are coarser than the band).
- Cosine-weighted bounces up to `maxBounces`, Russian roulette from the third bounce (survival = the largest
  throughput channel, at least 5 %). A direction drawn around a shading normal bent away from the geometric one
  (rounded edges, smooth shading) can point into the surface: it is mirrored about the surface plane
  (`aboveSurface`, `pathSampling.glsl`) instead of ending the path, which lost that light and darkened bent normals
  against the preview's fill. No random number is added. A sample whose radiance is NaN or infinite counts as 0 instead of poisoning the sum.

## Limits and errors

`PathTracerError` codes: `WEBGL2_UNAVAILABLE`; `FLOAT_TARGETS_UNAVAILABLE` (no `EXT_color_buffer_float` or RGBA32F
targets not renderable; a transparent request's message names the R32F coverage target) and `HIGHP_UNAVAILABLE` (fragment shaders without 32-bit highp): there is no inexact fallback,
which would break determinism, and the preview remains; `SHADER_COMPILE` / `SHADER_LINK` with the driver's info log;
`INVALID_SCENE` with the path; `SCENE_TOO_LARGE` for more materials than the material table holds (1.4 M) or
triangles over `maxTriangles` (both before any vertex is read or any array allocated, and before anything is posted to
the geometry worker), data rows over `MAX_TEXTURE_SIZE` (before the data arrays are allocated, after flattening and the
BVH build, in the worker), or texture layers over
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

Shaders are static `.glsl` files under `src/shaders/` (`trace.frag`, `bake.frag`, `present.frag`, `guide.frag`,
`denoise.frag`, `resolve.frag`, `noise.frag`, `fullscreen.vert` and the chunks `rng`, `sceneData`, `primaryRay`,
`surfaceHit`, `bvhTraverse`, `pathSampling`, `keyLight`, `cameraCatcher`, `luminanceMoments`) composed by
`linkShader` with the shared look chunks (`agx`, `texelAlpha`, `faceTexels`, `lightRig`, `shadowCatcher`,
`edgeRounding`); no shader text is built from user input. The shading normal is computed in one place (`surfaceAt` in
`surfaceHit.glsl`), rounded at sharp edges there (Lighting).

## Light baker

`LightBaker` bakes the realtime preview's lighting (`BakedLighting` of the realtime renderer, see
[realtime-renderer.md](realtime-renderer.md#baked-lighting)) with this package's GLSL, in a module Worker on an
OffscreenCanvas WebGL2 context. There is no main-thread fallback.

- `LightBaker.create({ maxTriangles, testHooks })` starts the worker (`new Worker(new URL('./bake/bakeWorker.ts',
import.meta.url), { type: 'module' })`); without module workers or OffscreenCanvas it throws `PathTracerError`
  `WORKER_UNAVAILABLE`, as every pending bake rejects when the worker fails, and every later bake with the same error
  (after `dispose()` a bake resolves `applied: false`).
- `bake(doc, { samples = 64 (1..1024), seed = 1 (0..2^32 − 1), shadowCatcher = true, tileSize = 64 (16..512), look =
DEFAULT_LOOK, onProgress })` resolves `{ applied, warnings, lighting }`. The look's key and dome shape the light and
  its key places the catcher; the lighting carries `lightingKey(look)`, which `setLighting` of the preview checks
  ([look-presets.md](look-presets.md#baked-light-and-lightingkey)). The call only checks the options (`RangeError`,
  `LookPresetError`) and
  validates the document (`INVALID_SCENE`, about a millisecond); posting runs in later tasks, one bake at a time, and
  a bake superseded before its turn is never posted. Only what the worker does not hold is posted: meshes it has not
  received before (a re-bake of the same meshes, a new pose or new options post none; meshes and the textures array
  are compared by object, so a mesh changed in place is not posted again: a changed mesh must be a new `SceneMesh`)
  stream as `meshHeaders` and
  `meshData` messages, the arrays' bytes copied into 1 MiB buffers that are transferred, not cloned, yielding after
  every 2 MiB (`meshStream.ts`; the worker keeps the meshes the latest bake named); texture bytes are posted only when
  `doc.textures` is not the array the previous call posted, else the worker reuses what it decoded. Cloning a model's
  meshes whole cost 8-9 ms (2048 meshes) to 13-19 ms (200 000 triangles) of one task, about 45 ms under load. The worker keeps posted textures before
  anything of that bake can fail, so a refused bake does not cost a later one its images; should it still hold
  another version, or misses a mesh (an abandoned stream), it asks (`resend`) and everything is posted again instead
  of baking placeholders. The worker validates again, lays out the
  lightmap (`SCENE_TOO_LARGE` over its limit, before the triangle limit), flattens, builds the BVH, packs the data,
  decodes the textures (header limits, a `Blob`, never a fetch), and checks its GL capabilities
  (`WEBGL2_UNAVAILABLE`, `FLOAT_TARGETS_UNAVAILABLE`, `HIGHP_UNAVAILABLE`).
- Per lightmap texel and sample: a point jittered in the texel (texel and world charts; the vertex itself, just inside
  its corner, for vertex charts) found through the chart table (`chartTable.ts`: per chart a record of position,
  UV map, triangle list, back offset and mode 0 texel, 1 vertex or 2 world; world charts (MS-41) also list their
  triangles' corners in chart-local texels in a corners texture, 2 texels per triangle, whose first entry the record
  holds): the UV of the texel point, or for a world chart the point itself, then the barycentrics of the triangle
  that holds it (else the one it is nearest to inside), `surfaceAt`, one key ray in the cone (`shadowTransmittance`, skipping the texel's triangle, only where its
  side faces the key) and one cosine-weighted fill ray around the shading normal (escaped: `environmentRadiance`,
  below the surface 0) divided by `hemisphereFill(n)`. No interreflection. Catcher texels do the same on the plane
  with the normal up.
- Determinism: seeded `sampleHash(seed, sample, texel)`, exact float32 ping-pong sums in sample order, per-texel
  independence, so tiles of 32 or 64, the progress cadence and message order change no byte (tested). The lighting is
  a pure function of document, seed, sample count, catcher option and look.
- Progress: `onProgress({ samplesDone, samples, lighting })` after 4, 16, 64, … samples (each fourfold) below the
  total; the final lighting comes with the result. Half floats are converted in the worker (round to nearest even).
- Pacing: tiles of `tileSize`² texels per draw, at most one draw in flight (a fence, polled on later tasks), so the
  main thread's GL work is never queued behind the bake and a later request is seen after the current tile.
- Supersede: a later `bake` or `dispose()` stops a pending one after its tile; it resolves `applied: false`. Only the
  latest bake is ever applied.
- Context loss in the worker: the bake stops and, once the context is back, the scene is uploaded again from the
  retained CPU data and the bake restarts at sample 0, reaching the same bytes. A bake asked for while the context is
  lost is prepared with the limits read when the context was created and starts once it is back. A loss found only by
  `isContextLost()` (the event comes later; a readback then returns zeros) counts as a loss too: nothing of that
  readback is posted. A failure after the scene was prepared (an RGBA32F target the driver rejects) rejects that bake.
  `testHooks: true` enables `loseContext(beforeMark?)` (now, or right before the readback after that many samples) and
  `BakeOptions.countCappedTraversals` (texels hold the traversals their rays stopped at the per-ray node cap; 0 on the
  benchmark scene and the cut-out plant field, tested).
- `dispose()`: the worker releases its GL objects and decoded images, then is terminated (`terminated`).

## Context loss

Drawing pauses (`step` returns 0) while the context is lost. On restore every GPU resource is rebuilt from the
retained CPU data (packed geometry, material table, layer plan and decoded images) and the current request restarts at
sample 0; rendering it again gives the same bytes (tested against the golden). The quality path's targets (moments,
guides, filter, resolved image, noise blocks) and the programs the request needs are recreated on the first step
after the restore and the guides drawn again from the first tile, so a denoised 2x render also gives its bytes again
(tested); `dispose()` deletes them with the rest.

## Budgets

`timeToSamplesMs.pt-bench-128-n256` (the benchmark scene, 24 576 triangles, 256 samples at 128 × 128),
`frameTimeMs.pt-load-200k` (`setScene` of the 200 000-triangle scene plus its first sample),
`mainThreadBlockMs.pt-setscene-200k` (the most one main-thread task blocked during that `setScene`, max 50 ms, MS-40),
and for the final-render
path `timeToSamplesMs.pt-bench-128-n64-x2-denoised` (64 samples at 2x with the guides, noise checkpoints and the
denoised resolve; MS-18) and `frameTimeMs.pt-bench-128-x2-denoised-step` (the longest `step(1)` of that request; MS-56);
numbers in
[testing.md](testing.md#budgets). On real hardware (RTX 3080, ANGLE D3D11, Windows) 256 samples of the benchmark scene
take about 234 ms at 512 × 512 and 88 ms at 128 × 128 (`pt.html?scene=bench&size=512&samples=256&timing=1` shows
the paced manual readout).

The light bake has `bakeTimeMs.bake-bench-n16` (the benchmark scene, 16 samples with the catcher, from `bake()` to
the final lighting, median of 3, each run also checked as it completes), `mainThreadBlockMs.bake-bench` and `mainThreadBlockMs.bake-post-200k` (the most one main-thread task blocked
over the bench bakes, and over a bake of a 200 000-triangle document: its CPU time plus its synchronous GPU waits, from a
Chrome trace; both fixed at 50 ms; not
measured on real hardware yet.

## What v0 lacks

Temporal (video) denoising, emission from the scene format (MS-32), user lights (MS-33; the look's key,
accents and dome here), an image-based environment (the dome is analytic), geometric
bevels (edges are rounded in shading only), a GPU or WASM build of the render's BVH, glossy or
transmissive materials, textured environments, and WebGPU. The bake has no interreflection and no animated GI;
untextured and smooth meshes of more than 4096 triangles are still baked per vertex (world-density charts, MS-41,
stop at that gate).
