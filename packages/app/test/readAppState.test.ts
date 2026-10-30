import { describe, expect, it } from 'vitest';
import { APP_STATE_VERSION } from '../src/state/AppState';
import { readModelState, readSession } from '../src/state/readAppState';

const KEY = 'a'.repeat(64);

function camera(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    yawDeg: 210,
    pitchDeg: 20,
    fovYDeg: 35,
    projection: 'perspective',
    distance: 1,
    orthoHeight: 1,
    target: [0, 0, 0],
    ...fields,
  };
}

function model(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    camera: camera(),
    look: 'studio',
    hiddenNodes: [1],
    hiddenMeshes: [],
    render: { samples: 256, supersample: 1, denoise: false },
    savedAt: 1700000000000,
    ...fields,
  };
}

function withoutVersion(): Record<string, unknown> {
  const record = model();
  delete record['v'];
  return record;
}

function session(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, files: [new File(['{}'], 'a.bbmodel')], modelKey: KEY, savedAt: 1700000000000, ...fields };
}

describe('readModelState', () => {
  it('reads what the app writes', () => {
    expect(readModelState(model())).toMatchObject({ v: APP_STATE_VERSION, look: 'studio', hiddenNodes: [1] });
  });

  it.each([
    ['undefined', undefined],
    ['a string', 'x'],
    ['an array', []],
    ['another version', model({ v: 2 })],
    ['a missing version', withoutVersion()],
    ['a NaN camera value', model({ camera: camera({ yawDeg: NaN }) })],
    ['an infinite target', model({ camera: camera({ target: [0, Infinity, 0] }) })],
    ['a pitch out of range', model({ camera: camera({ pitchDeg: 120 }) })],
    ['a field of view out of range', model({ camera: camera({ fovYDeg: 5 }) })],
    ['an unknown projection', model({ camera: camera({ projection: 'fisheye' }) })],
    ['a zero distance', model({ camera: camera({ distance: 0 }) })],
    ['an unknown look', model({ look: 'evil' })],
    ['an inherited look name', model({ look: 'constructor' })],
    ['a look that is not a string', model({ look: 5 })],
    ['hidden indices that are not integers', model({ hiddenNodes: [1.5] })],
    ['negative hidden indices', model({ hiddenMeshes: [-1] })],
    ['too many hidden indices', model({ hiddenNodes: new Array(100_001).fill(0) })],
    ['render settings out of range', model({ render: { samples: 0, supersample: 1, denoise: false } })],
    ['a savedAt that is not a number', model({ savedAt: '1' })],
  ])('refuses %s', (_name, value) => {
    expect(readModelState(value)).toBeNull();
  });

  it('refuses a record whose fields are getters, and never runs them', () => {
    let ran = false;
    const tampered = Object.defineProperty(model(), 'look', {
      enumerable: true,
      get() {
        ran = true;
        return 'studio';
      },
    });
    expect(readModelState(tampered)).toBeNull();
    expect(ran).toBe(false);
  });

  it('drops an invalid export block but keeps the rest', () => {
    const state = readModelState(model({ export: { kind: 'still', width: -5 } }));
    expect(state).not.toBeNull();
    expect(state).not.toHaveProperty('export');
  });

  it('keeps valid texture filters and reads an older record without them', () => {
    expect(readModelState(model({ textureFilters: ['linear', 'nearest'] }))?.textureFilters).toEqual([
      'linear',
      'nearest',
    ]);
    expect(readModelState(model())).not.toHaveProperty('textureFilters');
  });

  it('drops invalid texture filters but keeps the rest', () => {
    for (const bad of [['smooth'], 'linear', [1], new Array(4097).fill('linear'), { length: 1, 0: 'linear' }]) {
      const state = readModelState(model({ textureFilters: bad }));
      expect(state).not.toBeNull();
      expect(state).not.toHaveProperty('textureFilters');
    }
  });

  it('keeps a valid export block and the arms', () => {
    const exportBlock = {
      kind: 'turntable',
      clipFormat: 'gif',
      width: 64,
      height: 64,
      samples: 8,
      supersample: 1,
      denoise: false,
      transparent: true,
      fps: 24,
      frames: 4,
    };
    const state = readModelState(model({ export: exportBlock, arms: 'slim' }));
    expect(state?.export).toEqual(exportBlock);
    expect(state?.arms).toBe('slim');
  });

  it('never throws on a hostile value', () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('boom');
        },
      },
    );
    expect(readModelState(hostile)).toBeNull();
    expect(readSession(hostile)).toBeNull();
  });
});

describe('readSession', () => {
  it('reads the files of a session', () => {
    const read = readSession(session());
    expect(read?.files).toHaveLength(1);
    expect(read?.modelKey).toBe(KEY);
  });

  it.each([
    ['another version', session({ v: 0 })],
    ['a key that is not a SHA-256', session({ modelKey: 'abc' })],
    ['a file list that is not an array', session({ files: 'x' })],
    ['an entry that is not a File', session({ files: [{ name: 'a.bbmodel', size: 1 }] })],
    ['a hole in the list', session({ files: [new File(['x'], 'a.bbmodel'), undefined] })],
    ['a file of a kind the app does not open', session({ files: [new File(['x'], 'run.exe')] })],
    ['no files', session({ files: [] })],
    ['too many files', session({ files: Array.from({ length: 33 }, (_, i) => new File(['x'], `${i}.bbmodel`)) })],
  ])('refuses %s', (_name, value) => {
    expect(readSession(value)).toBeNull();
  });
});
