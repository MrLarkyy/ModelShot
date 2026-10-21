import type { AnimationPlaybackOptions } from './AnimationPlaybackOptions';
import { animationTime } from './animationTime';
import { checkName, checkVec3 } from './checkValues';
import type {
  SceneAnimation,
  SceneAnimationLoop,
  SceneAnimationProperty,
  SceneInterpolation,
  SceneKeyframe,
} from './SceneAnimation';
import type { SceneDocument } from './SceneDocument';
import type { SceneNode } from './SceneNode';
import { sampleChannel } from './sampleChannel';
import type { Vec3 } from './Vec3';

/** Largest |value| of a keyframe component, keyframe time or animation length accepted. */
export const MAX_ANIMATION_VALUE = 1e6;
/** Animated scale is clamped to [`MIN_ANIMATION_SCALE`, `MAX_ANIMATION_SCALE`] per axis. */
export const MIN_ANIMATION_SCALE = 1e-4;
export const MAX_ANIMATION_SCALE = 1e4;

export interface AnimateResult {
  readonly document: SceneDocument;
  /** The clip time sampled (`animationTime`); `null`: no animation applies (`null` options, or a `once` clip ended). */
  readonly clipTime: number | null;
}

const LOOPS: readonly SceneAnimationLoop[] = ['once', 'hold', 'loop'];
const PROPERTIES: readonly SceneAnimationProperty[] = ['rotation', 'translation', 'scale'];
const INTERPOLATIONS: readonly SceneInterpolation[] = ['linear', 'catmullrom', 'step'];
const ZERO: Vec3 = [0, 0, 0];

/** Highest node index an already validated animation refers to; animations are treated as immutable. */
const validated = new WeakMap<SceneAnimation, number>();

/**
 * A copy of `doc` at `options.time` of one of its animations, always computed from the rest pose, so the same time
 * gives the same nodes whatever was played before (seeking, export and live playback agree). Per node: `rotation =
 * rest + rotation sample` (rest: `restRotation`, else `rotation`), `translation = translation sample` (0 without
 * one), `scale = scale sample` clamped per axis to [`MIN_ANIMATION_SCALE`, `MAX_ANIMATION_SCALE`] (absent without
 * one) and `restRotation = rest`. Sets `playback` and drops `pose` (the nodes no longer carry it). `null` options, or
 * a `once` clip past its end, give the rest pose; `null` also drops `playback`. The input is never mutated; bad
 * options or a malformed selected animation throw a `RangeError` naming the path
 * (`animations[0].channels[2].keyframes[1].value[0]`). Validation is cached per animation object, so a frame costs
 * O(channels · log keyframes + nodes).
 */
export function animateScene(doc: SceneDocument, options: AnimationPlaybackOptions | null): AnimateResult {
  if (options === null) return { document: withNodes(doc, restNodes(doc, new Map()), undefined), clipTime: null };
  if (typeof options !== 'object') throw new RangeError('options: expected an object or null');
  const index = resolveAnimation(doc, options.animation);
  const animation = doc.animations?.[index];
  if (!animation) throw new RangeError('options.animation: no such animation');
  const loop = options.loop === undefined ? animation.loop : checkLoop(options.loop, 'options.loop');
  if (typeof options.time !== 'number' || !Number.isFinite(options.time)) {
    throw new RangeError('options.time: expected a finite number');
  }
  checkAnimation(animation, `animations[${index}]`, doc.nodes.length);

  const clipTime = animationTime(animation, options.time, loop);
  const samples = new Map<number, Partial<Record<SceneAnimationProperty, Vec3>>>();
  if (clipTime !== null) {
    for (const channel of animation.channels) {
      const node = samples.get(channel.node) ?? {};
      node[channel.property] = sampleChannel(channel.keyframes, clipTime, loop === 'loop');
      samples.set(channel.node, node);
    }
  }
  const playback = { animation: index, time: options.time, loop };
  return { document: withNodes(doc, restNodes(doc, samples), playback), clipTime };
}

function restNodes(doc: SceneDocument, samples: ReadonlyMap<number, Partial<Record<SceneAnimationProperty, Vec3>>>) {
  return doc.nodes.map((node, index): SceneNode => {
    const rest = node.restRotation ?? node.rotation;
    const sample = samples.get(index);
    const turn = sample?.rotation;
    const animated: { -readonly [K in keyof SceneNode]: SceneNode[K] } = {
      ...node,
      rotation: turn ? [rest[0] + turn[0], rest[1] + turn[1], rest[2] + turn[2]] : [rest[0], rest[1], rest[2]],
      translation: sample?.translation ?? ZERO,
      restRotation: rest,
    };
    if (sample?.scale)
      animated.scale = [clampScale(sample.scale[0]), clampScale(sample.scale[1]), clampScale(sample.scale[2])];
    else delete animated.scale;
    return animated;
  });
}

