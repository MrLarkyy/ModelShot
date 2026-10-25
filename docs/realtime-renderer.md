# Realtime renderer

`@modelshot/renderer-rt` draws a `SceneDocument` with WebGL2: crisp pixel art, per-texel transparency and the AgX
view transform. It draws only when `render()` is called; `needsRender` tells the caller's animation loop whether a
scene, camera or size change is waiting.

```ts
const renderer = RealtimeRenderer.create(canvas, { look: LOOK_PRESETS['marketplace'] });
const controller = new OrbitController();
const { warnings } = await renderer.setScene(doc);
controller.setAspect(canvas.width / canvas.height);
controller.reset(sceneBounds(doc));
renderer.setCamera(controller.camera());
renderer.render();
```

`observeCanvasSize(canvas, (size) => renderer.resize(size))` keeps the backing store at CSS size × devicePixelRatio
(clamped to `MAX_VIEWPORT_DIMS`, `MAX_RENDERBUFFER_SIZE` and the `maxPixels` option, aspect kept, never 0) through
element resizes, browser zoom and moves between screens. `bindOrbitInput(canvas, controller, { onChange })` wires
mouse, touch and keys (see [camera.md](camera.md)).

## Passes

Float path (needs `EXT_color_buffer_float`):

0. With baked lighting that carries one, the shadow catcher (below) right after the clear, without depth test or
   write.
1. Opaque pass into an RGBA16F + DEPTH24 target with MSAA (min(4, the largest sample count the GPU offers for
   RGBA16F); 0 samples draws single-sampled), resolved by a blit of colour and depth. With texel anti-aliasing on
   and at least 2 samples, raster frames draw it with `SAMPLE_ALPHA_TO_COVERAGE` (alpha written off), so cut-out
   seams are anti-aliased per sample (Alpha, below).
2. Weighted blended order-independent transparency (McGuire and Bavoil 2013, weight of equation 10) for partial
   texels: an RGBA16F target (rgb: weighted premultiplied colour, a: product of 1 − alpha) and an R16F target (sum of
   weighted alpha), depth-tested against the resolved depth with depth writes off. Only batches whose texture has
   partial alpha are drawn here (one readback per texture at load decides it).
3. Composite of the transparency average over the opaque image.
4. Present: AgX and the display encoding into the canvas.

No-float path (`capabilities.path === 'fallback'`): the backdrop, the shadow catcher (tone-mapped in its shader), then
one pass into the canvas with AgX in the fragment shader, partial
texels as hashed (screen-door) alpha from an integer hash of texel and pixel. Both paths are order-independent and
deterministic (no clock, no random source). The renderer also switches to this path for good when the driver
rejects the float targets at a new drawing size; `capabilities` then reports `path: 'fallback'` and 0 samples.

Geometry is batched at upload: the visible triangles of one node with one texture, alpha rule, sidedness and render
order share one vertex and index buffer
(`batchScene`). Every vertex keeps its own UV rectangle, so batching changes nothing per texel; a model with one mesh
per element (thousands for a large Blockbench model) draws in a few calls per pass.

## Baked lighting

