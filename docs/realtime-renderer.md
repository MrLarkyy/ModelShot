# Realtime renderer

`@modelshot/renderer-rt` draws a `SceneDocument` with WebGL2: crisp pixel art, per-texel transparency and the AgX
view transform. It draws only when `render()` is called; `needsRender` tells the caller's animation loop whether a
scene, camera or size change is waiting.

```ts
const renderer = RealtimeRenderer.create(canvas, { background: [0.14, 0.15, 0.17] });
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

1. Opaque pass into an RGBA16F + DEPTH24 target with MSAA (min(4, the largest sample count the GPU offers for
   RGBA16F); 0 samples draws single-sampled), resolved by a blit of colour and depth.
2. Weighted blended order-independent transparency (McGuire and Bavoil 2013, weight of equation 10) for partial
   texels: an RGBA16F target (rgb: weighted premultiplied colour, a: product of 1 − alpha) and an R16F target (sum of
   weighted alpha), depth-tested against the resolved depth with depth writes off. Only batches whose texture has
   partial alpha are drawn here (one readback per texture at load decides it).
3. Composite of the transparency average over the opaque image.
4. Present: AgX and the display encoding into the canvas.

No-float path (`capabilities.path === 'fallback'`): one pass into the canvas with AgX in the fragment shader, partial
texels as hashed (screen-door) alpha from an integer hash of texel and pixel. Both paths are order-independent and
deterministic (no clock, no random source). The renderer also switches to this path for good when the driver
rejects the float targets at a new drawing size; `capabilities` then reports `path: 'fallback'` and 0 samples.

Geometry is batched at upload: the visible triangles of one node with one texture, alpha rule, sidedness and render
order share one vertex and index buffer
(`batchScene`). Every vertex keeps its own UV rectangle, so batching changes nothing per texel; a model with one mesh
per element (thousands for a large Blockbench model) draws in a few calls per pass.

## Pixel art

- Textures are uploaded as `SRGB8_ALPHA8` with `NEAREST` filtering and no mipmaps (mipmaps would average across
  atlas regions), without flipping or premultiplying; texel (0, 0) is the top-left pixel.
- Texel anti-aliasing: four `texelFetch` taps (linear colour) blended only within one screen pixel of a texel seam
  (offset `clamp((p − seam) / fwidth(p), −0.5, 0.5)`), with premultiplied weights so a cut-out neighbour adds no dark
  fringe. Every tap is clamped to the face's texel rectangle from `SceneMesh.uvRects`, so no texel of a neighbouring
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
- **Sides**: single-sided groups are drawn with back faces culled in every pass. Double-sided groups are drawn twice
  per render order: front faces, then back faces (front faces culled), the back lit with the flipped normal.
- **Render order**: draws are sorted by render order, descending; per order the front pass, then the back pass of
  double-sided items. The scene format's key is realised in one of two depth-key variants, picked per frame by
  `depthKeyMode` (both linked at start-up; `RealtimeRenderer.depthKeyMode` reports the last frame's):
  - `raster`, used only where every visible mesh has render order 0: the depth buffer compares the projected depth;
    early depth testing and per-sample MSAA depth stay. The back pass gets `polygonOffset(4, 4)`, a slope-scaled push
    that keeps a back side behind the front face it meets at a silhouette or coincides with (the −1/16 order step is
    far below the rasteriser's depth interpolation error; with (1, 1) back sides leak at MSAA samples next to a
    silhouette, see the closed-cube test). Deviation of this variant: a back side that really lies in front of a front
    face by less than about four pixels' worth of its own depth slope (e.g. about 0.3–0.5 units for a face at 45° in the
    turntable framing) is drawn behind it; and next to the silhouette of a face within a few degrees of edge-on, MSAA
    samples of a hidden back side can still show (closed cube at 1°: 74 pixels; a step at 5°: 23; none without MSAA).
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

Lighting v0 is a constant sky/ground hemisphere fill plus one directional key (`shaders/shading.glsl`); light rigs
become look data later. The HDR result goes through AgX (`#include "agx"` from `@modelshot/looks`, mirrored by
`agxToneMap` for tests), whose output is already display-encoded and is written as is. The backdrop colour (option
`background`, scene-linear) goes through the same transform on both paths.

Credits: AgX by Troy Sobotka. The Rec.709 inset/outset matrices, the log2 range and the contrast polynomial fit in
`looks/src/glsl/agx.glsl` and `looks/src/agxToneMap.ts` follow Benjamin Wrensch, "Minimal AgX Implementation"
(iolite engine blog, 2024, https://iolite-engine.com/blog_posts/minimal_agx_implementation); the same polynomial
ships in three.js `AgXToneMapping` (MIT) and Filament.

## Shaders

GLSL ES 3.00 in `src/shaders/*.glsl`, composed by `linkShader` from static chunks only: the renderer's own
(`texelSample`, `shading`, `hashAlpha`, `depthKey` and `depthKeyVertex` in a raster and an exact variant) and the shared look chunks
(`agx`, `texelAlpha`). An unknown or cyclic
include throws; no shader text is built from user input. A compile or link failure throws `RendererError`
(`SHADER_COMPILE` / `SHADER_LINK`) with the driver's info log.

## Limits and warnings

- `setScene` validates the document first (`validateScene`): buffer lengths (3 / 3 / 2 / 4 floats per vertex),
  indices below the vertex count, groups on whole triangles inside the index buffer, material, texture, node and mesh
  indices in range or −1, `renderOrder` an integer in ±1024 and `doubleSided` a boolean (both optional; material
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

## Context loss

On `webglcontextlost` the renderer prevents the default (so the browser may restore it) and `render()` becomes a
no-op. On `webglcontextrestored` it queries the limits again, rebuilds programs, targets, buffers and textures from
the retained scene and decoded images (no re-decode, no reload), redraws and calls the `onContextRestored`
listeners. `dispose()` deletes every GL object it created, closes every decoded image and removes its listeners.
