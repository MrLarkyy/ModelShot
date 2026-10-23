import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportClip } from '../src/exportClip';
import { blobBytes, CAMERA, cubeScene, FakeRenderer } from './support';

/** What the stub encoder saw. */
const seen: { configs: VideoEncoderConfig[]; keyFrames: boolean[]; formats: string[] } = {
  configs: [],
  keyFrames: [],
  formats: [],
};

class StubVideoFrame {
  constructor(
    readonly data: Uint8Array,
    readonly init: { format: string; timestamp: number },
  ) {
    seen.formats.push(init.format);
  }

  get timestamp(): number {
    return this.init.timestamp;
  }

  close(): void {}
}

/** A WebCodecs VideoEncoder that accepts the codecs in `supported` and emits a 4-byte chunk per frame at once. */
function stubEncoder(supported: (codec: string) => boolean, failAt = -1) {
  return class StubVideoEncoder {
    state = 'unconfigured';
    encodeQueueSize = 0;
    private count = 0;

    static isConfigSupported(config: VideoEncoderConfig): Promise<{ supported: boolean }> {
      return Promise.resolve({ supported: supported(config.codec) });
    }

    constructor(
      private readonly init: {
        output: (chunk: unknown, metadata?: unknown) => void;
        error: (error: Error) => void;
      },
    ) {}

    configure(config: VideoEncoderConfig): void {
      seen.configs.push(config);
      this.state = 'configured';
    }

    encode(frame: StubVideoFrame, options: { keyFrame: boolean }): void {
      seen.keyFrames.push(options.keyFrame);
      if (this.count++ === failAt) {
        this.state = 'closed';
        this.init.error(new Error('hardware encoder gone'));
        return;
      }
      const bytes = new Uint8Array([1, 2, 3, this.count]);
      this.init.output(
        {
          byteLength: 4,
          timestamp: frame.timestamp,
          type: options.keyFrame ? 'key' : 'delta',
          copyTo: (target: Uint8Array) => target.set(bytes),
        },
        this.count === 1 ? { decoderConfig: { description: new Uint8Array([1, 0x64, 0, 0x1f]) } } : undefined,
      );
    }

    flush(): Promise<void> {
      return Promise.resolve();
    }

    close(): void {
      this.state = 'closed';
    }
  };
}

const doc = cubeScene();
const CLIP = {
  kind: 'turntable',
  width: 16,
  height: 12,
  camera: CAMERA,
  samples: 2,
  seed: 1,
  fps: 2,
  frames: 4,
  transparent: true,
} as const;

describe('video export through WebCodecs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    seen.configs.length = 0;
    seen.keyFrames.length = 0;
    seen.formats.length = 0;
  });

  it('encodes WebM opaque with a key frame every second, warning that alpha was dropped', async () => {
    vi.stubGlobal('VideoFrame', StubVideoFrame);
    vi.stubGlobal(
      'VideoEncoder',
      stubEncoder((codec) => codec.startsWith('vp09')),
    );
    const renderer = new FakeRenderer();
    const result = await exportClip(renderer, doc, { ...CLIP, format: 'webm' });
    expect(result).toMatchObject({ format: 'webm', mimeType: 'video/webm', extension: 'webm' });
    expect(result.warnings.map((w) => w.code)).toEqual(['ALPHA_DROPPED']);
    expect(renderer.requests.every((r) => r.transparent === false)).toBe(true);
    expect(seen.configs[0]).toMatchObject({ codec: 'vp09.00.10.08', width: 16, height: 12, framerate: 2 });
    expect(seen.keyFrames).toEqual([true, false, true, false]);
    expect(seen.formats).toEqual(['RGBX', 'RGBX', 'RGBX', 'RGBX']);
    const file = await blobBytes(result.blob);
    expect(Array.from(file.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });

  it('encodes MP4 with the avcC the encoder described, and falls back from MP4 to WebM without H.264', async () => {
    vi.stubGlobal('VideoFrame', StubVideoFrame);
    vi.stubGlobal(
      'VideoEncoder',
      stubEncoder(() => true),
    );
    const mp4 = await exportClip(new FakeRenderer(), doc, { ...CLIP, format: 'mp4', transparent: false });
    expect(mp4).toMatchObject({ format: 'mp4', warnings: [] });
    expect(seen.configs[0]).toMatchObject({ codec: 'avc1.64001f', avc: { format: 'avc' } });
    const bytes = await blobBytes(mp4.blob);
    expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp');

    vi.stubGlobal(
      'VideoEncoder',
      stubEncoder((codec) => !codec.startsWith('avc1')),
    );
    const webm = await exportClip(new FakeRenderer(), doc, { ...CLIP, format: 'mp4', transparent: false });
    expect(webm.format).toBe('webm');
    expect(webm.warnings[0]).toMatchObject({ code: 'FORMAT_FALLBACK', requested: 'mp4', used: 'webm' });
    expect(webm.warnings[0]?.message).toMatch(/H\.264/);
  });

  it('rejects with ENCODER_FAILED when the encoder errors', async () => {
    vi.stubGlobal('VideoFrame', StubVideoFrame);
    vi.stubGlobal(
      'VideoEncoder',
      stubEncoder(() => true, 1),
    );
    await expect(exportClip(new FakeRenderer(), doc, { ...CLIP, format: 'webm' })).rejects.toMatchObject({
      code: 'ENCODER_FAILED',
      message: expect.stringContaining('hardware encoder gone') as string,
    });
  });
});
