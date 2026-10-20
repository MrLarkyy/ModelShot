/**
 * A PNG image carried as its encoded bytes, unchanged by the loader (only `loadSkin` decodes pixels, of a legacy skin,
 * once, to apply the legacy hat rule). `width` × `height` is the pixel size from the PNG header; UVs are normalised by
 * `uvWidth` × `uvHeight` (the model's texture space), so one UV unit covers `width / uvWidth` pixels.
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
}
