import { LOOK_PRESETS } from '@modelshot/looks';
import { MAX_FOV_DEG, MAX_PITCH_DEG, MIN_FOV_DEG, MIN_PITCH_DEG } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { EmbedError } from '../src/EmbedError';
import { DEFAULT_EMBED_PARAMS, EMBED_CAMERA, EMBED_LOOKS } from '../src/EmbedParams';
import { parseEmbedFragment } from '../src/parseEmbedFragment';
import { parseEmbedParams } from '../src/parseEmbedParams';

const MODEL = 'https://models.example/a/cube.bbmodel';

const parse = (extra: Record<string, string>, base?: string) =>
  parseEmbedParams(Object.entries({ model: MODEL, ...extra }), base);

function failure(run: () => unknown): EmbedError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EmbedError);
    return error as EmbedError;
  }
  throw new Error('expected an EmbedError');
}

describe('parseEmbedParams', () => {
  it('fills in every default', () => {
    expect(parse({})).toEqual({ params: { model: MODEL, ...DEFAULT_EMBED_PARAMS }, ignored: [] });
  });

  it('reads every parameter', () => {
    const { params } = parse({
      v: '1',
      look: 'marketplace',
      yaw: '-12.5',
      pitch: '30',
      fov: '50',
      autorotate: '1',
      background: '#1B2A4A',
      arms: 'slim',
    });
    expect(params).toEqual({
      model: MODEL,
      look: 'marketplace',
      yawDeg: -12.5,
      pitchDeg: 30,
      fovDeg: 50,
      autorotate: true,
      background: '#1b2a4a',
      arms: 'slim',
    });
  });

  it('keeps the camera ranges and defaults of the orbit controller and the app viewer', () => {
    expect(EMBED_CAMERA.minPitchDeg).toBe(MIN_PITCH_DEG);
    expect(EMBED_CAMERA.maxPitchDeg).toBe(MAX_PITCH_DEG);
    expect(EMBED_CAMERA.minFovDeg).toBe(MIN_FOV_DEG);
    expect(EMBED_CAMERA.maxFovDeg).toBe(MAX_FOV_DEG);
  });

  it('offers exactly the look presets that ship', () => {
    expect([...EMBED_LOOKS].sort()).toEqual(Object.keys(LOOK_PRESETS).sort());
  });

  it.each([
    ['yaw', '-360', -360],
    ['yaw', '360', 360],
    ['pitch', '-89.5', -89.5],
    ['pitch', '89.5', 89.5],
    ['fov', '10', 10],
    ['fov', '100', 100],
  ])('accepts %s at its boundary %s', (name, value, expected) => {
    const { params } = parse({ [name]: value });
    const key = { yaw: 'yawDeg', pitch: 'pitchDeg', fov: 'fovDeg' }[name] as 'yawDeg' | 'pitchDeg' | 'fovDeg';
    expect(params[key]).toBe(expected);
  });

  it.each([
    ['yaw', '360.01'],
    ['yaw', '-361'],
    ['pitch', '90'],
    ['fov', '9.99'],
    ['fov', '101'],
    ['yaw', 'NaN'],
    ['yaw', 'Infinity'],
    ['yaw', '1e400'],
    ['yaw', '1e2'],
    ['yaw', ' 20'],
    ['yaw', '20 '],
    ['yaw', '+20'],
    ['yaw', '0x10'],
    ['yaw', ''],
    ['yaw', '.5'],
    ['look', 'Studio'],
    ['look', 'neon'],
    ['look', ''],
    ['arms', 'wide'],
    ['autorotate', 'yes'],
    ['autorotate', 'TRUE'],
    ['background', '#abcd'],
    ['background', 'red'],
    ['background', '1b2a4a'],
    ['background', '#12345g'],
    ['background', ''],
  ])('refuses %s=%j naming it', (name, value) => {
    const error = failure(() => parse({ [name]: value }));
    expect(error.code).toBe('INVALID_PARAM');
    expect(error.param).toBe(name);
    expect(error.message).toMatch(new RegExp(`^${name} `));
  });

  it.each([
    ['', true],
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads autorotate=%j as %s', (value, expected) => {
    expect(parse({ autorotate: value }).params.autorotate).toBe(expected);
  });

  it.each([
    ['#abc', '#aabbcc'],
    ['#AABBCC', '#aabbcc'],
    ['#000000', '#000000'],
  ])('normalises background %s to %s', (value, expected) => {
    expect(parse({ background: value }).params.background).toBe(expected);
  });

  it('refuses a parameter given twice', () => {
    const error = failure(() =>
      parseEmbedParams([
        ['model', MODEL],
        ['look', 'rim'],
        ['look', 'rim'],
      ]),
    );
    expect(error.code).toBe('INVALID_PARAM');
    expect(error.param).toBe('look');
  });

  it('ignores and reports unknown names once each', () => {
    const { ignored } = parseEmbedParams([
      ['model', MODEL],
      ['zoom', '2'],
      ['zoom', '3'],
      ['loading', 'eager'],
    ]);
    expect(ignored).toEqual(['zoom', 'loading']);
  });

  it.each(['2', '0', 'one', ''])('refuses v=%j', (v) => {
    expect(failure(() => parse({ v })).code).toBe('UNSUPPORTED_VERSION');
  });

  it('wants a model', () => {
    expect(failure(() => parseEmbedParams([])).code).toBe('MISSING_MODEL');
    expect(failure(() => parseEmbedParams([['model', '']])).code).toBe('MISSING_MODEL');
  });

  it.each([
    'javascript:alert(1)',
    'data:application/json,{}',
    'blob:https://models.example/0b5c',
    'file:///C:/models/cube.bbmodel',
    'ftp://models.example/cube.bbmodel',
    'cube.bbmodel',
    '/a/cube.bbmodel',
    'https://user:secret@models.example/cube.bbmodel',
    'https://user@models.example/cube.bbmodel',
    ' https://models.example/cube.bbmodel',
    'https://models.example/cube.bbmodel\n',
    'https://models.example/\u0000cube.bbmodel',
    `https://models.example/${'a'.repeat(2049 - 'https://models.example/'.length)}`,
  ])('refuses the model URL %j', (model) => {
    const error = failure(() => parseEmbedParams([['model', model]]));
    expect(error.code).toBe('MODEL_URL_INVALID');
    expect(error.param).toBe('model');
  });

  it('accepts a model URL of exactly 2048 characters', () => {
    const model = `https://models.example/${'a'.repeat(2048 - 'https://models.example/'.length)}`;
    expect(parseEmbedParams([['model', model]]).params.model).toBe(model);
  });

  it('resolves a relative model URL against the given base', () => {
    const { params } = parseEmbedParams([['model', '../m/cube.bbmodel']], 'https://wiki.example/pages/one.html');
    expect(params.model).toBe('https://wiki.example/m/cube.bbmodel');
  });
});

describe('parseEmbedFragment', () => {
  it('reads the fragment with or without #', () => {
    const fragment = `v=1&model=${encodeURIComponent(MODEL)}&look=rim`;
    expect(parseEmbedFragment(`#${fragment}`).params.look).toBe('rim');
    expect(parseEmbedFragment(fragment).params.model).toBe(MODEL);
  });

  it('decodes an encoded model URL with + and & in it', () => {
    const model = 'https://models.example/a+b.bbmodel?x=1&y=2';
    expect(parseEmbedFragment(`#model=${encodeURIComponent(model)}`).params.model).toBe(model);
  });

  it('refuses a fragment longer than 4096 characters', () => {
    const fragment = `model=${encodeURIComponent(MODEL)}&pad=`;
    const long = fragment + 'x'.repeat(4097 - fragment.length);
    expect(failure(() => parseEmbedFragment(`#${long}`)).code).toBe('INVALID_PARAM');
    expect(parseEmbedFragment(`#${long.slice(0, 4096)}`).ignored).toEqual(['pad']);
  });
});
