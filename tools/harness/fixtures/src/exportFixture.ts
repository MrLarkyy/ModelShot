import {
  ExportError,
  exportClip,
  exportStill,
  type ClipFormat,
  type ExportProgress,
  type ExportResult,
  type FrameRenderer,
} from '@modelshot/export';
import { agxToneMap, backdropColor } from '@modelshot/looks';
import { PathTracer, type RenderedImage, type SetSceneOptions } from '@modelshot/pathtracer';
import {
  cameraProjection,
  cameraView,
  mat4Multiply,
  type SceneAnimationChannel,
  type SceneCamera,
  type SceneDocument,
  type SceneTexture,
} from '@modelshot/scene';
import { readDrawingBufferBase64 } from './context';
import {
  decodeImageFrames,
  decodePngFrames,
  decodeVideoFrames,
  demuxMp4,
  demuxWebm,
  playVideo,
  readImageTiming,
} from './exportDecode';
import type { MsFixture, PtProbe } from './fixtureApi';
import { computePtProbes, sceneProbes } from './ptProbes';
import { hideMeshes, parseRtView, rtCamera, rtLook, rtScene, type RtView } from './rtScenes';

// URL parameters: variant=still-transparent (the alpha-plane scene without its ground and back plane under its fixed
// camera, so camera rays through a cut-out texel leave the scene; transparent, catcher on, exported as PNG),
// turntable-f<0..3> (frame i of a transparent 4-frame turntable of the showcase as APNG, catcher on) or
// animation-f<0..3> (frame i of a transparent 4-frame animation of the showcase bobbing up and down, APNG, catcher on);
// seed (default 1) and samples (default 16). Without a variant the page only sets up `window.__msExport`.
const params = new URLSearchParams(location.search);
const SIZE = 64;
const TURNTABLE_FRAMES = 4;
const FPS = 8;

export interface ExportStillOutcome {
  readonly width: number;
  readonly height: number;
  /** Base64 RGBA, rows top to bottom: the PNG decoded, and `readImage()` of the same render. */
  readonly decoded: string;
  readonly read: string;
  readonly probes: readonly PtProbe[];
  readonly samplesDone: number;
  /** Base64 RGBA, rows top to bottom: the canvas the tracer presented to at the end. */
  readonly canvas: string;
  readonly warnings: readonly string[];
}

/** A still's render request beyond seed and samples. */
export interface ExportStillOptions {
  readonly catcher: boolean;
  readonly transparent: boolean;
  readonly supersample?: number;
  readonly denoise?: boolean;
}

export interface ExportClipOutcome {
  readonly format: string;
  readonly mimeType: string;
  readonly warnings: readonly { code: string; message: string; requested?: string; used?: string }[];
  readonly frames: number;
  /** Base64 RGBA per frame: what the decoder read from the file, and `readImage()` of each rendered frame. */
  readonly decoded: readonly string[];
  readonly read: readonly string[];
  /** Which decoder read the file. */
  readonly decoder: string;
  readonly bytes: number;
  /** `catcherBounds` of every `setScene` the export made (`null` where it passed none). */
  readonly catcherBounds: readonly ({ min: number[]; max: number[] } | null)[];
}

export interface ExportLossOutcome {
  /** `readImage()` after a finished render: before the loss, right after `loseContext` and after the event. */
  readonly before: boolean;
  readonly beforeEvent: boolean;
  readonly afterEvent: boolean;
  /** The code an export rejects with when the context goes at its frame 1. */
  readonly clipCode: string;
}

export interface ExportVideoOutcome {
  readonly format: string;
  /** What a video element made of the file, `null` when it cannot play the type. */
  readonly played: { width: number; height: number; duration: number; frame: string } | null;
  /** `readImage()` of the frame the element was seeked to. */
  readonly read: string;
  readonly type: string;
}

export interface ExportTimingOutcome {
  readonly frames: number;
  /** Microseconds per frame, as the browser's ImageDecoder reads them. */
  readonly durations: readonly number[];
  /** Base64 RGBA per frame from ImageDecoder, and the rendered frames. */
  readonly decoded: readonly string[];
  readonly read: readonly string[];
}

