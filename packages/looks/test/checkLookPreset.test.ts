import { describe, expect, it } from 'vitest';
import { checkLookPreset } from '../src/checkLookPreset';
import { LOOK_PRESETS } from '../src/lookPresets';
import { LookPresetError, type LookPresetErrorCode } from '../src/LookPresetError';
import { MAX_LOOK_PRESET_LENGTH, parseLookPreset } from '../src/parseLookPreset';
import studioText from '../src/presets/studio.json?raw';

type Json = Record<string, unknown>;

const studio = (): Json => JSON.parse(studioText) as Json;

/** A copy of the Studio file with the value at `path` (dots and [i]) replaced, or removed when `value` is omitted. */
function edit(path: string, ...value: unknown[]): Json {
  const root = studio();
  const keys = path.split(/\.|\[|\]/).filter(Boolean);
  let at: Record<string, unknown> = root;
  for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
  const last = keys[keys.length - 1] ?? '';
  if (value.length === 0) delete at[last];
  else at[last] = value[0];
  return root;
}

function failure(value: unknown): LookPresetError {
  try {
    checkLookPreset(value);
  } catch (error) {
    if (error instanceof LookPresetError) return error;
    throw error;
  }
  throw new Error('accepted');
}

const expectError = (value: unknown, code: LookPresetErrorCode, path: string): void => {
  const error = failure(value);
  expect({ code: error.code, path: error.path }).toEqual({ code, path });
  expect(error.message.startsWith(path)).toBe(true);
};