`setLighting(lighting)` shades the scene with light baked off the main thread by `LightBaker` of
`@modelshot/pathtracer` ([path-tracer.md](path-tracer.md#light-baker)) and draws its shadow catcher;
`setLighting(null)` goes back to the unbaked image, byte for byte. Without lighting nothing changes. Light is baked
under a look (`BakeOptions.look`) and carries its `lightingKey`: `setLighting` refuses light of another key than the
current look's, and `setLook` to a look of another key drops the shown light ([look-presets.md](look-presets.md#baked-light-and-lightingkey)).

```ts
const baker = LightBaker.create();
await renderer.setScene(doc);
const { lighting } = await baker.bake(doc, { onProgress: (p) => renderer.setLighting(p.lighting) });
if (lighting) renderer.setLighting(lighting);
```

- **Layout.** `setScene` lays out a lightmap (`lightmapLayout`, pure and pose-independent) before anything else:
  every face whose UVs map one texture rectangle affinely (every Blockbench element) gets a chart at its own texel
  grid (`faceTexelRange` of its UV rectangle), so light changes per texel like the albedo, rotated or mirrored UVs
  included. Faces sharing atlas cells each get their own chart; a double-sided face gets a second chart for its back,
  right after the front one. A mesh with a vertex shared by triangles of different UV maps (smooth glTF and OBJ
  meshes), an untextured face (a glTF base colour swatch included), a degenerate UV triangle or a chart of more than
  `MAX_CHART_TRIANGLES` (32) triangles gets **world charts** instead (MS-41), when it has at most
  `MAX_WORLD_MESH_TRIANGLES` (4096) triangles: edge-connected coplanar triangles of one group (edges matched by
  position, so faces with their own vertices join; only an edge of exactly two triangles joins, so a fan of thousands
  on one edge costs linear time), at most 32 per chart, projected onto their plane along the
  triangle edge that bounds them tightest, at one **world texel** for the whole scene: the diagonal of the bounds of the
  visible meshes' kept triangles at rest (a vertex no triangle uses does not count) / `WORLD_TEXELS_PER_EXTENT` (256), never finer than the finest texture texel of a texel
  chart. A two-triangle ground of a glTF or OBJ scene so gets a shadow where the box on it stands, not one light value
  per corner. A denser mesh is baked per vertex: one texel per vertex (two when double-sided), interpolated. The atlas
  is `LIGHTMAP_WIDTH` (2048) wide; when the charts would need more than `MAX_LIGHTMAP_TEXELS` (2²¹) texels, the world
  texel doubles (up to 256 times) first, so world light never costs a textured face its resolution; then the
  world-charted meshes fall back to per-vertex light; then texel charts take 2, 4, … texture texels per lightmap
  texel, and when even that fails `setScene` rejects with `RendererError` `SCENE_TOO_LARGE` (path `meshes`) before
  allocating anything. A scene without a world-charted mesh lays out exactly as before world charts existed (same
  `layoutKey`).
- **Values.** RGBA16F (`BakedLighting`): rgb the fill as a multiple of the unoccluded fill `hemisphereFill(n)`, a the
  key's visibility. Texels of no chart and vertices of no triangle hold 1, so an anti-aliasing tap outside a face, or
  a degenerate triangle, never darkens. `shadeBaked` (`shading.glsl`) is `albedo × (hemisphereFill(n) × rgb +
u_lookKeyColor × max(n·u_lookKeyDirection, 0) × a + fillLight(n)) + rimLight(n, v, albedo)`, v toward the eye
  (`towardEye(v_worldPosition)`): the accents cast no shadow and stay whole; value 1 gives the unbaked expression
  exactly.
- **Sampling.** Texel charts are read with the albedo's own seam taps (`seamTaps` of `texelSample.glsl`): the same
  2 × 2 texels and weights, clamped to the chart, so light and albedo change at the same pixels and the bake adds no
  shimmer of its own. World charts are read bilinearly at their own grid (an untextured face has no texel grid to
  keep; seam taps would show its blocks), the 2 × 2 texels clamped to the chart: a world-charted mesh is drawn
  de-indexed, a vertex per triangle corner (`LightmapLayout.cornerData`, composed with the sharp-edge split, so edge
  rounding stays), each corner carrying its point in the lightmap and its chart's rectangle (attribute 11, uploaded
  only for a batch with world charts and left disabled elsewhere, as no other vertex reads it); the
  vertex shader passes them in the vertex-light varyings, as two more varyings would exceed the minimum of 15 next to
  the exact depth key's. Vertex charts are fetched in `mesh.vert.glsl` and interpolated; the back pass reads the back
  chart. The light is sampled before the first `discard` (derivatives).
- **Kept across poses.** `setScene` keeps the lighting when the new document has the same `layoutKey` (the same model
  in another pose), so the old light shows until the re-bake's first update; another layout drops it. A document that
  differs from the shown one only in its pose (`poseOnlyChange`: the same meshes, materials and textures arrays, nodes
  with the same parents, pivots, rest rotations, visibility and meshes) keeps the layout without laying it out again;
  the renderer keeps only what it reads of a layout (`LightmapLayoutSummary`: sizes, downscale, per-vertex and
  per-corner data, finest texel, key), not its charts. World charts come from rest positions, so a pose keeps them. `setLighting`
  refuses (returns `false`, changes nothing) lighting whose layout key, size or data length does not match the current
  layout, whose `lightingKey` is not the current look's, or whose catcher is malformed (`checkLighting`).
- **Upload in bands.** `setLighting` uploads nothing itself: each `render()` (or `advanceLighting()`, which uploads
  without drawing and returns `true` while more remains) writes the next `UPLOAD_FRAME_BYTES` (1 MiB) in
  texSubImage2D bands of at most `UPLOAD_BAND_BYTES` (256 KiB) into back textures, and frames draw the previous complete
  lighting until the new one is in (`lightingPending`), then switch; the old textures are kept for the next update of
  the same shape. One 9.4 MB texSubImage2D (the benchmark scene) makes the browser wait for its GPU process to take
  the data chunk by chunk, and that process also runs the bake's draws: a busy machine turned that into a 120 ms
  main-thread task (MS-16 round 4). A rebuilt context uploads its retained lighting at once.

**Shadow catcher.** A horizontal plane at the visible geometry's lowest point (`shadowCatcherPlane`, shared with the
path tracer), covering the footprint, the bounds' shadow along the key and half the largest extent around it, one-sided
from above. It only darkens the backdrop: pixel = the look's backdrop at the pixel × `catcherShade(fill, keyT, xz, rect)` of the look
(`shadowCatcher.glsl`), with its own lightmap of 4 texels per finest model texel (at most `MAX_CATCHER_SIDE` 512 per
side), read bilinearly. Every model point a camera ray meets lies on or above the plane, so drawing the catcher first
without depth test lets the model cover it in either depth-key variant. A scene without geometry has no catcher.