export interface ExportCancelOutcome {
  readonly code: string;
  readonly samplesDone: number;
  readonly running: boolean;
  /** Samples a step draws after the cancel (0: the tracer stopped). */
  readonly stepAfter: number;
}

export interface ExportPairOutcome {
  /** Base64 RGBA: the transparent render composited over the backdrop in display space, and the opaque render. */
  readonly composited: string;
  readonly opaque: string;
  /** Alpha of the transparent render, one byte per pixel. */
  readonly alpha: string;
}

export interface ExportClipOptions {
  readonly format: ClipFormat;
  readonly transparent: boolean;
  /** Formats the page pretends it cannot encode (a stubbed probe). */
  readonly refuse?: readonly ('webp' | 'webm' | 'mp4')[];
  /** `animation`: the showcase bobbing up and down (`bobbingShowcase`), 4 frames over its 1 s at 4 fps. */
  readonly clip?: 'turntable' | 'animation';
}

export interface ExportControls {
  still: (options: ExportStillOptions) => Promise<ExportStillOutcome>;
  clip: (options: ExportClipOptions) => Promise<ExportClipOutcome>;
  cancel: (options: { atFrame: number; atSample: number }) => Promise<ExportCancelOutcome>;
  pair: (options: Omit<ExportStillOptions, 'transparent'>) => Promise<ExportPairOutcome>;
  lose: () => Promise<ExportLossOutcome>;
  video: (format: 'webm' | 'mp4') => Promise<ExportVideoOutcome>;
  apngTiming: () => Promise<ExportTimingOutcome>;
  /** The 4-frame transparent APNG turntable alone (a tracer of its own, no decoding): the bench times it. */
  turntable: () => Promise<number>;
  /**
   * The 4-frame transparent APNG animation of the showcase bobbing alone (a tracer of its own, no decoding): the bench
   * times it. With `fullSetScene` every pose gets a new textures array, so each frame decodes and uploads them again.
   * With `atlasSide` the first texture is a generated noise PNG of that side (made once per side, so call it once
   * before timing): a large atlas, where the textures cost something.
   */
  animation: (options?: { fullSetScene?: boolean; atlasSide?: number }) => Promise<number>;
}

declare global {
  interface Window {
    __msExport?: ExportControls;
  }
}

function intParam(name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,10}$/.test(raw)) throw new Error(`query parameter ${name} must be an integer`);
  return Number(raw);
}

const seed = intParam('seed', 1);
const samples = intParam('samples', 16);

