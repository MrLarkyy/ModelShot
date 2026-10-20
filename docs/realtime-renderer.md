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

Geometry is batched at upload: the visible triangles of one node with one texture share one vertex and index buffer
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

## Transparency

The class of a pixel comes from its nearest texel (`#include "texelAlpha"` from `@modelshot/looks`, mirrored by
`classifyTexelAlpha`): alpha below 0.5/255 is cut out (discarded in every pass before any depth write), above
254.5/255 opaque, anything else partial (OIT on the float path, hashed alpha on the fallback). Cut-out shapes are
therefore exactly per texel. Shadow, AO and path-tracer rays must use the same chunk.

Faces are drawn double-sided; the back of a face is lit with the flipped normal. Zero-thickness planes and inner
faces seen through cut-outs need this. Every pass draws front faces first (back faces culled), then back faces (front
faces culled) pushed back by `polygonOffset(1, 1)`: of two coincident faces (a zero-thickness element with both faces
textured) the one turned to the camera wins, from either side and on any GPU. Front means counter-clockwise seen from
outside, the winding every loader produces. The path tracer follows the same rule: every triangle is two-sided, and at
equal hit distance the front-facing hit wins.

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
(`texelSample`, `shading`, `hashAlpha`) and the shared look chunks (`agx`, `texelAlpha`). An unknown or cyclic
include throws; no shader text is built from user input. A compile or link failure throws `RendererError`
(`SHADER_COMPILE` / `SHADER_LINK`) with the driver's info log.

## Limits and warnings

- `setScene` validates the document first (`validateScene`): buffer lengths (3 / 3 / 2 / 4 floats per vertex),
  indices below the vertex count, groups on whole triangles inside the index buffer, material, texture, node and mesh
  indices in range or −1. A failure rejects with `RendererError` `INVALID_SCENE` naming the path, e.g.
  `meshes[0].indices[5]`.
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