describe('checkLookPreset', () => {
  it('round-trips every shipped preset to an equal, frozen copy', () => {
    for (const look of Object.values(LOOK_PRESETS)) {
      const again = checkLookPreset(JSON.parse(JSON.stringify(look)));
      expect(again).toEqual(look);
      expect(again).not.toBe(look);
      expect(Object.isFrozen(again)).toBe(true);
      expect(Object.isFrozen(again.lights.key.direction)).toBe(true);
      expect(Object.isFrozen(again.toneMapping.grade.slope)).toBe(true);
    }
  });

  it('copies: changing the input afterwards changes nothing', () => {
    const input = studio();
    const look = checkLookPreset(input);
    (input['backdrop'] as Json)['top'] = [9, 9, 9];
    expect(look.backdrop.top).toEqual([0.14, 0.15, 0.17]);
  });

  it('normalises a direction, keeping one within 1e-4 of unit length as written', () => {
    expect(checkLookPreset(edit('lights.rim.direction', [0, 0, 2])).lights.rim.direction).toEqual([0, 0, 1]);
    const v0 = checkLookPreset(studio()).lights.key.direction;
    expect(v0).toEqual([0.39904, 0.79808, 0.4514]);
  });

  const edges: [string, number, number][] = [
    ['lights.key.color[0]', 0, 16],
    ['lights.fill.color[2]', 0, 16],
    ['backdrop.top[1]', 0, 16],
    ['lights.key.angularRadius', 0, 0.1],
    ['catcher.strength', 0, 1],
    ['toneMapping.exposure', -6, 6],
    ['toneMapping.grade.slope[0]', 0, 4],
    ['toneMapping.grade.offset[1]', -1, 1],
    ['toneMapping.grade.power[2]', 0.1, 4],
    ['toneMapping.grade.saturation', 0, 2],
    ['edges.width', 0, 4],
    ['edges.sharpAngleDeg', 1, 179],
  ];
  for (const [path, min, max] of edges) {
    it(`${path}: ${min} and ${max} pass, beyond fails naming the field`, () => {
      expect(() => checkLookPreset(edit(path, min))).not.toThrow();
      expect(() => checkLookPreset(edit(path, max))).not.toThrow();
      const step = Math.max(1e-6, (max - min) * 1e-6);
      expectError(edit(path, min - step), 'RANGE', path);
      expectError(edit(path, max + step), 'RANGE', path);
    });
  }

  it('rejects NaN, Infinity and numbers as strings', () => {
    expectError(edit('catcher.strength', NaN), 'TYPE', 'catcher.strength');
    expectError(edit('toneMapping.exposure', Infinity), 'TYPE', 'toneMapping.exposure');
    expectError(edit('lights.key.color[1]', '1.2'), 'TYPE', 'lights.key.color[1]');
    expectError(edit('edges.width', '0.5'), 'TYPE', 'edges.width');
  });

  it('rejects unknown keys at every level, missing fields and wrong shapes', () => {
    expectError({ ...studio(), extra: 1 }, 'UNKNOWN_KEY', 'extra');
    expectError(edit('lights.key.intensity', 2), 'UNKNOWN_KEY', 'lights.key.intensity');
    expectError(edit('edges.roundness', 1), 'UNKNOWN_KEY', 'edges.roundness');
    expectError(JSON.parse('{"__proto__": {"x": 1}}'), 'UNKNOWN_KEY', '__proto__');
    expectError(edit('lights.rim'), 'MISSING', 'lights.rim');
    expectError(edit('edges.sharpAngleDeg'), 'MISSING', 'edges.sharpAngleDeg');
    expectError(edit('backdrop.top', [1, 1]), 'TYPE', 'backdrop.top');
    expectError(edit('lights', []), 'TYPE', 'lights');
    expectError(null, 'TYPE', '');
    expectError('studio', 'TYPE', '');
  });

  it('requires format modelshot-look and version 1, naming a newer version', () => {
    expectError(edit('format', 'other-look'), 'FORMAT', 'format');
    expectError(edit('version', 0), 'VERSION', 'version');
    expectError(edit('version', '1'), 'VERSION', 'version');
    expect(failure(edit('version', 2)).message).toMatch(/newer than this build reads/);
    expectError(edit('environment.kind', 'hdri'), 'VALUE', 'environment.kind');
    expectError(edit('toneMapping.kind', 'aces'), 'VALUE', 'toneMapping.kind');
  });

  it('checks id and name', () => {
    expectError(edit('id', 'Studio'), 'VALUE', 'id');
    expectError(edit('id', 'a'.repeat(33)), 'VALUE', 'id');
    expectError(edit('name', ''), 'VALUE', 'name');
    expectError(edit('name', 'x'.repeat(65)), 'VALUE', 'name');
    expectError(edit('name', 'a\nb'), 'VALUE', 'name');
    expectError(edit('name', 3), 'TYPE', 'name');
  });

  it('rejects a zero direction and a key under 5 degrees', () => {
    expectError(edit('lights.fill.direction', [0, 0, 0]), 'DIRECTION', 'lights.fill.direction');
    const below = Math.sin((4.9 * Math.PI) / 180);
    expectError(
      edit('lights.key.direction', [Math.sqrt(1 - below * below), below, 0]),
      'DIRECTION',
      'lights.key.direction',
    );
    const above = Math.sin((5.1 * Math.PI) / 180);
    expect(() => checkLookPreset(edit('lights.key.direction', [Math.sqrt(1 - above * above), above, 0]))).not.toThrow();
  });

  it('rejects a dome that goes negative', () => {
    expectError(edit('environment.ground', [0.01, 0.19, 0.18]), 'DOME', 'environment.ground[0]');
    expectError(edit('environment.sky', [0.5, 0.52, 0.01]), 'DOME', 'environment.sky[2]');
  });
});

describe('parseLookPreset', () => {
  it('parses the shipped files', () => {
    expect(parseLookPreset(studioText)).toEqual(LOOK_PRESETS['studio']);
  });

  it('refuses text over the limit before parsing it', () => {
    const padded = studioText + ' '.repeat(MAX_LOOK_PRESET_LENGTH - studioText.length);
    expect(() => parseLookPreset(padded)).not.toThrow();
    const error = (() => {
      try {
        parseLookPreset(`${padded} `);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(LookPresetError);
    expect((error as LookPresetError).code).toBe('TOO_LARGE');
  });

  it('reports text that is not JSON as SYNTAX', () => {
    expect(() => parseLookPreset('{"format": ')).toThrow(expect.objectContaining({ code: 'SYNTAX' }) as Error);
  });

  it('a deeply nested value fails on its type at once', () => {
    const depth = 30_000;
    const text = JSON.stringify({ ...studio(), lights: 'nested' }).replace(
      '"nested"',
      '['.repeat(depth) + ']'.repeat(depth),
    );
    expect(text.length).toBeLessThanOrEqual(MAX_LOOK_PRESET_LENGTH);
    expect(() => parseLookPreset(text)).toThrow(expect.objectContaining({ code: 'TYPE', path: 'lights' }) as Error);
  });
});