function base64(bytes: Uint8Array | Uint8ClampedArray): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Rows bottom to top, as `readRGBA` of every fixture hands them out (expectGolden flips them back). */
function bottomUp(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(rgba.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  return out;
}

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

function viewOf(variant: string): RtView {
  return parseRtView(new URLSearchParams({ variant }));
}

function tracerFor(view: RtView): PathTracer {
  return PathTracer.create(canvas, { look: rtLook(view), preserveDrawingBuffer: true });
}

/** `tracer` with every `readImage` result and `setScene` option kept, as the export used them. */
function recording(
  tracer: PathTracer,
  frames: RenderedImage[],
  scenes: (SetSceneOptions | undefined)[] = [],
  fullSetScene = false,
): FrameRenderer {
  return {
    get accumulationWidth() {
      return tracer.accumulationWidth;
    },
    get width() {
      return tracer.width;
    },
    get height() {
      return tracer.height;
    },
    get samplesDone() {
      return tracer.samplesDone;
    },
    get contextLost() {
      return tracer.contextLost;
    },
    setScene: (doc, options) => {
      scenes.push(options);
      // A new textures array per call: the tracer decodes, lays out and uploads the textures again, as before MS-58.
      return tracer.setScene(fullSetScene ? { ...doc, textures: [...doc.textures] } : doc, options);
    },
    setCamera: (camera) => tracer.setCamera(camera),
    resize: (size) => tracer.resize(size),
    start: (request) => tracer.start(request),
    step: (max) => tracer.step(max),
    get guiding() {
      return tracer.guiding;
    },
    cancel: () => tracer.cancel(),
    readImage: () => {
      const image = tracer.readImage();
      if (image) frames.push({ ...image, data: new Uint8ClampedArray(image.data) });
      return image;
    },
  };
}

function project(camera: SceneCamera, p: [number, number, number]): [number, number] {
  const m = mat4Multiply(cameraProjection(camera, 1), cameraView(camera));
  const row = (r: number): number =>
    (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0);
  const w = row(3);
  return [((row(0) / w) * 0.5 + 0.5) * SIZE, (0.5 - (row(1) / w) * 0.5) * SIZE];
}

/** The canvas's pixels, rows top to bottom. */
function readCanvas(): Uint8Array {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 context missing');
  const rows = Uint8Array.from(atob(readDrawingBufferBase64(gl, SIZE, SIZE)), (c) => c.charCodeAt(0));
  return bottomUp(rows, SIZE, SIZE);
}

async function still(options: ExportStillOptions): Promise<ExportStillOutcome> {
  const view = viewOf('alpha-plane');
  const doc: SceneDocument = hideMeshes(hideMeshes(rtScene(view.scene), 'ground'), 'back-plane');
  const camera = rtCamera(doc, view, 1);
  const read: RenderedImage[] = [];
  const tracer = tracerFor(view);
  try {
    const result = await exportStill(recording(tracer, read), doc, {
      kind: 'still',
      width: SIZE,
      height: SIZE,
      camera,
      seed,
      samples,
      transparent: options.transparent,
      ...(options.supersample !== undefined ? { supersample: options.supersample } : {}),
      ...(options.denoise !== undefined ? { denoise: options.denoise } : {}),
      scene: { shadowCatcher: options.catcher },
    });
    const [decoded] = decodePngFrames(new Uint8Array(await result.blob.arrayBuffer()));
    const image = read.at(-1);
    if (!decoded || !image) throw new Error('nothing rendered');
    return {
      width: SIZE,
      height: SIZE,
      decoded: base64(decoded),
      read: base64(image.data),
      probes: computePtProbes(doc, sceneProbes(view.scene), (p) => project(camera, p)),
      samplesDone: tracer.samplesDone,
      canvas: base64(readCanvas()),
      warnings: result.warnings.map((w) => w.code),
    };
  } finally {
    tracer.dispose();
  }
}

/** Every frame of an exported file, by the decoder for its format. */
async function decodeFile(result: ExportResult, fps: number): Promise<{ frames: Uint8Array[]; decoder: string }> {
  const file = new Uint8Array(await result.blob.arrayBuffer());
  switch (result.format) {
    case 'png':
    case 'apng':
      return { frames: decodePngFrames(file), decoder: 'formats decodePngRgba' };
    case 'gif':
    case 'webp':
      return { frames: await decodeImageFrames(file, result.mimeType), decoder: 'ImageDecoder' };
    case 'webm': {
      const { codec, samples: s } = demuxWebm(file);
      return {
        frames: await decodeVideoFrames(s, { codec, codedWidth: result.width, codedHeight: result.height }),
        decoder: `VideoDecoder ${codec}`,
      };
    }
    case 'mp4': {
      const { codec, description, samples: s } = demuxMp4(file, fps);
      return {
        frames: await decodeVideoFrames(s, {
          codec,
          codedWidth: result.width,
          codedHeight: result.height,
          description,
        }),
        decoder: `VideoDecoder ${codec}`,
      };
    }
  }
}

/** Makes the probe of `refuse` report no encoder, until the returned function restores the browser's. */
function refuseFormats(refuse: readonly string[]): () => void {
  const restore: (() => void)[] = [];
  if (refuse.includes('webm') || refuse.includes('mp4')) {
    const original = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = (config) => {
      const refused =
        (refuse.includes('mp4') && config.codec.startsWith('avc1')) ||
        (refuse.includes('webm') && /^(vp09|vp8)/.test(config.codec));
      return refused ? Promise.resolve({ supported: false, config }) : original(config);
    };
    restore.push(() => {
      VideoEncoder.isConfigSupported = original;
    });
  }
  if (refuse.includes('webp')) {
    const original = Reflect.get(OffscreenCanvas.prototype, 'convertToBlob');
    OffscreenCanvas.prototype.convertToBlob = function (this: OffscreenCanvas, options?: ImageEncodeOptions) {
      return original.call(this, { ...options, type: 'image/png' });
    };
    restore.push(() => {
      OffscreenCanvas.prototype.convertToBlob = original;
    });
  }
  return () => restore.forEach((r) => r());
}

const TURNTABLE_VIEW = 'turntable-y030';

/**
 * The showcase with an animation of its own: every root node rises 3 units and comes back down over 1 s, a vertical
 * bob, so a catcher that rode with the pose would rise with it.
 */
function bobbingShowcase(atlas?: SceneTexture): SceneDocument {
  const showcase = rtScene(viewOf(TURNTABLE_VIEW).scene);
  const doc = atlas ? { ...showcase, textures: showcase.textures.map((t, i) => (i === 0 ? atlas : t)) } : showcase;
  const channels = doc.rootNodes.map((node): SceneAnimationChannel => ({
    node,
    property: 'translation',
    keyframes: [
      { time: 0, value: [0, 0, 0], interpolation: 'linear' },
      { time: 0.5, value: [0, 3, 0], interpolation: 'linear' },
      { time: 1, value: [0, 0, 0], interpolation: 'linear' },
    ],
  }));
  return { ...doc, animations: [{ name: 'bob', loop: 'loop', length: 1, channels }] };
}

/** Exports the 4-frame clip of `options` and reads the file back with the decoder for its format. */
async function exportedClip(
  options: ExportClipOptions,
  tracer: PathTracer,
  fullSetScene = false,
  atlas?: SceneTexture,
): Promise<{ result: ExportResult; read: RenderedImage[]; scenes: (SetSceneOptions | undefined)[] }> {
  const view = viewOf(TURNTABLE_VIEW);
  const animated = options.clip === 'animation';
  const doc = animated ? bobbingShowcase(atlas) : rtScene(view.scene);
  const read: RenderedImage[] = [];
  const scenes: (SetSceneOptions | undefined)[] = [];
  const base = {
    format: options.format,
    width: SIZE,
    height: SIZE,
    camera: rtCamera(doc, view, 1),
    seed,
    samples,
    transparent: options.transparent,
  };
  const result = await exportClip(
    recording(tracer, read, scenes, fullSetScene),
    doc,
    animated
      ? { ...base, kind: 'animation', animation: 'bob', fps: 4 }
      : { ...base, kind: 'turntable', fps: FPS, frames: TURNTABLE_FRAMES },
  );
  return { result, read, scenes };
}

async function clip(options: ExportClipOptions): Promise<ExportClipOutcome> {
  const tracer = tracerFor(viewOf(TURNTABLE_VIEW));
  const restore = refuseFormats(options.refuse ?? []);
  try {
    const { result, read, scenes } = await exportedClip(options, tracer);
    const { frames, decoder } = await decodeFile(result, FPS);
    return {
      format: result.format,
      mimeType: result.mimeType,
      warnings: result.warnings.map((w) => ({ ...w })),
      frames: result.frames,
      decoded: frames.map(base64),
      read: read.map((image) => base64(image.data)),
      decoder,
      bytes: result.blob.size,
      catcherBounds: scenes.map((o) =>
        o?.catcherBounds ? { min: [...o.catcherBounds.min], max: [...o.catcherBounds.max] } : null,
      ),
    };
  } finally {
    restore();
    tracer.dispose();
  }
}

async function cancel(options: { atFrame: number; atSample: number }): Promise<ExportCancelOutcome> {
  const view = viewOf(TURNTABLE_VIEW);
  const doc = rtScene(view.scene);
  const tracer = tracerFor(view);
  const controller = new AbortController();
  try {
    await exportClip(
      tracer,
      doc,
      {
        kind: 'turntable',
        format: 'apng',
        width: SIZE,
        height: SIZE,
        camera: rtCamera(doc, view, 1),
        seed,
        samples,
        fps: FPS,
        frames: TURNTABLE_FRAMES,
      },
      {
        signal: controller.signal,
        onProgress: (p: ExportProgress) => {
          if (p.phase === 'render' && p.frame === options.atFrame && p.samplesDone === options.atSample) {
            controller.abort();
          }
        },
      },
    );
    return { code: 'resolved', samplesDone: tracer.samplesDone, running: tracer.running, stepAfter: 0 };
  } catch (error) {
    const code = error instanceof ExportError ? error.code : String(error);
    const samplesDone = tracer.samplesDone;
    const running = tracer.running;
    return { code, samplesDone, running, stepAfter: tracer.step(samples) };
  } finally {
    tracer.dispose();
  }
}

/** The display colour (0..255) of the look's backdrop in image row y (top 0), as the canvas shows it. */
function backdropRow(view: RtView, y: number): number[] {
  const look = rtLook(view);
  return agxToneMap(backdropColor(look, (SIZE - y - 0.5) / SIZE), look.toneMapping).map((v) => v * 255);
}

async function pair(options: Omit<ExportStillOptions, 'transparent'>): Promise<ExportPairOutcome> {
  const transparent = await still({ ...options, transparent: true });
  const opaque = await still({ ...options, transparent: false });
  const fg = Uint8Array.from(atob(transparent.decoded), (c) => c.charCodeAt(0));
  const view = viewOf('alpha-plane');
  const composited = new Uint8Array(fg.length);
  const alpha = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const backdrop = backdropRow(view, y);
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const a = (fg[i + 3] ?? 0) / 255;
      alpha[y * SIZE + x] = fg[i + 3] ?? 0;
      for (let c = 0; c < 3; c++) composited[i + c] = Math.round((fg[i + c] ?? 0) * a + (backdrop[c] ?? 0) * (1 - a));
      composited[i + 3] = 255;
    }
  }
  return { composited: base64(composited), opaque: opaque.decoded, alpha: base64(alpha) };
}

