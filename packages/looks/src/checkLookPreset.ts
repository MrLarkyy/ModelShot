import type { Rgb } from './agxToneMap';
import { checkEdgeLook, type EdgeLook } from './EdgeLook';
import {
  LOOK_FORMAT,
  LOOK_FORMAT_VERSION,
  type Direction,
  type LookDirectionalLight,
  type LookPreset,
  type LookRimLight,
} from './LookPreset';
import { LookPresetError, type LookPresetErrorCode } from './LookPresetError';

/** The largest scene-linear channel of a look colour, and of the renderers' `background` option (`checkBackground`). */
export const MAX_LOOK_COLOR = 16;
/** The shadow catcher's plane assumes a key above the horizon (`shadowCatcherPlane` of the realtime renderer). */
const MIN_KEY_Y = Math.sin((5 * Math.PI) / 180);
/** A direction this close to unit length is kept as written, so hand-written unit vectors stay bit-exact. */
const UNIT_TOLERANCE = 1e-4;
const ID = /^[a-z0-9-]{1,32}$/;
/** Control characters (C0, DEL, C1) and lone surrogates (what `String.prototype.isWellFormed` would reject; es2023 lib). */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cs}]/u;

function fail(code: LookPresetErrorCode, path: string, message: string): never {
  throw new LookPresetError(code, message, path);
}

const child = (path: string, key: string): string => (path ? `${path}.${key}` : key);

/** `value` as an object holding exactly `keys`, each own and present. */
function fields<K extends string>(value: unknown, path: string, keys: readonly K[]): Record<K, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('TYPE', path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (!(keys as readonly string[]).includes(key)) {
      fail('UNKNOWN_KEY', child(path, key), `is not a field of format ${LOOK_FORMAT} v${LOOK_FORMAT_VERSION}`);
    }
  }
  const out = {} as Record<K, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('MISSING', child(path, key), 'is required');
    out[key] = (value as Record<string, unknown>)[key];
  }
  return out;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('TYPE', path, 'must be a finite number');
  return value;
}

function ranged(value: unknown, path: string, min: number, max: number): number {
  const n = finite(value, path);
  if (n < min || n > max) fail('RANGE', path, `must be in ${min}..${max}, got ${n}`);
  return n;
}

function triple(value: unknown, path: string, min: number, max: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) fail('TYPE', path, 'must be an array of three numbers');
  const items = value as unknown[];
  return [
    ranged(items[0], `${path}[0]`, min, max),
    ranged(items[1], `${path}[1]`, min, max),
    ranged(items[2], `${path}[2]`, min, max),
  ];
}

const color = (value: unknown, path: string): Rgb => triple(value, path, 0, MAX_LOOK_COLOR);

function direction(value: unknown, path: string): Direction {
  const v = triple(value, path, -1e3, 1e3);
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 1e-6)) fail('DIRECTION', path, 'must not be the zero vector');
  if (Math.abs(length - 1) <= UNIT_TOLERANCE) return v;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function literal<T extends string | number>(value: unknown, path: string, expected: T, code: LookPresetErrorCode): T {
  if (value !== expected)
    fail(code, path, `must be ${JSON.stringify(expected)}, got ${JSON.stringify(value) ?? 'undefined'}`);
  return expected;
}

function directional(value: unknown, path: string): LookDirectionalLight {
  const f = fields(value, path, ['direction', 'color']);
  return { direction: direction(f.direction, child(path, 'direction')), color: color(f.color, child(path, 'color')) };
}

function rimLight(value: unknown, path: string): LookRimLight {
  const f = fields(value, path, ['direction', 'color', 'exponent', 'albedoShare']);
  return {
    direction: direction(f.direction, child(path, 'direction')),
    color: color(f.color, child(path, 'color')),
    exponent: ranged(f.exponent, child(path, 'exponent'), 1, 16),
    albedoShare: ranged(f.albedoShare, child(path, 'albedoShare'), 0, 1),
  };
}