## Pixel art

- Textures are uploaded as `SRGB8_ALPHA8` with `NEAREST` filtering and no mipmaps (mipmaps would average across
  atlas regions), without flipping or premultiplying; texel (0, 0) is the top-left pixel.
- Texel anti-aliasing: four `texelFetch` taps (linear colour) blended only within one screen pixel of a texel seam
  (offset `clamp((p − seam) / fwidth(p), −0.5, 0.5)`), with premultiplied weights so a cut-out neighbour adds no dark
  fringe. Every tap is clamped to the face's texel rectangle from `SceneMesh.uvRects` (`faceTexelRange`, the
  `faceTexels` chunk of `@modelshot/looks`, which the path tracer clamps with too), so no texel of a neighbouring
  atlas region is ever read, with any face UV rotation or mirroring.
- Minified (more than one texel per pixel): the same clamped lookup at a rotated 2 × 2 grid inside the pixel, which
  keeps far views from shimmering.
- `texelAntialias: false` samples plain nearest texels (used by the shimmer test as its reference).

## Transparency, sides and render order

The rules are the scene format's ([scene-format.md](scene-format.md): `SceneMaterial` for alpha, `SceneMesh` for
`doubleSided` and `renderOrder`); this section only says how the renderer realises them.

- **Alpha**: each draw gets its material's mode and cutoff as an alpha mode id and a cutoff byte (`alphaCutoffByte`,
  the smallest byte k with k / 255 ≥ cutoff), and `#include "texelAlpha"` (`@modelshot/looks`) classifies the nearest
  texel's alpha byte, which equals the scene's `texelCoverage` for every byte, mode and cutoff. Invisible texels are
  discarded in every pass before any depth write, opaque ones are drawn by the opaque pass, partial ones by OIT on the
  float path and hashed alpha on the fallback. Texel anti-aliasing weighs each tap by its coverage (invisible 0,
  opaque 1, partial its alpha), so an opaque-mode material ignores alpha and a cut-out neighbour adds no fringe. A
  texture goes to the transparency pass only if one of its alpha bytes is partial under the draw's rule (alpha bytes
  read back once at load).
- **Anti-aliased cut-out seams** (MS-30): the one exception to the discard above is the opaque pass of a float-path
  raster frame into the MSAA target with texel anti-aliasing on (`alphaToCoverageActive`). There the same seam taps
  that blend the colour also blend a coverage indicator (opaque tap 1, invisible 0, a partial tap 1 beside an opaque
  nearest texel, so an opaque|partial seam stays as it was and OIT keeps the partial side), and the fragment writes it
  as alpha under `SAMPLE_ALPHA_TO_COVERAGE`. Across an opaque|cut-out seam it ramps over one pixel and is 0.5 exactly
  on the texel boundary, so the covered area equals the hard per-texel shape while edge pixels resolve to a mix of
  texel and background; fragments of a cut-out texel in that half-pixel band are kept with the opaque neighbour's
  colour and write depth only at their covered samples. Which texels are cut out does not change: texel centres show
  the background exactly. Exact-key frames (single-sampled), 0 or 1 MSAA samples, `texelAntialias: false`, the
  fallback, OIT, the shadow catcher and the light bake (its own pass in `@modelshot/pathtracer`) keep the binary
  per-texel cutout; without sample buffers GL ignores A2C, which would grow the shape by half a pixel, so a uniform
  tells the shader. GLSL ES 3.00 has no `gl_SampleMask`, so A2C is the only per-sample route in WebGL2. Measured on
  SwiftShader (4 samples, 5 coverage levels per pixel); real GPUs may dither A2C per 2 x 2 pixel quad, and that check
  is manual.