/** A finished render loses its context; then an export loses it at frame 1. */
async function lose(): Promise<ExportLossOutcome> {
  const view = viewOf(TURNTABLE_VIEW);
  const doc = rtScene(view.scene);
  const tracer = tracerFor(view);
  const gl = canvas.getContext('webgl2');
  const extension = gl?.getExtension('WEBGL_lose_context');
  if (!extension) throw new Error('WEBGL_lose_context is not available');
  const options = {
    kind: 'turntable',
    format: 'apng',
    width: SIZE,
    height: SIZE,
    camera: rtCamera(doc, view, 1),
    seed,
    samples,
    fps: FPS,
    frames: TURNTABLE_FRAMES,
  } as const;
  const event = (type: string) =>
    new Promise<void>((resolve) => canvas.addEventListener(type, () => setTimeout(resolve, 0), { once: true }));
  try {
    await exportStill(tracer, doc, { ...options, kind: 'still', format: 'png' });
    const before = tracer.readImage() !== null;
    const lost = event('webglcontextlost');
    extension.loseContext();
    const beforeEvent = tracer.readImage() === null;
    await lost;
    const afterEvent = tracer.readImage() === null;
    const restored = new Promise<void>((resolve) => {
      const stop = tracer.onContextRestored(() => {
        stop();
        resolve();
      });
    });
    extension.restoreContext();
    await restored;
    let clipCode = 'resolved';
    try {
      await exportClip(tracer, doc, options, {
        onProgress: (p) => {
          if (p.phase === 'render' && p.frame === 1 && p.samplesDone === 2) extension.loseContext();
        },
      });
    } catch (error) {
      clipCode = error instanceof ExportError ? error.code : String(error);
    }
    return { before, beforeEvent, afterEvent, clipCode };
  } finally {
    tracer.dispose();
  }
}

