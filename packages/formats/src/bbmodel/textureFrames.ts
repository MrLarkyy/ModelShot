import type { SceneTextureFrames } from '@modelshot/scene';
import type { BbmodelWarningList } from './BbmodelWarning';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import { MAX_ABS_NUMBER, readString } from './JsonFields';
import type { UvSize } from './parseTextures';
import { quoteValue } from '../text/quoteValue';

/** Blockbench formats with `animated_textures`; in any other format a strip is one image and its fields are ignored. */
const ANIMATED_TEXTURE_FORMATS: ReadonlySet<string> = new Set([
  'free',
  'java_block',
  'bedrock',
  'bedrock_block',
  'bedrock_old',
]);

const FRAME_ORDER_TYPES = ['loop', 'backwards', 'back_and_forth', 'custom'] as const;

type FrameOrderType = (typeof FRAME_ORDER_TYPES)[number];

/** A texture's raw Blockbench animation fields, read before any image is decoded. */
export interface TextureFrameSettings {
  readonly path: string;
  /** `java_block` (Blockbench `texture_mcmeta`) times frames by `frameTicks`, other formats by `fps`. */
  readonly mcmetaTiming: boolean;
  /** `frame_time`, Minecraft ticks per frame. */
  readonly frameTicks: number;
  readonly fps: number;
  readonly orderType: FrameOrderType;
  readonly order: string;
  readonly interpolate: boolean;
}

/**
 * Reads `frame_time` (default 1), `fps` (7), `frame_order_type` (`loop`), `frame_order` (`''`) and
 * `frame_interpolate` (false) in the formats that animate textures; `undefined` in the others. A malformed value warns
 * and takes its default, so a file that loaded before these fields were read still loads; only a `frame_order` over
 * `maxStringChars` fails, like every other string.
 */
export function readTextureFrameSettings(
  texture: JsonObject,
  path: string,
  modelFormat: string,
  maxStringChars: number,
  warnings: BbmodelWarningList,
): TextureFrameSettings | undefined {
  if (!ANIMATED_TEXTURE_FORMATS.has(modelFormat)) return undefined;
  const read = <T>(key: string, fallback: T, accept: (value: unknown) => value is T, expected: string): T => {
    const value = field(texture, key);
    if (value === undefined || accept(value)) return value ?? fallback;
    warnings.add(
      'UNSUPPORTED_VALUE',
      childPath(path, key),
      `expected ${expected}, got ${quoteValue(value)}; using ${quoteValue(fallback)}`,
    );
    return fallback;
  };
  const isNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_NUMBER;
  const isOrderType = (value: unknown): value is FrameOrderType => FRAME_ORDER_TYPES.some((type) => type === value);
  const isString = (value: unknown): value is string => typeof value === 'string';
  const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
  const number = `a finite number within ±${MAX_ABS_NUMBER}`;
  return {
    path,
    mcmetaTiming: modelFormat === 'java_block',
    frameTicks: read('frame_time', 1, isNumber, number),
    fps: read('fps', 7, isNumber, number),
    orderType: read('frame_order_type', 'loop', isOrderType, 'loop, backwards, back_and_forth or custom'),
    order: readString(read('frame_order', '', isString, 'a string'), childPath(path, 'frame_order'), maxStringChars),
    interpolate: read('frame_interpolate', false, isBoolean, 'true or false'),
  };
}

/**
 * The frames of a texture as Blockbench's `Texture.frameCount` finds them: when the image's aspect ratio differs from
 * its UV space's, `ceil(uvRatio / imageRatio − 0.05)` frames if that is above 1. A strip whose frames would be under
 * one pixel tall warns and stays one image. Timing becomes seconds and the order an explicit index list, as
 * Blockbench's `TextureAnimator` plays them.
 */
export function textureFrames(
  settings: TextureFrameSettings | undefined,
  image: UvSize,
  uvSize: UvSize,
  warnings: BbmodelWarningList,
): SceneTextureFrames | undefined {
  if (!settings || image.width <= 0 || image.height <= 0) return undefined;
  const ratio = image.width / image.height;
  if (ratio === uvSize.width / uvSize.height) return undefined;
  const count = Math.ceil(uvSize.width / uvSize.height / ratio - 0.05);
  if (!(count > 1)) return undefined;
  if (count > image.height) {
    warnings.add(
      'UNSUPPORTED_VALUE',
      settings.path,
      `${count} frames on a ${image.width}×${image.height} image would be under one pixel tall; drawn as one image`,
    );
    return undefined;
  }
  // Blockbench's rates: 1000 / max(16.66, 50 · frame_time) frames per second, or max(1, fps).
  const frameTime = settings.mcmetaTiming
    ? Math.max(16.66, 50 * settings.frameTicks) / 1000
    : 1 / Math.max(1, settings.fps);
  const order = frameOrder(settings, count, warnings);
  return {
    count,
    frameTime,
    ...(order ? { order } : {}),
    ...(settings.interpolate ? { interpolate: true } : {}),
  };
}

/** Played frame indices; `undefined` for plain 0 … count − 1 looping. */
function frameOrder(settings: TextureFrameSettings, count: number, warnings: BbmodelWarningList): number[] | undefined {
  switch (settings.orderType) {
    case 'loop':
      return undefined;
    case 'backwards':
      return Array.from({ length: count }, (_, i) => count - 1 - i);
    case 'back_and_forth':
      return Array.from({ length: 2 * count - 2 }, (_, i) => (i < count ? i : 2 * count - 2 - i));
    case 'custom':
      return customOrder(settings, count, warnings);
  }
}

/**
 * Blockbench splits `frame_order` on whitespace and reads each token with `parseInt` (so `2:5` is frame 2, the time
 * suffix ignored as in its preview) and plays `index % count`. A token that is not a number plays whichever frame the
 * running counter is on, which no fixed order expresses: it is dropped with a warning, as is a negative one (Blockbench
 * would show no frame). An order of such tokens only (a blank one) plays plain looping in Blockbench, so it is that.
 */
function customOrder(
  settings: TextureFrameSettings,
  count: number,
  warnings: BbmodelWarningList,
): number[] | undefined {
  const parsed = settings.order.split(/\s+/).map((token) => parseInt(token));
  if (parsed.every((index) => Number.isNaN(index))) return undefined;
  const valid = parsed.filter((index) => Number.isFinite(index) && index >= 0);
  if (valid.length < parsed.length) {
    warnings.add(
      'UNSUPPORTED_VALUE',
      childPath(settings.path, 'frame_order'),
      `${parsed.length - valid.length} of ${parsed.length} entries are not frame numbers and are dropped`,
    );
  }
  return valid.length === 0 ? undefined : valid.map((index) => index % count);
}