function edges(value: unknown, path: string): EdgeLook {
  const f = fields(value, path, ['width', 'sharpAngleDeg']);
  finite(f.width, child(path, 'width'));
  finite(f.sharpAngleDeg, child(path, 'sharpAngleDeg'));
  try {
    return checkEdgeLook({ width: f.width as number, sharpAngleDeg: f.sharpAngleDeg as number });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const field = /^edges\.(\w+)/.exec(message)?.[1] ?? '';
    fail('RANGE', child(path, field), message.replace(/^edges\.\w+ /, ''));
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * Checks `value` against look preset format v1 and returns a frozen deep copy, directions normalised (one within
 * 1e-4 of unit length is kept as written). Every field is required and no other is allowed; numbers must be finite and
 * in range (`docs/look-presets.md`). Throws `LookPresetError` naming the first offending field. Reads only the known
 * fields of each object, so a hostile value costs at most its size in key scans.
 */
export function checkLookPreset(value: unknown): LookPreset {
  const root = fields(value, '', [
    'format',
    'version',
    'id',
    'name',
    'lights',
    'environment',
    'backdrop',
    'catcher',
    'edges',
    'toneMapping',
  ]);
  const format = literal(root.format, 'format', LOOK_FORMAT, 'FORMAT');
  if (typeof root.version !== 'number' || root.version !== LOOK_FORMAT_VERSION) {
    const newer = typeof root.version === 'number' && root.version > LOOK_FORMAT_VERSION;
    fail(
      'VERSION',
      'version',
      newer
        ? `${String(root.version)} is newer than this build reads (${LOOK_FORMAT_VERSION})`
        : `must be ${LOOK_FORMAT_VERSION}, got ${JSON.stringify(root.version) ?? 'undefined'}`,
    );
  }
  if (typeof root.id !== 'string' || !ID.test(root.id)) fail('VALUE', 'id', 'must match [a-z0-9-]{1,32}');
  const name = root.name;
  if (typeof name !== 'string') fail('TYPE', 'name', 'must be a string');
  const nameLength = [...name].length;
  if (nameLength < 1 || nameLength > 64 || FORBIDDEN_IN_NAME.test(name)) {
    fail('VALUE', 'name', 'must be 1..64 well-formed characters without control characters');
  }

  const lights = fields(root.lights, 'lights', ['key', 'fill', 'rim']);
  const keyFields = fields(lights.key, 'lights.key', ['direction', 'color', 'angularRadius']);
  const keyDirection = direction(keyFields.direction, 'lights.key.direction');
  if (keyDirection[1] < MIN_KEY_Y) {
    fail('DIRECTION', 'lights.key.direction', 'must point at least 5 degrees above the horizon');
  }
  const key = {
    direction: keyDirection,
    color: color(keyFields.color, 'lights.key.color'),
    angularRadius: ranged(keyFields.angularRadius, 'lights.key.angularRadius', 0, 0.1),
  };

  const env = fields(root.environment, 'environment', ['kind', 'sky', 'ground']);
  const kind = literal(env.kind, 'environment.kind', 'dome', 'VALUE');
  const sky = color(env.sky, 'environment.sky');
  const ground = color(env.ground, 'environment.ground');
  // The dome's radiance runs from 1.25 ground − 0.25 sky straight down to 1.25 sky − 0.25 ground straight up.
  for (const c of [0, 1, 2] as const) {
    const dark = 1.25 * ground[c] - 0.25 * sky[c] < 0 ? 'ground' : 1.25 * sky[c] - 0.25 * ground[c] < 0 ? 'sky' : null;
    if (dark)
      fail('DOME', `environment.${dark}[${c}]`, 'is under a fifth of the other dome colour: the dome goes negative');
  }

  const backdrop = fields(root.backdrop, 'backdrop', ['top', 'bottom']);
  const catcher = fields(root.catcher, 'catcher', ['strength']);
  const tone = fields(root.toneMapping, 'toneMapping', ['kind', 'exposure', 'grade']);
  const grade = fields(tone.grade, 'toneMapping.grade', ['slope', 'offset', 'power', 'saturation']);

  return deepFreeze<LookPreset>({
    format,
    version: LOOK_FORMAT_VERSION,
    id: root.id,
    name,
    lights: { key, fill: directional(lights.fill, 'lights.fill'), rim: rimLight(lights.rim, 'lights.rim') },
    environment: { kind, sky, ground },
    backdrop: { top: color(backdrop.top, 'backdrop.top'), bottom: color(backdrop.bottom, 'backdrop.bottom') },
    catcher: { strength: ranged(catcher.strength, 'catcher.strength', 0, 1) },
    edges: edges(root.edges, 'edges'),
    toneMapping: {
      kind: literal(tone.kind, 'toneMapping.kind', 'agx', 'VALUE'),
      exposure: ranged(tone.exposure, 'toneMapping.exposure', -6, 6),
      grade: {
        slope: triple(grade.slope, 'toneMapping.grade.slope', 0, 4),
        offset: triple(grade.offset, 'toneMapping.grade.offset', -1, 1),
        power: triple(grade.power, 'toneMapping.grade.power', 0.1, 4),
        saturation: ranged(grade.saturation, 'toneMapping.grade.saturation', 0, 2),
      },
    },
  });
}
