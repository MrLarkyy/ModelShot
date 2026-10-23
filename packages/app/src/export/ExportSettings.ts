export type ExportKind = 'still' | 'turntable' | 'animation';
export type ClipFormatChoice = 'apng' | 'gif' | 'webp' | 'webm' | 'mp4';

export const EXPORT_KINDS: readonly ExportKind[] = ['still', 'turntable', 'animation'];
export const CLIP_FORMAT_CHOICES: readonly ClipFormatChoice[] = ['apng', 'gif', 'webp', 'webm', 'mp4'];

/** What the export dialog remembers; `checkExportOptions` checks every number again before an export uses it. */
export interface ExportSettings {
  kind: ExportKind;
  clipFormat: ClipFormatChoice;
  width: number;
  height: number;
  samples: number;
  supersample: number;
  denoise: boolean;
  transparent: boolean;
  fps: number;
  frames: number;
}

export const DEFAULT_EXPORT_SETTINGS: Readonly<ExportSettings> = Object.freeze({
  kind: 'still',
  clipFormat: 'gif',
  width: 512,
  height: 512,
  samples: 64,
  supersample: 1,
  denoise: false,
  transparent: true,
  fps: 24,
  frames: 36,
});
