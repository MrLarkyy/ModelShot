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
  defaults and the frame count. `planFrames(doc, checked)`: the frames (pose, camera, time) a clip renders.
- `selectFormat(requested, availability)`, `FORMAT_FALLBACKS`, `FORMAT_NAMES`: the fallback rule, pure.
- The limit constants (`MAX_EXPORT_SIDE` and the others below), `ExportError` and the option, result, progress and
  warning types.

Encoders are loaded with dynamic `import()` when an export needs one, so the entry the app imports holds the
options, planning and render loop only (`bundleSize.test.ts`: gzip of the entry and its static imports, the workspace
packages external, at most 6 970 bytes, measured 5 576).

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
| `MAX_CLIP_FRAMES`                      | 1200        | before rendering (a turntable's `frames`, an animation's `round(seconds × fps)`)                                                      |
| `MAX_CLIP_SECONDS`                     | 60          | before rendering (`frames / fps`, `seconds`, an animation's own length without `seconds`)                                             |
| `MAX_CLIP_RAW_BYTES`                   | 2 GiB       | before rendering: `width × height × 4 × frames`                                                                                       |
| `MAX_OUTPUT_BYTES`                     | 512 MiB     | while encoding, before each piece is kept                                                                                             |

## Frames and framing

A turntable of N frames turns the camera through 360° in N equal yaw steps from the camera's own yaw; the last frame
is one step short of the first, so the clip loops without a repeated frame. With `fit` each frame is
`frameToFit(sceneBounds(doc), { projection, aspect, yawDeg, pitchDeg })` at the camera's pitch and projection: one
distance for every frame (the bounding sphere's, which no turn changes). With `camera` the camera's position orbits
its target around the vertical axis at its own distance. The lights stay in the world, as the look defines them.

An animation renders playback times `i / fps` for `i < max(1, round(seconds × fps))`, each pose computed from the rest
pose by `animateScene` (so frame i is what a seek to that time shows). With `fit` one camera serves every frame: it
frames the union of the bounds of all planned poses at the camera's angles and projection, so the view never jumps
and no pose leaves the frame (framing each pose would move the camera every frame; framing the rest pose crops a
model that walks out of it). With `camera` the camera is used as given. Each pose is a `setScene` of its own: the path
tracer has no pose-only update yet, so a frame pays a scene upload (texture decode, BVH) besides its samples.

Every frame renders with the same seed, so the noise pattern stands still instead of shimmering from frame to frame.
Frames render with a fixed sample count (no noise threshold), so a clip is the same bytes on every run of a browser.

## Formats

| format | encoder                                                                                                        | alpha                           | timing                                 |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------- |
| `png`  | ours: RGBA8, per row None or Paeth filter, zlib by `CompressionStream('deflate')` (stored blocks without it)   | straight, exact                 |                                        |
| `apng` | ours: acTL loops forever, fcTL per frame (whole canvas, no dispose, blend SOURCE), IDAT then fdAT              | straight, exact                 | 1 / fps exactly                        |
| `gif`  | ours: GIF89a, NETSCAPE2.0 loop, a local palette per frame, LZW                                                 | binary: alpha < 128 transparent | centiseconds without drift, at least 2 |
| `webp` | the browser's (OffscreenCanvas `convertToBlob`, quality 1), muxed by us: VP8X, ANIM, ANMF per frame (no blend) | as the browser keeps it         | milliseconds without drift             |
| `webm` | WebCodecs `VideoEncoder` (VP9 at the smallest level that holds the frame, the next one, VP8), muxed by us      | none                            | a key frame every second               |
| `mp4`  | WebCodecs `VideoEncoder` (H.264 High, Main or Constrained Baseline at the smallest level), muxed by us         | none                            | a key frame every second               |

PNG and APNG decode to exactly the bytes of `PathTracer.readImage()` (Vitest with an independent decoder, and in the
browser, docs/testing.md). Nothing is resampled or dithered anywhere: the output is the render's size.

GIF: each frame gets a median-cut palette of at most 255 colours over its opaque pixels; a frame of 255 colours or
fewer (flat pixel art) keeps every colour exactly, else boxes split at the pixel-weighted median along their widest
channel and each pixel takes its box's mean, with no dithering (dither would turn flat texels into noise). The
measured error on a 64 × 64 two-axis gradient (4 096 colours) is at most 14 levels per channel (tests allow 18); a
64 × 64 render of the showcase decodes within 7. Delays: frame i lasts round((i + 1) · 100 / fps) − round(i · 100 / fps)
centiseconds, so 30 fps alternates 3, 4, 3, and never less than 2 (browsers play a shorter delay as 10): above 50 fps a
GIF plays at 50. Every frame is disposed to the transparent background before the next.

Animated WebP: Chromium encodes quality 1 lossless; the canvas the frame goes through premultiplies alpha, so where
alpha is partial a colour can move by a level (1 measured). Durations in milliseconds without drift, as for GIF.

Video is opaque: WebCodecs alpha encoding is not dependable across browsers, so a transparent request for `webm` or
`mp4` renders opaque, over the backdrop, with an `ALPHA_DROPPED` warning. The codec is probed with
`VideoEncoder.isConfigSupported` at the clip's size and rate; bitrate about 0.25 bit per pixel and frame (0.25 Mbit/s
to 40 Mbit/s). Frames must come out in order (no B-frame reordering); else `ENCODER_FAILED`.

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