/** A WebM or MP4 turntable played by a video element, seeked into frame 2. */
async function video(format: 'webm' | 'mp4'): Promise<ExportVideoOutcome> {
  const tracer = tracerFor(viewOf(TURNTABLE_VIEW));
  try {
    const { result, read } = await exportedClip({ format, transparent: false }, tracer);
    const file = new Uint8Array(await result.blob.arrayBuffer());
    const codec = result.format === 'mp4' ? demuxMp4(file, FPS).codec : demuxWebm(file).codec;
    const type = `${result.mimeType}; codecs="${codec}"`;
    const played = await playVideo(file, type, 2.5 / FPS);
    return {
      format: result.format,
      type,
      played: played && { ...played, frame: base64(played.rgba) },
      read: base64(read[2]?.data ?? new Uint8Array(0)),
    };
  } finally {
    tracer.dispose();
  }
}

/** The APNG turntable as the browser's ImageDecoder reads it: frames, their durations and pixels. */
async function apngTiming(): Promise<ExportTimingOutcome> {
  const tracer = tracerFor(viewOf(TURNTABLE_VIEW));
  try {
    const { result, read } = await exportedClip({ format: 'apng', transparent: true }, tracer);
    const file = new Uint8Array(await result.blob.arrayBuffer());
    const timing = await readImageTiming(file, 'image/apng');
    const decoded = await decodeImageFrames(file, 'image/apng');
    return { ...timing, decoded: decoded.map(base64), read: read.map((image) => base64(image.data)) };
  } finally {
    tracer.dispose();
  }
}