function withNodes(doc: SceneDocument, nodes: SceneNode[], playback: SceneDocument['playback']): SceneDocument {
  const document: { -readonly [K in keyof SceneDocument]: SceneDocument[K] } = { ...doc, nodes };
  delete document.pose;
  if (playback) document.playback = playback;
  else delete document.playback;
  return document;
}

function clampScale(value: number): number {
  return Math.min(MAX_ANIMATION_SCALE, Math.max(MIN_ANIMATION_SCALE, value));
}

function resolveAnimation(doc: SceneDocument, animation: unknown): number {
  const animations: unknown = doc.animations ?? [];
  if (!Array.isArray(animations)) throw new RangeError('animations: expected an array');
  const count = animations.length;
  if (typeof animation === 'number') {
    if (Number.isInteger(animation) && animation >= 0 && animation < count) return animation;
    throw new RangeError(`options.animation: expected an animation index in 0..${count - 1}`);
  }
  if (typeof animation === 'string') {
    const index = (animations as readonly SceneAnimation[]).findIndex((item) => item?.name === animation);
    if (index >= 0) return index;
    throw new RangeError('options.animation: no animation has that name');
  }
  throw new RangeError('options.animation: expected an animation index or name');
}

function checkLoop(value: unknown, path: string): SceneAnimationLoop {
  if (!LOOPS.includes(value as SceneAnimationLoop)) throw new RangeError(`${path}: expected once, hold or loop`);
  return value as SceneAnimationLoop;
}

function checkAnimation(animation: SceneAnimation, path: string, nodeCount: number): void {
  const known = validated.get(animation);
  const maxNode = known ?? validateAnimation(animation, path);
  if (known === undefined) validated.set(animation, maxNode);
  if (maxNode >= nodeCount) throw new RangeError(`${path}.channels: node ${maxNode} is not in 0..${nodeCount - 1}`);
}

/** Returns the highest node index a channel targets (−1 without channels). */
function validateAnimation(animation: SceneAnimation, path: string): number {
  if (typeof animation !== 'object' || animation === null) throw new RangeError(`${path}: expected an object`);
  checkName(animation.name, `${path}.name`);
  checkLoop(animation.loop, `${path}.loop`);
  checkTime(animation.length, `${path}.length`);
  const channels: unknown = animation.channels;
  if (!Array.isArray(channels)) throw new RangeError(`${path}.channels: expected an array`);
  const seen = new Set<string>();
  let maxNode = -1;
  for (let c = 0; c < channels.length; c++) {
    const channelPath = `${path}.channels[${c}]`;
    const channel: unknown = channels[c];
    if (typeof channel !== 'object' || channel === null) throw new RangeError(`${channelPath}: expected an object`);
    const { node, property, keyframes } = channel as Record<string, unknown>;
    if (typeof node !== 'number' || !Number.isInteger(node) || node < 0) {
      throw new RangeError(`${channelPath}.node: expected a node index`);
    }
    if (!PROPERTIES.includes(property as SceneAnimationProperty)) {
      throw new RangeError(`${channelPath}.property: expected rotation, translation or scale`);
    }
    const key = `${node}/${String(property)}`;
    if (seen.has(key)) throw new RangeError(`${channelPath}: a second ${String(property)} channel of node ${node}`);
    seen.add(key);
    maxNode = Math.max(maxNode, node);
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
      throw new RangeError(`${channelPath}.keyframes: expected a non-empty array`);
    }
    let previous = 0;
    for (let k = 0; k < keyframes.length; k++) {
      const keyframePath = `${channelPath}.keyframes[${k}]`;
      const time = checkKeyframe(keyframes[k], keyframePath);
      if (time < previous) throw new RangeError(`${keyframePath}.time: expected keyframes sorted by time`);
      previous = time;
    }
  }
  return maxNode;
}

function checkKeyframe(value: unknown, path: string): number {
  if (typeof value !== 'object' || value === null) throw new RangeError(`${path}: expected an object`);
  const keyframe = value as Partial<Record<keyof SceneKeyframe, unknown>>;
  const time = checkTime(keyframe.time, `${path}.time`);
  checkVec3(keyframe.value, `${path}.value`, MAX_ANIMATION_VALUE);
  if (keyframe.before !== undefined) checkVec3(keyframe.before, `${path}.before`, MAX_ANIMATION_VALUE);
  if (!INTERPOLATIONS.includes(keyframe.interpolation as SceneInterpolation)) {
    throw new RangeError(`${path}.interpolation: expected linear, catmullrom or step`);
  }
  return time;
}

function checkTime(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_ANIMATION_VALUE) {
    throw new RangeError(`${path}: expected seconds in [0, ${MAX_ANIMATION_VALUE}]`);
  }
  return value;
}
