# Export

`@modelshot/export` turns path-traced renders into files in the browser: a still PNG (opaque or with alpha), and
turntables and animations as APNG, GIF, animated WebP, WebM or MP4. It drives a `PathTracer`
([path-tracer.md](path-tracer.md)), encodes frame by frame, checks every option against limits before a sample is
drawn, reports progress, cancels, and falls back to another format with a message when the browser cannot encode the
one asked for. Everything runs in the page: nothing is uploaded, no encoder is fetched (the package has no npm
dependencies; WebP and video use the browser's own encoders), and the resulting `Blob` belongs to the caller, who
offers the download or a share.

```ts
const tracer = PathTracer.create(document.createElement('canvas')); // a tracer of its own, need not be shown
const still = await exportStill(tracer, doc, {
  kind: 'still',
  width: 1024,
  height: 1024,
  camera,
  samples: 256,
  seed: 1,
  transparent: true,
});
const clip = await exportClip(
  tracer,
  doc,
  { kind: 'turntable', format: 'mp4', width: 512, height: 512, camera, samples: 64, seed: 1, fps: 30, frames: 90 },
  { signal: controller.signal, onProgress: (p) => (bar.value = p.fraction) },
);
for (const warning of clip.warnings) console.info(warning.message);
// clip.blob, clip.mimeType, clip.extension ('mp4', or 'webm' / 'png' after a fallback)
```

## API

- `exportStill(renderer, doc, options, { signal, onProgress })`: one render of `doc`, encoded as PNG. Resolves
  `ExportResult` `{ blob, format, mimeType, extension, width, height, frames, warnings }`.
- `exportClip(renderer, doc, options, { signal, onProgress })`: a turntable (`kind: 'turntable'`) or an animation
  (`kind: 'animation'`) in `options.format`, or the format it fell back to (`result.format`).
- `renderer` is a `FrameRenderer`: `PathTracer` has its shape. The export resizes it to the output size (device pixel
  ratio 1), replaces its scene, camera and request, and leaves them so; give it a tracer of its own. Its look and edges
  are the caller's (`setLook`, `setEdges` before the export).
- `checkExportOptions(doc, options)`: the checks the exports run first (below), returning the options with their
  defaults and the frame count. `planFrames(doc, checked, signal?)`: resolves `{ frames, catcherBounds }`, each frame
  its camera and playback time; `framePose(doc, checked, time)`: an animation frame's pose.
- `selectFormat(requested, availability)`, `FORMAT_FALLBACKS`, `FORMAT_NAMES`: the fallback rule, pure.
- The limit constants (`MAX_EXPORT_SIDE` and the others below), `ExportError` and the option, result, progress and
  warning types. Warnings: `FORMAT_FALLBACK` and `ALPHA_DROPPED` (Formats, below) and `SUPERSAMPLE_LOWERED`: the path
  tracer traces a `supersample` only where the traced image fits the GPU and `MAX_SUPERSAMPLED_PIXELS` (2^22 pixels:
  a 1024 × 1024 export traces at 2, a 4096 × 4096 one at 1), lowering it otherwise, and the export says so, naming
  the scale used.

Encoders are loaded with dynamic `import()` when an export needs one, so the entry the app imports holds the
options, planning and render loop only (`bundleSize.test.ts` checks that no encoder is in them). Their gzip size is
the budget `bundleGzipBytes.export` in `budgets.json` (8 041 B, 6 433 measured), the time of a whole 64 x 64, 4-frame
export `frameTimeMs.export-turntable-64-f4-n16` (9 000 ms, 867 measured; docs/testing.md, Budgets).

## Options

Every export (`RenderSettings`):

| field             | values                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `width`, `height` | integers 1..`MAX_EXPORT_SIDE` (4096), `width × height` at most `MAX_EXPORT_PIXELS` (4096²); even for `webm` and `mp4` |
| `camera`          | a `SceneCamera` the path tracer accepts (finite vectors, a usable projection, `0 < near < far`)                       |
| `samples`         | integer 1..65 536                                                                                                     |
| `seed`            | integer 0..2^32 − 1; every frame of a clip renders with it                                                            |
| `supersample`     | integer 1..4, default 1                                                                                               |
| `denoise`         | boolean, default `false`                                                                                              |
| `transparent`     | boolean, default `false`                                                                                              |
| `scene`           | `SetSceneOptions` for `setScene`: `shadowCatcher` boolean, `emission` at most one entry per material                  |

A still: `kind: 'still'`, `format: 'png'` (the default, the only one). A clip: `format` one of `apng`, `gif`, `webp`,
`webm`, `mp4`; `fps` an integer 1..`MAX_CLIP_FPS` (60); `framing` `fit` (default) or `camera` (Framing, below); then
for a turntable `frames`, an integer 2..`MAX_CLIP_FRAMES` (1200), and for an animation `animation` (an index into
`doc.animations` or the name of one), `seconds` (in (0, `MAX_CLIP_SECONDS`], default the animation's length) and
`loop` (`once`, `hold` or `loop`, default the animation's).

The options are untrusted (they may come from a URL or a saved file): `checkExportOptions` checks each field for type,
integer, finiteness, range and enum and throws `ExportError` `INVALID_OPTION` naming it (`width`, `camera.position[1]`,
`scene.emission[0][2]`, ...), before the renderer is touched. A resource over its limit throws `LIMIT_EXCEEDED` naming
the field:

| limit                                  | value       | checked                                                                                                                               |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_EXPORT_SIDE`, `MAX_EXPORT_PIXELS` | 4096, 4096² | before rendering; a GPU that renders less (its target limits, the tracer's `maxPixels`) is `LIMIT_EXCEEDED` on `width` after `resize` |
| `MAX_CLIP_FRAMES`                      | 1200        | before rendering (a turntable's `frames`, an animation's frame count, Frames and framing)                                             |
| `MAX_CLIP_SECONDS`                     | 60          | before rendering (`frames / fps`, `seconds`, an animation's own length without `seconds`)                                             |
| `MAX_CLIP_RAW_BYTES`                   | 2 GiB       | before rendering: `width × height × 4 × frames`                                                                                       |
| `MAX_OUTPUT_BYTES`                     | 512 MiB     | while encoding, before each piece is kept                                                                                             |

## Frames and framing

A turntable of N frames turns the camera through 360° in N equal yaw steps from the camera's own yaw; the last frame
is one step short of the first, so the clip loops without a repeated frame. With `fit` each frame is
`frameToFit(sceneBounds(doc), { projection, aspect, yawDeg, pitchDeg })` at the camera's pitch and projection: one
distance for every frame (the bounding sphere's, which no turn changes). With `camera` the camera's position orbits
its target around the vertical axis at its own distance. The lights stay in the world, as the look defines them.

An animation renders playback times `i / fps` as `animationFrameTimes` of the scene format counts them
([scene-format.md](scene-format.md)) for `seconds`: a `loop` clip has `max(1, round(seconds × fps))` frames (the frame
equal to frame 0 left out, so it loops seamlessly), `hold` and `once` `floor(seconds × fps) + 1` (ending on the frame
at `seconds`). Each pose is computed from the rest pose by `animateScene`, so frame i is what a seek to that time
shows. Before rendering, one pass over the poses measures them (each pose is built, measured and dropped; the pass
yields to the event loop between poses and stops on abort, so no clip keeps a document per frame): the union of their
bounds is where the shadow catcher stays for every frame (`SetSceneOptions.catcherBounds`), at the lowest point any
pose reaches, so a model that jumps leaves its floor as it does in the preview's playback, instead of the floor riding
with it. With `fit` one camera serves every frame: it frames the same union at the camera's angles and projection, so
the view never jumps and no pose leaves the frame (framing each pose would move the camera every frame; framing the
rest pose crops a model that walks out of it). With `camera` the camera is used as given. Each pose is built again
right before its `setScene`, sharing the textures and materials arrays of the document: the path tracer keeps its
decoded images, its texture layers and its material table (`setScene` compares the `textures` array, and `materials`
with `emission`, by object), so a frame pays only the pose's nodes posted to the geometry worker, which holds the
meshes since the first frame, its flatten and BVH build there, and the upload of that geometry, besides its samples.

Every frame renders with the same seed, so the noise pattern stands still instead of shimmering from frame to frame.
Frames render with a fixed sample count (no noise threshold), so a clip is the same bytes on every run of a browser.

## Formats

| format | encoder                                                                                                        | alpha                           | timing                                 |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- |
| `png`  | ours: RGBA8, per row None or Paeth filter, zlib by `CompressionStream('deflate')` (stored blocks without it)   | straight, exact                 |                                        |
| `apng` | ours: acTL loops forever, fcTL per frame (whole canvas, no dispose, blend SOURCE), IDAT then fdAT              | straight, exact                 | 1 / fps exactly                        |
| `gif`  | ours: GIF89a, NETSCAPE2.0 loop, a local palette per frame, LZW                                                 | binary: alpha < 128 transparent | centiseconds without drift, at least 2 |
| `webp` | the browser's (OffscreenCanvas `convertToBlob`, quality 1), muxed by us: VP8X, ANIM, ANMF per frame (no blend) | as the browser keeps it         | milliseconds without drift             |
| `webm` | WebCodecs `VideoEncoder` (VP9 at the smallest level for size and rate, the next one, VP8), muxed by us         | none                            | a key frame every second               |
| `mp4`  | WebCodecs `VideoEncoder` (H.264 High, Main or Constrained Baseline at the smallest level for size and rate)    | none                            | a key frame every second               |

PNG and APNG decode to exactly the bytes of `PathTracer.readImage()` (Vitest with an independent decoder, and in the
browser, docs/testing.md). Nothing is resampled or dithered anywhere: the output is the render's size.

GIF: each frame gets a palette of at most 255 colours over its opaque pixels; a frame of 255 colours or fewer (flat
pixel art) keeps every colour exactly, else median cut over a histogram of 5-bit bins per channel: boxes of bins
split at the pixel-weighted median along their widest channel and each pixel takes the mean of the pixels in its box,
with no dithering (dither would turn flat texels into noise). The cost is one pass over the pixels plus cuts over
32 768 bins, and LZW looks codes up in a typed table: a 4096 × 4096 frame of distinct colours takes about 0.4 s
(the test allows 3 s), and the encoder yields to the page between the palette and the compression. The measured
error on a 64 × 64 two-axis gradient (4 096 colours) is at most 14 levels per channel (tests allow 18); a 64 × 64
render of the showcase decodes within 10. GIF has no partial alpha: a pixel of alpha under 128 is transparent, at or
over it opaque. A transparent clip's soft catcher shadow (black, alpha 1 − shade) therefore turns solid black where
1 − shade ≥ 128/255 and disappears elsewhere; use APNG or WebP to keep it soft. Delays: frame i lasts round((i + 1) · 100 / fps) − round(i · 100 / fps)
centiseconds, so 30 fps alternates 3, 4, 3, and never less than 2 (browsers play a shorter delay as 10): above 50 fps a
GIF plays at 50. Every frame is disposed to the transparent background before the next.

Animated WebP: Chromium encodes quality 1 lossless; the canvas the frame goes through premultiplies alpha, so where
alpha is partial a colour can move by a level (1 measured). Durations in milliseconds without drift, as for GIF.

Video is opaque: WebCodecs alpha encoding is not dependable across browsers, so a transparent request for `webm` or
`mp4` renders opaque, over the backdrop, with an `ALPHA_DROPPED` warning. Video is lossy too: 4:2:0 chroma and the
codec's blocks move colours at texel edges by tens of levels (60 to 80 measured at 64 × 64, a mean of 2 to 4); APNG
and WebP keep pixel art exact. The level is the smallest whose picture size and rate hold the clip (H.264 MaxFS and
MaxMBPS, VP9 picture size, luma sample rate and longest side: 1280 × 720 at 60 fps is H.264 3.2 and VP9 4.0,
1920 × 1080 at 60 fps H.264 4.2 and VP9 4.1, 2048 × 16 VP9 3.0 for its width), probed with `VideoEncoder.isConfigSupported` at the clip's size and rate; bitrate about
0.25 bit per pixel and frame (0.25 Mbit/s to 40 Mbit/s). Frames must come out in order (no B-frame reordering); else
`ENCODER_FAILED`.

### Fallback

Before rendering, the exports probe the requested format's chain and take the first available format:

| requested     | chain                       |
| ------------- | --------------------------- |
| `mp4`         | `mp4` → `webm` → `apng`     |
| `webm`        | `webm` → `apng`             |
| `webp`        | `webp` → `apng`             |
| `apng`, `gif` | always available (our code) |

A fallback comes with a `FORMAT_FALLBACK` warning `{ requested, used, message }`, the message an English sentence
naming both and why ("MP4 cannot be exported here (this browser cannot encode H.264 video at 512 × 512), so the clip
was exported as WebM instead."). No format of the chain: `UNSUPPORTED_FORMAT`.

## Progress, cancel and errors

`onProgress` gets `{ phase, frame, frames, samplesDone, samples, fraction }` after every sample (`render`) and after
each frame is encoded (`encode`); `fraction` only grows and reaches 1 once, when the file is done. The render loop
draws one sample per `step` and yields to the event loop between steps (a message, not a timer, which nested would be
clamped to 4 ms), so the page stays responsive. Aborting `signal` rejects with `ExportError` `CANCELLED`: the path
tracer is cancelled before its next step, the encoder closed and nothing kept.

`ExportError` codes: `INVALID_OPTION`, `LIMIT_EXCEEDED` (both with `field`), `CANCELLED`, `CONTEXT_LOST` (the WebGL
context went during the export, or went and came back, which restarts the request: a blank or partial frame is never
encoded), `ENCODER_FAILED` (the browser's encoder failed or produced something unusable), `UNSUPPORTED_FORMAT`.
`PathTracerError` of `setScene` (an invalid or too large scene) passes through unchanged.
