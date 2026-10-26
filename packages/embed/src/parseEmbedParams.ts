import { EmbedError } from './EmbedError';
import {
  DEFAULT_EMBED_PARAMS,
  EMBED_ARMS,
  EMBED_CAMERA,
  EMBED_LOOKS,
  EMBED_PARAM_NAMES,
  EMBED_PARAMS_VERSION,
  MAX_MODEL_URL_CHARS,
  type EmbedParamName,
  type EmbedParams,
} from './EmbedParams';

export interface ParsedEmbedParams {
  readonly params: EmbedParams;
  /** Names that are not parameters of this version, ignored so an older frame tolerates a newer element. */
  readonly ignored: readonly string[];
}

// Plain decimals only: no exponent, plus sign, spaces, hex or Infinity, so a value reads one way only.
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// eslint-disable-next-line no-control-regex -- control characters are what this rejects
const CONTROL_OR_EDGE_SPACE = /[\u0000-\u001f\u007f]|^\s|\s$/;
const SHOWN_VALUE_CHARS = 16;

const isParamName = (name: string): name is EmbedParamName => (EMBED_PARAM_NAMES as readonly string[]).includes(name);

function invalid(name: string, message: string): never {
  throw new EmbedError('INVALID_PARAM', `${name} ${message}`, name);
}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(value)) invalid(name, `must be one of ${allowed.join(', ')}.`);
  return value as T;
}

function degrees(name: string, value: string, min: number, max: number): number {
  const number = DECIMAL.test(value) ? Number(value) : Number.NaN;
  if (!(number >= min && number <= max)) invalid(name, `must be a decimal number of degrees in ${min}..${max}.`);
  return number;
}

function flag(name: string, value: string): boolean {
  if (value === '' || value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return invalid(name, 'must be empty, true, 1, false or 0.');
}

function hexColor(name: string, value: string): string {
  if (!HEX_COLOR.test(value)) invalid(name, 'must be a colour written #rgb or #rrggbb.');
  const hex = value.slice(1).toLowerCase();
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join('')}` : `#${hex}`;
}

/** `value` as an absolute http(s) URL, a relative one resolved against `base` (the element passes the page's). */
function modelUrl(value: string | undefined, base: string | undefined): string {
  if (value === undefined || value === '') {
    throw new EmbedError(
      'MISSING_MODEL',
      'No model is given: set model to the URL of a .bbmodel, .glb, .gltf, .obj or skin .png file.',
      'model',
    );
  }
  const bad = (why: string): never => {
    throw new EmbedError('MODEL_URL_INVALID', `model ${why}`, 'model');
  };
  if (value.length > MAX_MODEL_URL_CHARS) bad(`is longer than ${MAX_MODEL_URL_CHARS} characters.`);
  if (CONTROL_OR_EDGE_SPACE.test(value)) bad('holds control characters or leading or trailing spaces.');
  let url: URL | null = null;
  try {
    url = new URL(value, base);
  } catch {
    bad('must be an absolute http or https URL.');
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return bad('must be an http or https URL.');
  if (url.username !== '' || url.password !== '') bad('must not carry a user name or password.');
  if (url.href.length > MAX_MODEL_URL_CHARS) bad(`is longer than ${MAX_MODEL_URL_CHARS} characters once resolved.`);
  return url.href;
}

/**
 * The embed parameters from name/value pairs (a URL fragment's or an element's attributes), or an `EmbedError`:
 * every known parameter is checked strictly and given at most once, `v` is absent or 1, unknown names are returned in
 * `ignored`. `base` resolves a relative model URL; without it the model URL must be absolute.
 */
export function parseEmbedParams(entries: Iterable<readonly [string, string]>, base?: string): ParsedEmbedParams {
  const given = new Map<EmbedParamName, string>();
  const ignored: string[] = [];
  for (const [name, value] of entries) {
    if (!isParamName(name)) {
      if (!ignored.includes(name)) ignored.push(name);
      continue;
    }
    if (given.has(name)) invalid(name, 'is given more than once.');
    given.set(name, value);
  }
  const version = given.get('v');
  if (version !== undefined && version !== String(EMBED_PARAMS_VERSION)) {
    throw new EmbedError(
      'UNSUPPORTED_VERSION',
      `This embed reads parameters of version ${EMBED_PARAMS_VERSION}, not "${version.slice(0, SHOWN_VALUE_CHARS)}".`,
      'v',
    );
  }
  const model = modelUrl(given.get('model'), base);
  const read = <T>(name: EmbedParamName, parse: (value: string) => T, fallback: T): T => {
    const value = given.get(name);
    return value === undefined ? fallback : parse(value);
  };
  const d = DEFAULT_EMBED_PARAMS;
  const c = EMBED_CAMERA;
  const params: EmbedParams = {
    model,
    look: read('look', (v) => oneOf('look', v, EMBED_LOOKS), d.look),
    yawDeg: read('yaw', (v) => degrees('yaw', v, c.minYawDeg, c.maxYawDeg), d.yawDeg),
    pitchDeg: read('pitch', (v) => degrees('pitch', v, c.minPitchDeg, c.maxPitchDeg), d.pitchDeg),
    fovDeg: read('fov', (v) => degrees('fov', v, c.minFovDeg, c.maxFovDeg), d.fovDeg),
    autorotate: read('autorotate', (v) => flag('autorotate', v), d.autorotate),
    background: read<string | null>('background', (v) => hexColor('background', v), d.background),
    arms: read('arms', (v) => oneOf('arms', v, EMBED_ARMS), d.arms),
  };
  return { params, ignored };
}