async function turntable(): Promise<number> {
  const tracer = tracerFor(viewOf(TURNTABLE_VIEW));
  try {
    return (await exportedClip({ format: 'apng', transparent: true }, tracer)).result.frames;
  } finally {
    tracer.dispose();
  }
}

const noiseAtlases = new Map<number, Promise<SceneTexture>>();

/** The showcase's first texture with `side` x `side` pixels of seeded noise (a PNG that is slow to decode). */
function noiseAtlas(side: number): Promise<SceneTexture> {
  const known = noiseAtlases.get(side);
  if (known) return known;
  const made = (async (): Promise<SceneTexture> => {
    const first = rtScene(viewOf(TURNTABLE_VIEW).scene).textures[0];
    if (!first) throw new Error('the showcase has no texture');
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    const pixels = context.createImageData(side, side);
    let state = 12345;
    for (let i = 0; i < pixels.data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = i % 4 === 3 ? 255 : state >>> 24;
    }
    context.putImageData(pixels, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return { ...first, bytes, width: side, height: side };
  })();
  noiseAtlases.set(side, made);
  return made;
}

async function animation(options: { fullSetScene?: boolean; atlasSide?: number } = {}): Promise<number> {
  const tracer = tracerFor(viewOf(TURNTABLE_VIEW));
  try {
    const clipOptions: ExportClipOptions = { format: 'apng', transparent: true, clip: 'animation' };
    const atlas = options.atlasSide === undefined ? undefined : await noiseAtlas(options.atlasSide);
    return (await exportedClip(clipOptions, tracer, options.fullSetScene === true, atlas)).result.frames;
  } finally {
    tracer.dispose();
  }
}

window.__msExport = { still, clip, cancel, pair, lose, video, apngTiming, turntable, animation };

const api: MsFixture = {
  ready: Promise.resolve(),
  renderer: '',
  floatRenderTargets: false,
  width: SIZE,
  height: SIZE,
  samplesDone: 0,
  readRGBA: () => {
    throw new Error('no variant rendered');
  },
};
window.__msFixture = api;

async function start(): Promise<void> {
  // The renderer string and float support, from a context of its own (the tracers' canvas keeps their attributes).
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) throw new Error('WebGL2 context missing');
  const info = probe.getExtension('WEBGL_debug_renderer_info');
  api.renderer = String(probe.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : probe.RENDERER));
  api.floatRenderTargets = probe.getExtension('EXT_color_buffer_float') !== null;
  const variant = params.get('variant');
  if (variant === null) return;
  let rgba: Uint8Array;
  if (variant === 'still-transparent') {
    const outcome = await still({ catcher: true, transparent: true });
    api.samplesDone = outcome.samplesDone;
    rgba = Uint8Array.from(atob(outcome.decoded), (c) => c.charCodeAt(0));
  } else {
    const match = /^(turntable|animation)-f([0-3])$/.exec(variant);
    if (!match) throw new Error(`unknown variant "${variant}"`);
    const kind = match[1] === 'animation' ? 'animation' : 'turntable';
    const outcome = await clip({ format: 'apng', transparent: true, clip: kind });
    api.samplesDone = samples;
    rgba = Uint8Array.from(atob(outcome.decoded[Number(match[2])] ?? ''), (c) => c.charCodeAt(0));
  }
  const flipped = bottomUp(rgba, SIZE, SIZE);
  api.readRGBA = () => base64(flipped);
}

api.ready = start();
api.ready.catch(() => undefined);
