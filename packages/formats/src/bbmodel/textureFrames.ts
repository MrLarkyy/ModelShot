import type { SceneTextureFrames } from '@modelshot/scene';
import type { BbmodelWarningList } from './BbmodelWarning';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import { MAX_ABS_NUMBER } from './JsonFields';
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

/**
 * Longest `frame_order` read. Its own bound, not `maxStringChars`: Blockbench's `.mcmeta` import writes `index:time`
 * tokens, so a long timed animation exceeds 1024 characters. A longer one warns and plays in plain order.
 */
export const MAX_FRAME_ORDER_CHARS = 65_536;

/**
 * Longest play order expanded from a `custom` order with counter slots (twice the default `maxTextureSide`); a longer
 * period keeps only the numbered tokens, with a warning.
 */
export const MAX_FRAME_ORDER_LENGTH = 8192;

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
 * and takes its default, so a file that loaded before these fields were read still loads; none of them ever fails the
 * load. A `frame_order` over `MAX_FRAME_ORDER_CHARS` warns and counts as empty.
 */
export function readTextureFrameSettings(
  texture: JsonObject,
  path: string,
  modelFormat: string,
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
    order: boundedOrder(read('frame_order', '', isString, 'a string'), path, warnings),
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

function boundedOrder(order: string, path: string, warnings: BbmodelWarningList): string {
  if (order.length <= MAX_FRAME_ORDER_CHARS) return order;
  warnings.add(
    'UNSUPPORTED_VALUE',
    childPath(path, 'frame_order'),
    `${order.length} characters, the limit is ${MAX_FRAME_ORDER_CHARS}; frames play in plain order`,
  );
  return '';
}

/**
 * Blockbench's `TextureAnimator.playAnimationFrame`: `frame_order` split on whitespace, each token through `parseInt`
 * (so `2:5` is frame 2, the time suffix ignored as in its preview). At counter step a it takes token a % tokens; a
 * number n plays n % count, a token that is no number (NaN) plays a % count. With such counter slots the order repeats
 * after lcm(tokens, count) steps and is expanded to that list up to `MAX_FRAME_ORDER_LENGTH`; beyond, the counter slots
 * are dropped with a warning. A negative or infinite number leaves Blockbench's frame index negative or NaN, which its
 * cube preview draws as frame 0: it plays 0, with a warning. An order equal to plain looping is left out.
 */
function customOrder(
  settings: TextureFrameSettings,
  count: number,
  warnings: BbmodelWarningList,
): number[] | undefined {
  const path = childPath(settings.path, 'frame_order');
  const tokens = settings.order.split(/\s+/).map((token) => parseInt(token));
  if (tokens.every((index) => Number.isNaN(index))) return undefined;
  const invalid = tokens.filter((index) => !Number.isNaN(index) && !(Number.isFinite(index) && index >= 0)).length;
  if (invalid > 0) {
    warnings.add(
      'UNSUPPORTED_VALUE',
      path,
      `${invalid} of ${tokens.length} entries are negative or too large; frame 0 plays there`,
    );
  }
  // NaN marks a counter slot; every other entry is a frame index.
  const slots = tokens.map((index) =>
    Number.isNaN(index) ? NaN : Number.isFinite(index) && index >= 0 ? index % count : 0,
  );
  let order = slots;
  if (slots.some((slot) => Number.isNaN(slot))) {
    const period = (slots.length / greatestCommonDivisor(slots.length, count)) * count;
    if (period <= MAX_FRAME_ORDER_LENGTH) {
      order = Array.from({ length: period }, (_, step) => {
        const slot = slots[step % slots.length] ?? NaN;
        return Number.isNaN(slot) ? step % count : slot;
      });
    } else {
      order = slots.filter((slot) => !Number.isNaN(slot));
      warnings.add(
        'UNSUPPORTED_VALUE',
        path,
        `entries that are no frame number repeat over ${period} steps, the limit is ${MAX_FRAME_ORDER_LENGTH}; dropped`,
      );
    }
  }
  const plainLoop = order.length % count === 0 && order.every((frame, step) => frame === step % count);
  return plainLoop ? undefined : order;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}
