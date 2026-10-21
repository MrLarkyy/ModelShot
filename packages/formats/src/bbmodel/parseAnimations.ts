import {
  MAX_ANIMATION_VALUE,
  type SceneAnimation,
  type SceneAnimationChannel,
  type SceneAnimationLoop,
  type SceneAnimationProperty,
  type SceneInterpolation,
  type SceneKeyframe,
  type Vec3,
} from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import type { BbmodelLimits } from './BbmodelLoadOptions';
import type { BbmodelWarningList } from './BbmodelWarning';
import type { HierarchyNode } from './buildHierarchy';
import { childPath, field, isJsonObject, type JsonObject } from '../json/JsonObject';
import { readArray, readBoolean, readFiniteNumber, readObject, readOptionalString, readString } from './JsonFields';
import { keyframeValue } from './keyframeValue';
import { quoteValue } from '../text/quoteValue';

/** Blockbench bone channels and the node property each one drives. */
const BONE_CHANNELS: ReadonlyMap<string, SceneAnimationProperty> = new Map([
  ['rotation', 'rotation'],
  ['position', 'translation'],
  ['scale', 'scale'],
]);
const LOOPS: readonly string[] = ['once', 'hold', 'loop'] satisfies SceneAnimationLoop[];
const INTERPOLATIONS: readonly string[] = ['linear', 'catmullrom', 'step'] satisfies SceneInterpolation[];
const AXES = ['x', 'y', 'z'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Context {
  readonly nodes: readonly HierarchyNode[];
  readonly limits: BbmodelLimits;
  readonly warnings: BbmodelWarningList;
  /** (animation, animator, channel) paths already warned about, so a long channel warns once. */
  readonly warned: Set<string>;
}

/**
 * The `animations` of a `.bbmodel` as scene animations; `undefined` when the file has none. Counts every animation,
 * animator and keyframe against the limits before reading one (`TOO_MANY_KEYFRAMES`). Played: bone animators'
 * `rotation`, `position` and `scale` keyframes with numeric data points and linear, catmull-rom or step
 * interpolation. Blockbench keeps keyframes in the convention of its group rotations and positions, which the scene
 * shares, so values are taken as they are (only Blockbench's Bedrock export flips axes). Whatever is not played as
 * authored is a warning, once per animation, animator and channel; a wrong JSON type is an `INVALID_FIELD`.
 */
export function parseAnimations(
  root: JsonObject,
  nodes: readonly HierarchyNode[],
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
): SceneAnimation[] | undefined {
  const value = field(root, 'animations');
  if (value === undefined) return undefined;
  const items = readArray(value, '$.animations', {
    max: limits.maxAnimations,
    code: 'TOO_MANY_KEYFRAMES',
    what: 'animations',
  });
  if (items.length === 0) return undefined;
  const animations = items.map((item, index) => readObject(item, childPath('$.animations', index)));
  countKeyframes(animations, limits);
  const context: Context = { nodes, limits, warnings, warned: new Set() };
  return animations.map((animation, index) => readAnimation(animation, childPath('$.animations', index), context));
}

/** Format 3.7+ keeps animators in `animators`, older files in `bones`. */
function animatorsOf(animation: JsonObject): unknown {
  return field(animation, 'animators') ?? field(animation, 'bones');
}

/** Keyframes of an animator: its `keyframes`, or the animator itself in files before 3.7. */
function keyframesOf(animator: unknown): unknown {
  return Array.isArray(animator) ? animator : isJsonObject(animator) ? field(animator, 'keyframes') : undefined;
}

function countKeyframes(animations: readonly JsonObject[], limits: BbmodelLimits): void {
  const maxAnimators = limits.maxGroups + limits.maxElements + 1;
  let total = 0;
  animations.forEach((animation, a) => {
    const animators = animatorsOf(animation);
    if (!isJsonObject(animators)) return;
    const path = childPath(childPath('$.animations', a), 'animators');
    let count = 0;
    for (const key in animators) {
      if (!Object.hasOwn(animators, key)) continue;
      if (++count > maxAnimators) {
        throw new BbmodelError('TOO_MANY_KEYFRAMES', path, `more than ${maxAnimators} animators`);
      }
      const keyframes = keyframesOf(animators[key]);
      if (!Array.isArray(keyframes)) continue;
      total += keyframes.length;
      if (total > limits.maxKeyframes) {
        throw new BbmodelError(
          'TOO_MANY_KEYFRAMES',
          childPath(path, key),
          `more than ${limits.maxKeyframes} keyframes`,
        );
      }
    }
  });
}

function readAnimation(animation: JsonObject, path: string, context: Context): SceneAnimation {
  const { limits, warnings } = context;
  const name = readOptionalString(animation, 'name', path, limits.maxStringChars, 'animation');
  const loopValue = readOptionalString(animation, 'loop', path, limits.maxStringChars, 'once');
  let loop: SceneAnimationLoop = 'once';
  if (LOOPS.includes(loopValue)) loop = loopValue as SceneAnimationLoop;
  else warnings.add('UNSUPPORTED_VALUE', childPath(path, 'loop'), `${quoteValue(loopValue)} played as once`);
  const lengthValue = field(animation, 'length');
  const fileLength = lengthValue === undefined ? 0 : readFiniteNumber(lengthValue, childPath(path, 'length'));
  if (fileLength > MAX_ANIMATION_VALUE) {
    throw invalid(childPath(path, 'length'), `seconds up to ${MAX_ANIMATION_VALUE}`, lengthValue);
  }
  checkPlaybackFields(animation, path, context);

  const byNode = new Map<number, SceneAnimationChannel[]>();
  const animatorsValue = animatorsOf(animation);
  if (animatorsValue !== undefined) {
    const animatorsPath = childPath(path, field(animation, 'animators') === undefined ? 'bones' : 'animators');
    const animators = readObject(animatorsValue, animatorsPath);
    for (const key in animators) {
      if (!Object.hasOwn(animators, key)) continue;
      const animatorPath = childPath(animatorsPath, key);
      const node = readAnimator(key, animators[key], animatorPath, context);
      // Blockbench keeps one animator per bone: a later one for the same bone replaces the earlier.
      if (node) byNode.set(node.index, node.channels);
    }
  }
  const channels = [...byNode.values()].flat();
  const lastKeyframe = channels.reduce((last, channel) => Math.max(last, channel.keyframes.at(-1)?.time ?? 0), 0);
  return { name, loop, length: Math.max(fileLength, lastKeyframe), channels };
}

/** Animation fields that change playback in Minecraft; ModelShot plays the clip as if they had their defaults. */
function checkPlaybackFields(animation: JsonObject, path: string, context: Context): void {
  const { limits, warnings } = context;
  const constant = (key: string): number | null | undefined => {
    const value = field(animation, key);
    return value === undefined ? undefined : keyframeValue(value, childPath(path, key), limits.maxStringChars);
  };
  const update = field(animation, 'anim_time_update');
  if (update !== undefined && readString(update, childPath(path, 'anim_time_update'), limits.maxStringChars).trim()) {
    warnings.add('UNSUPPORTED_VALUE', childPath(path, 'anim_time_update'), 'played at normal speed');
  }
  for (const key of ['start_delay', 'loop_delay']) {
    const value = constant(key);
    if (value !== undefined && value !== 0)
      warnings.add('UNSUPPORTED_VALUE', childPath(path, key), 'played without delay');
  }
  const blend = field(animation, 'blend_weight');
  const weight = constant('blend_weight');
  const blank = typeof blend === 'string' && blend.trim() === '';
  if (weight !== undefined && !blank && weight !== 1) {
    warnings.add('UNSUPPORTED_VALUE', childPath(path, 'blend_weight'), 'played at full weight');
  }
}

function readAnimator(
  key: string,
  value: unknown,
  path: string,
  context: Context,
): { index: number; channels: SceneAnimationChannel[] } | null {
  const { limits, warnings } = context;
  const animator = Array.isArray(value) ? {} : readObject(value, path);
  const keyframesValue = keyframesOf(value);
  const keyframesPath = Array.isArray(value) ? path : childPath(path, 'keyframes');
  const items =
    keyframesValue === undefined
      ? []
      : readArray(keyframesValue, keyframesPath, {
          max: limits.maxKeyframes,
          code: 'TOO_MANY_KEYFRAMES',
          what: 'keyframes',
        });
  const keyframes = items.map((item, k) => ({
    data: readObject(item, childPath(keyframesPath, k)),
    path: childPath(keyframesPath, k),
  }));
  const byChannel = new Map<string, typeof keyframes>();
  for (const keyframe of keyframes) {
    const channel = readOptionalString(keyframe.data, 'channel', keyframe.path, limits.maxStringChars, 'rotation');
    const list = byChannel.get(channel);
    if (list) list.push(keyframe);
    else byChannel.set(channel, [keyframe]);
  }

  const type = readOptionalString(animator, 'type', path, limits.maxStringChars, 'bone');
  if (key === 'effects' || type !== 'bone') {
    for (const channel of byChannel.keys()) {
      warnOnce(
        context,
        'UNSUPPORTED_CHANNEL',
        childPath(path, channel),
        `${quoteValue(type)} ${quoteValue(channel)} keyframes are not played`,
      );
    }
    return null;
  }
  const index = resolveNode(key, context.nodes);
  if (index < 0) {
    if (byChannel.size > 0) warnings.add('UNKNOWN_REFERENCE', path, `no group with uuid or name ${quoteValue(key)}`);
    return null;
  }

  const channels: SceneAnimationChannel[] = [];
  for (const [channel, list] of byChannel) {
    const property = BONE_CHANNELS.get(channel);
    const channelPath = childPath(path, channel);
    if (!property) {
      warnOnce(context, 'UNSUPPORTED_CHANNEL', channelPath, `channel ${quoteValue(channel)} is not played`);
      continue;
    }
    if (property === 'rotation') checkRotationFlags(animator, path, channelPath, context);
    const read = list.flatMap(({ data, path: keyframePath }) => {
      const keyframe = readKeyframe(data, keyframePath, property, channelPath, context);
      return keyframe ? [keyframe] : [];
    });
    // Stable: equal times keep their file order.
    read.sort((a, b) => a.time - b.time);
    if (read.length > 0) channels.push({ node: index, property, keyframes: read });
  }
  return { index, channels };
}

/** The node of an animator key: the group with that uuid, else (a key that is no uuid) the first group with that name, ignoring case as Blockbench does; −1 for none. */
function resolveNode(key: string, nodes: readonly HierarchyNode[]): number {
  const byUuid = nodes.findIndex((node) => node.sourceId !== '' && node.sourceId === key);
  if (byUuid >= 0 || UUID.test(key)) return byUuid;
  const name = key.toLowerCase();
  return nodes.findIndex((node) => node.name.toLowerCase() === name);
}

function checkRotationFlags(animator: JsonObject, path: string, channelPath: string, context: Context): void {
  for (const [flag, detail] of [
    ['rotation_global', 'global rotation played in local space'],
    ['quaternion_interpolation', 'quaternion interpolation played as Euler angles'],
  ] as const) {
    const value = field(animator, flag);
    if (value !== undefined && readBoolean(value, childPath(path, flag))) {
      warnOnce(context, 'UNSUPPORTED_CHANNEL', `${channelPath}#${flag}`, detail, childPath(path, flag));
    }
  }
}

function readKeyframe(
  data: JsonObject,
  path: string,
  property: SceneAnimationProperty,
  channelPath: string,
  context: Context,
): SceneKeyframe | null {
  const { limits } = context;
  const timeValue = field(data, 'time');
  const time = timeValue === undefined ? 0 : readFiniteNumber(timeValue, childPath(path, 'time'));
  if (time < 0 || time > MAX_ANIMATION_VALUE) {
    throw invalid(childPath(path, 'time'), `seconds in [0, ${MAX_ANIMATION_VALUE}]`, timeValue);
  }
  const interpolationValue = readOptionalString(data, 'interpolation', path, limits.maxStringChars, 'linear');
  let interpolation: SceneInterpolation = 'linear';
  if (INTERPOLATIONS.includes(interpolationValue)) {
    interpolation = interpolationValue as SceneInterpolation;
  } else if (interpolationValue === 'bezier') {
    warnOnce(
      context,
      'UNSUPPORTED_CHANNEL',
      `${channelPath}#bezier`,
      'bezier keyframes played linear',
      childPath(path, 'interpolation'),
    );
  } else {
    context.warnings.add(
      'UNSUPPORTED_VALUE',
      childPath(path, 'interpolation'),
      `${quoteValue(interpolationValue)} played linear`,
    );
  }

  const pointsValue = field(data, 'data_points');
  const pointsPath = childPath(path, 'data_points');
  const points =
    pointsValue === undefined
      ? []
      : readArray(pointsValue, pointsPath, {
          max: Infinity,
          code: 'INVALID_FIELD',
          what: 'data points',
        });
  if (points.length > 2)
    context.warnings.add('UNSUPPORTED_VALUE', pointsPath, `${points.length} data points, the first two played`);
  const fallback = property === 'scale' ? 1 : 0;
  const first = points.length === 0 ? data : readObject(points[0], childPath(pointsPath, 0));
  const pre = readPoint(first, points.length === 0 ? path : childPath(pointsPath, 0), fallback, limits);
  const post =
    points.length > 1
      ? readPoint(readObject(points[1], childPath(pointsPath, 1)), childPath(pointsPath, 1), fallback, limits)
      : pre;
  if (pre === null || post === null) {
    warnOnce(
      context,
      'UNSUPPORTED_CHANNEL',
      `${channelPath}#molang`,
      'a Molang expression is not evaluated; its keyframe is skipped',
      path,
    );
    return null;
  }
  if (property === 'scale' && [...pre, ...post].some((v) => v < 0)) {
    warnOnce(
      context,
      'UNSUPPORTED_VALUE',
      `${channelPath}#negative`,
      'negative scale played as a tiny positive scale',
      path,
    );
  }
  const keyframe: SceneKeyframe = { time, value: post, interpolation };
  return points.length > 1 ? { ...keyframe, before: pre } : keyframe;
}

/** `null` when an axis holds a Molang expression. */
function readPoint(point: JsonObject, path: string, fallback: number, limits: BbmodelLimits): Vec3 | null {
  const values: number[] = [];
  for (const axis of AXES) {
    const value = field(point, axis);
    const number = value === undefined ? fallback : keyframeValue(value, childPath(path, axis), limits.maxStringChars);
    if (number === null) return null;
    values.push(number);
  }
  return [values[0] ?? fallback, values[1] ?? fallback, values[2] ?? fallback];
}

/** One warning per `key`; `path` (default `key`) is what the warning names. */
function warnOnce(
  context: Context,
  code: 'UNSUPPORTED_CHANNEL' | 'UNSUPPORTED_VALUE',
  key: string,
  detail: string,
  path = key,
): void {
  if (context.warned.has(key)) return;
  context.warned.add(key);
  context.warnings.add(code, path, detail);
}

function invalid(path: string, expected: string, value: unknown): BbmodelError {
  return new BbmodelError('INVALID_FIELD', path, `expected ${expected}, got ${quoteValue(value)}`);
}