- **Sides**: single-sided groups are drawn with back faces culled in every pass. Double-sided groups are drawn twice
  per render order: front faces, then back faces (front faces culled), the back lit with the flipped normal.
- **Render order**: draws are sorted by render order, descending; per order the front pass, then the back pass of
  double-sided items. The scene format's key is realised in one of two depth-key variants, picked per frame by
  `depthKeyMode` (both linked at start-up; `RealtimeRenderer.depthKeyMode` reports the last frame's):
  - `raster`, used only where every visible mesh has render order 0: the depth buffer compares the projected depth;
    early depth testing and per-sample MSAA depth stay. The back pass gets `polygonOffset(4, 4)`, a slope-scaled push
    that keeps a back side behind the front face it meets at a silhouette or coincides with (the −1/16 order step is
    far below the rasteriser's depth interpolation error; with (1, 1) back sides leak at MSAA samples next to a
    silhouette, see the closed-cube-cutout test). The back pass is skipped for a batch whose meshes are all closed
    solids wound outward (over the mesh's drawn triangles: every edge, matched by position, used exactly once in each
    direction; every edge-connected shell enclosing a positive signed volume, Σ dot(v0, v1 × v2) / 6 above 1e-6 of its
    bounding cube, so inside-out meshes, coincident opposite pairs and cavities fail; no shell's bounds inside
    another's; at most 1024 shells) and opaque on every face (untextured, the opaque alpha mode, or no alpha byte below
    255 inside any face's UV rectangle, from a summed-area table of the load-time alpha readback; a failed readback
    counts as not opaque), unless the camera is inside the batch's world bounding box or the near plane reaches it: from
    outside, every ray meets a front face of such a mesh before any back side, so its back sides could only show as an
    error. Closed and opaque are decided per mesh at load (`closedOpaqueMeshes`; the solid check is about 90–115 ms in
    Node for one closed mesh at the loader's 400 000 vertices) and are part of the batch key. Deviation of this variant:
    a back side that really lies in front of a front face by less than about four pixels' worth of its own depth slope
    (e.g. about 0.3–0.5 units for a face at 45° in the turntable framing) is drawn behind it; and where the back pass is
    still drawn (a closed mesh with a cut-out or a translucent texel on a face, an open double-sided sheet, an
    inside-out mesh, the camera inside the bounds), next to the silhouette of a face within a few degrees of edge-on,
    MSAA samples of a hidden back side can still show: the depth stored at an edge sample is the front face's depth
    about half a pixel away, an error that scales with the front face's depth gradient, so no back-face offset removes
    it (closed cube with cut-outs at 1°: 10 pixels, pinned; the same cube opaque: 0, where it was 74 before the skip;
    none without MSAA). Measured on SwiftShader only; the real-GPU check is manual.
  - `exact`: every mesh pass computes the key per fragment and writes it as `gl_FragDepth`, with the key range
    `[−(1024 + 1) × TIE, far + (1024 + 1) × TIE]` mapped to `[0, 1]` (`exactDepthRange`), so no order is clamped at
    the near or far plane. Exact frames draw single-sampled (no MSAA on the float path): one key per pixel can only be
    right for every sample when the pixel centre is the only sample, since a grazing face spans a large depth range
    inside one pixel. The key is the view depth where the pixel centre's ray meets the triangle's plane (three corners
    in view space, from a de-indexed copy of the geometry), so any two triangles of one plane, coincident faces of any
    triangulation included, key a pixel alike. Where that hit lies on or past an outline edge (an edge not shared with
    a coplanar triangle of the batch: per-triangle flags computed at upload; past it because the rasteriser covers
    with snapped vertices, which at a grazing angle is far along the plane) a front face keys at the nearer of the hit
    and the nearest point of the outline, and a back face keys at that outline point plus two pixels' worth of its
    depth change; shared edges keep the plain hit. Costs early depth testing and MSAA edge smoothing in those frames.
    Used for every draw of a frame when the scene has a visible mesh with render order ≠ 0 (decided at scene upload,
    which then builds the de-indexed geometry and its flags: about 440 ms for load and first frame at the loader's
    200 000 triangles on SwiftShader, `rt-load-first-frame-200k-order`) or when the depth buffer cannot resolve the
    tie at the far plane (24-bit step `(f − n)·f / (n·2²⁴)` above a quarter of it: a camera inside the bounding
    sphere, which builds the de-indexed geometry once, on the first such frame).
  - Limit: on a 16-bit depth buffer (the fallback path's default framebuffer may have only 16 bits) neither variant
    resolves the tie: the exact key is stored in steps of about `(far + 2.05) / 65536` (0.0013 units at far 80), so
    surfaces closer than a step fall to draw order (higher render order first, then document order).

## Lighting and tone mapping

Lights, environment, backdrop, catcher strength, edges and tone mapping come from a look preset
([look-presets.md](look-presets.md)): option `look` (default `DEFAULT_LOOK`, Studio, the v0 look), `setLook(look)` and
the `look` getter. The options `background` (a flat backdrop, three finite channels in 0..16, else a `RangeError`) and `edges` override the initial look's; `setLook`
replaces both with the new look's (`setEdges` still changes the edges alone). An invalid look throws
`LookPresetError` naming the field and changes nothing. A look of another `lightingKey` drops the baked light (see
Baked lighting); a new sharp angle detects edges again as `setEdges` does.

Shading is the look's sky/ground dome (`hemisphereFill`) plus its directional key, unoccluded without baked lighting and
occluded per texel with it, plus the unshadowed accents in both cases, the world-space fill (`fillLight`) and the
view-relative grazing rim (`rimLight`, its direction turned into world space from the frame's camera): the `lightRig`
chunk of `@modelshot/looks`, which the path tracer reads too, so an unoccluded surface converges there to the
preview's value ([path-tracer.md](path-tracer.md#lighting)); `shaders/shading.glsl` applies it. The look's values are
uniforms (`uploadLookUniforms`), uploaded once per program per frame. The backdrop is a pass on both paths
(`backdrop.frag`, the `backdrop` chunk): the look's gradient in screen y over the frame height, scene-linear into the
float path's HDR target, tone-mapped in place on the no-float path; the catcher multiplies the backdrop of its pixel.
The HDR result goes through AgX with the look's exposure and grade (`#include "agx"` from `@modelshot/looks`,
mirrored by `agxToneMap` for tests), whose output is already display-encoded and is written as is.

## Edge rounding

Sharp edges of cubes and meshes catch light as if rounded, without extra geometry (MS-15). The look is `EdgeLook` of
`@modelshot/looks` (`width` 0..`MAX_EDGE_WIDTH` model units, `sharpAngleDeg` 1..179; `EDGE_LOOK_V0` 0.5 and 30°),
option `edges` (a `Partial<EdgeLook>`, out of range a `RangeError` naming `edges.width` or `edges.sharpAngleDeg`) and
`setEdges(edges)` / `edgeLook`; the path tracer takes the same ([path-tracer.md](path-tracer.md#lighting)).

- The edges come from `sceneSharpEdges` of the document ([scene-format.md](scene-format.md#sharp-edges)), at
  upload; a new pose of the same meshes detects nothing again. `batchScene` copies a mesh's vertices through
  `vertexOf` (positions, normals, UVs, UV rectangles and lightmap data alike) and takes its split `indices`; the
  distances and angles go to attribute locations 9 (`a_edgeDistances`) and 10 (`a_edgeAngles`, flat), in the exact
  key's de-indexed copy too. A context restore uploads them again from the retained scene.
- `shading.glsl`: `prepareShading()` runs first in `main`, before any discard (derivatives need uniform control flow,
  as `prepareDepthKey`): each slot's direction toward its edge is minus the in-surface gradient of its distance,
  from `dFdx`/`dFdy` of distance and world position (`v_worldPosition`), and its footprint is the distance one pixel
  spans. `shadingNormal()` replaces the plain normal in the opaque, OIT and fallback passes: the shared
  `roundedNormal` (`edgeRounding` chunk) turns the normal toward each edge as on a circular fillet, sin φ = ramp ·
  sin(θ / 2), so both faces reach the bisector at the edge; the linear ramp is box-filtered over the pixel's
  footprint, so the band does not shimmer when it is narrower than a pixel. Where no slot bends the normal the
  function returns it unchanged, so planes, cards and smooth areas are byte-identical with rounding on and off.
- MSAA shading point (MS-54): the fragment shader runs once per triangle and pixel, by default with its inputs at the
  pixel centre, which for a pixel the triangle only partly covers lies off the face: the normal, the world position
  and the edge distances extrapolate there. `v_normal`, `v_worldPosition` and `v_edgeDistances` are therefore
  `centroid` (vertex `centroid out`, fragment `centroid in` in the opaque, OIT and fallback passes, both depth-key
  variants; a mismatch fails to link), read at a covered sample as the render's rays hit the face. The centroid
  values of neighbouring pixels lie up to 0.75 px off the unit steps `dFdx`/`dFdy` assume. The directions toward the
  edges are unaffected (distance and position are differenced over the same steps); the footprint is not, so
  `prepareShading` projects `v_worldPosition` to the drawing buffer (`u_viewProjection`, `u_viewportSize` from the
  `viewport` chunk) and, where those steps are not unit ones (more than 0.01 px and less than 1 px off, determinant
  above 0.25), maps the distance gradient back to unit steps with the inverse of their matrix. The baked vertex light
  (`v_vertexLight`, `v_vertexLightBack`, which world charts reuse for their lightmap point) is centroid too: at the
  pixel centre it would show the light of a point beyond the face. Shading point: a GPU's centroid is a covered
  sample position, so inside a face, along a quad's diagonal, each triangle would be shaded at a point other than the
  pixel centre and the pixel would change (measured on an RTX 3080, docs/testing.md).
  `prepareShading` therefore steps every centroid input (normal, edge distances, through `atShadingPoint` the baked
  light) back to the pixel centre, `gl_FragCoord` less the sample's projected position mapped to derivative units,
  exact as the inputs are affine over the triangle, unless the pixel reaches over one of the triangle's sharp edges
  (some slot's distance at the centre below half its footprint: a silhouette or a crease), where the centroid sample
  stays. Fully covered pixels are unchanged. `sampleBakedLight` runs after `prepareShading`. Only `v_uv` and `v_uvRect`
  stay at the pixel centre: texel anti-aliasing (`texelSample`), the alpha-to-coverage contour on the texel boundary
  and the hashed-alpha cell are defined on the texel grid there, and `v_uvRect` keeps the texel on its face.
  `v_lightmap` is flat. No varying is added (the exact variant uses 14 of the minimum 15).
  Exact-key frames draw single-sampled, where the centroid is the centre: the player (its outer layer has a render
  order) and every `preset-*` view are not affected (at most 4 pixels by 1 level, rounding in the changed program);
  anti-aliasing their silhouettes is MS-35's.
- Only the normal changes: texels, UVs, alpha and the depth key are untouched. The baked light is computed for the
  unrounded surface (bake width 0) and multiplies the rounded shading as before.
- A width change is a uniform; a sharp-angle change detects again and uploads the geometry again.
- Edge distances and the width are in mesh units, so an animated node scale widens or narrows the band with the node,
  in the path tracer alike.

Credits: AgX by Troy Sobotka. The Rec.709 inset/outset matrices, the log2 range and the contrast polynomial fit in
`looks/src/glsl/agx.glsl` and `looks/src/agxToneMap.ts` follow Benjamin Wrensch, "Minimal AgX Implementation"
(iolite engine blog, 2024, https://iolite-engine.com/blog_posts/minimal_agx_implementation); the same polynomial
ships in three.js `AgXToneMapping` (MIT) and Filament.

## Shaders

GLSL ES 3.00 in `src/shaders/*.glsl`, composed by `linkShader` from static chunks only: the renderer's own
(`texelSample`, `shading`, `hashAlpha`, `bakedLight`, `depthKey` and `depthKeyVertex` in a raster and an exact variant) and the
shared look chunks (`agx`, `texelAlpha`, `faceTexels`, `lightRig`, `shadowCatcher`, `edgeRounding`); the catcher has its own program
(`catcher.vert.glsl`, `catcher.frag.glsl`). `a_lightmap` uses attribute location 8, clear of the exact key's 4-7, and
the edge attributes 9 and 10: 11 attributes and at most 14 varying vectors (exact variant; raster 9), within WebGL2's
guaranteed 16 and 15 (`shaderSources.test.ts` counts them). An
unknown or cyclic
include throws; no shader text is built from user input. A compile or link failure throws `RendererError`
(`SHADER_COMPILE` / `SHADER_LINK`) with the driver's info log.

Node matrices may scale (an animated `SceneNode.scale`, MS-21), so `mesh.vert.glsl` maps normals with
`u_normalMatrix`, the `mat4NormalMatrix` of the draw's node matrix (the inverse transpose up to a positive factor,
normalised by `shadingNormal`), never with the upper 3×3 of `u_model`; the path tracer's `flattenScene` uses the same
helper, so both shade a scaled node alike. One `mat3` uniform more, far below `MAX_VERTEX_UNIFORM_VECTORS`.
`validateScene` rejects a scale that is not finite and positive (`nodes[i].scale[k]`); `animateScene` clamps to
[10⁻⁴, 10⁴]. An animation frame changes only nodes, so it is a pose-only change, which `setScene` applies at once
(no await needed for it to show): the decoded textures, their alpha tables (no readback), the lightmap layout, sharp
edges and the uploaded geometry are kept, `validateScene` checks only the nodes, and each draw's model and normal
matrix (and the bounds of a closed batch) are rewritten from the new world matrices (`poseGpuScene`). Batches live in
node space, so no buffer is touched; a frame costs O(nodes + draws). The call still supersedes a pending `setScene`,
resolves with the warnings of the shown textures, and a lost context restores the newest pose.

The fast path trusts that the `meshes`, `materials` and `textures` arrays are the shown ones (same array objects):
content edited inside them is neither re-validated nor re-uploaded, so pass new arrays for a changed mesh, material
or texture. The first `setScene` of a model must be awaited before playback frames are sent: until it has loaded,
every frame is a full layout and decode that supersedes the previous one, and the model may never appear.

## Limits and warnings

- `setScene` validates the document first (`validateScene`): buffer lengths (3 / 3 / 2 / 4 floats per vertex),
  indices below the vertex count, groups on whole triangles inside the index buffer, material, texture, node and mesh
  indices in range or −1, finite node `pivot`, `rotation`, `translation` and `restRotation` (a NaN would drop the
  node's subtree from the image and the bounds without a word), `renderOrder` an integer in ±1024, `doubleSided` and `cameraOnly` booleans (all optional; material
  `alphaMode` / `alphaCutoff` are not checked, `resolveMaterialAlpha` turns any value into a valid rule). A failure
  rejects with `RendererError` `INVALID_SCENE` naming the path, e.g. `meshes[0].indices[5]`.
- Textures are checked from the PNG header in their bytes (signature and IHDR) before decoding, never from the size
  the document declares: each side at most min(`maxTextureSide`, default 4096, `MAX_TEXTURE_SIZE`), at most
  `maxTexturePixelsTotal` (default 64 Mi) pixels per scene, and the header size must equal the declared size.
  Decoding uses `createImageBitmap` on a `Blob` of the bytes (never a URL, so nothing is fetched); the decoded size is
  checked again.
- A texture that is missing, not a PNG, too large, fails to decode or whose size disagrees becomes a 2 × 2
  grey checker, and `setScene` resolves with a `RendererWarning` (`TEXTURE_MISSING`, `TEXTURE_TOO_LARGE`,
  `TEXTURE_DECODE_FAILED`, `TEXTURE_SIZE_MISMATCH`, with the texture index); the rest of the model draws.
- A later `setScene` or `dispose()` supersedes a pending one: it resolves with `applied: false` and closes the images
  it decoded.
- The lightmap layout over `MAX_LIGHTMAP_TEXELS` at the largest downscale rejects `setScene` with `RendererError`
  `SCENE_TOO_LARGE` before anything is allocated.

## Context loss

On `webglcontextlost` the renderer prevents the default (so the browser may restore it) and `render()` becomes a
no-op. On `webglcontextrestored` it queries the limits again, rebuilds programs, targets, buffers and textures from
the retained scene, decoded images and baked lighting (no re-decode, no re-bake, no reload; the sharp-edge attributes
come from the per-mesh cache), redraws and calls the
`onContextRestored` listeners. `dispose()` deletes every GL object it created (lightmaps and the catcher's quad
included), closes every decoded image and removes its listeners.
