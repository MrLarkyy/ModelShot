import type { SceneTextureFrames } from './SceneTextureFrames';

/**
 * A PNG image carried as its encoded bytes, unchanged by the loader (only `loadSkin` decodes pixels, of a legacy skin,
 * once, to apply the legacy hat rule). `width` × `height` is the pixel size from the PNG header; UVs are normalised by
 * `uvWidth` × `uvHeight` (the model's texture space), so one UV unit covers `width / uvWidth` pixels. On a strip
 * (`frames`) v is normalised by `uvHeight` × `frames.count`, so the UVs fall in frame 0.
 */
export interface SceneTexture {
  readonly name: string;
  readonly mimeType: 'image/png';
  /** `null` when the texture is missing. */
  readonly bytes: Uint8Array | null;
  /** Pixel size; 0 when missing. */
  readonly width: number;
  readonly height: number;
  readonly uvWidth: number;
  readonly uvHeight: number;
  /** The model references this texture but its image was neither embedded nor supplied. */
  readonly missing: boolean;
  /**
   * The image is a vertical strip of frames (added within version 1, MS-27); absent: a still image. UVs of faces
   * using it already map into frame 0, so v spans [0, 1 / `frames.count`] there.
   */
  readonly frames?: SceneTextureFrames;
}
