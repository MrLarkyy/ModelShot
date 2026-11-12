import { checkLookPreset, type LookPreset, type Rgb } from '@modelshot/looks';

/** What the user changes on top of a look preset: stops added to its exposure, a factor on its saturation, a flat backdrop. */
export interface LookAdjust {
  /** Stops added to the look's exposure; the sum stays within the look's -6..6. */
  readonly exposure: number;
  /** A factor on the look's saturation (1 = the look's own); the product stays within the look's 0..2. */
  readonly saturation: number;
  /** A flat backdrop colour as sRGB `#rrggbb`; null keeps the look's own backdrop. */
  readonly backdrop: string | null;
}

export const NO_LOOK_ADJUST: LookAdjust = Object.freeze({ exposure: 0, saturation: 1, backdrop: null });

export const LOOK_ADJUST_LIMITS = Object.freeze({
  exposure: [-6, 6],
  saturation: [0, 2],
}) satisfies Readonly<Record<'exposure' | 'saturation', readonly [number, number]>>;

const HEX = /^#[0-9a-fA-F]{6}$/;

export const isHexColour = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);

export function isNeutral(adjust: LookAdjust): boolean {
  return adjust.exposure === 0 && adjust.saturation === 1 && adjust.backdrop === null;
}

export function sameAdjust(a: LookAdjust, b: LookAdjust): boolean {
  return a.exposure === b.exposure && a.saturation === b.saturation && a.backdrop === b.backdrop;
}

const decode = (byte: number): number => {
  const encoded = byte / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
};

const clamp = (value: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, value));

/** `preset` with the adjustment applied, a checked look with the same id; `preset` itself when nothing is adjusted. */
export function adjustLook(preset: LookPreset, adjust: LookAdjust): LookPreset {
  if (isNeutral(adjust)) return preset;
  const { toneMapping } = preset;
  let backdrop = preset.backdrop;
  if (adjust.backdrop !== null && isHexColour(adjust.backdrop)) {
    const linear = [1, 3, 5].map((at) => decode(Number.parseInt((adjust.backdrop as string).slice(at, at + 2), 16)));
    const colour: Rgb = [linear[0] ?? 0, linear[1] ?? 0, linear[2] ?? 0];
    backdrop = { top: colour, bottom: colour };
  }
  return checkLookPreset({
    ...preset,
    backdrop,
    toneMapping: {
      ...toneMapping,
      exposure: clamp(toneMapping.exposure + adjust.exposure, LOOK_ADJUST_LIMITS.exposure),
      grade: {
        ...toneMapping.grade,
        saturation: clamp(toneMapping.grade.saturation * adjust.saturation, LOOK_ADJUST_LIMITS.saturation),
      },
    },
  });
}
