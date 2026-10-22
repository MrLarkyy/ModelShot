import { describe, expect, it } from 'vitest';
import { EDGE_LOOK_V0 } from '../src/EdgeLook';
import { LIGHT_RIG_V0 } from '../src/lightRig';
import { lightingKey } from '../src/lightingKey';
import type { LookKeyLight } from '../src/LookPreset';
import { DEFAULT_LOOK, LOOK_PRESETS } from '../src/lookPresets';

describe('shipped look presets', () => {
  it('ship Studio, Marketplace and Rim, Studio the default', () => {
    expect(Object.keys(LOOK_PRESETS)).toEqual(['studio', 'marketplace', 'rim']);
    expect(LOOK_PRESETS['studio']).toBe(DEFAULT_LOOK);
    expect(Object.isFrozen(LOOK_PRESETS)).toBe(true);
  });

  it('Studio is the v0 look: LIGHT_RIG_V0, EDGE_LOOK_V0, the v0 backdrop and a neutral AgX', () => {
    expect(DEFAULT_LOOK.lights).toEqual(LIGHT_RIG_V0.lights);
    expect(DEFAULT_LOOK.environment).toEqual(LIGHT_RIG_V0.environment);
    expect(DEFAULT_LOOK.catcher).toEqual(LIGHT_RIG_V0.catcher);
    expect(DEFAULT_LOOK.edges).toEqual(EDGE_LOOK_V0);
    expect(DEFAULT_LOOK.backdrop).toEqual({ top: [0.14, 0.15, 0.17], bottom: [0.14, 0.15, 0.17] });
    expect(DEFAULT_LOOK.toneMapping).toEqual({
      kind: 'agx',
      exposure: 0,
      grade: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1 },
    });
  });

  it('every preset rounds edges at 30 degrees, so a switch never detects sharp edges again', () => {
    for (const look of Object.values(LOOK_PRESETS)) expect(look.edges.sharpAngleDeg).toBe(30);
  });
});

describe('lightingKey', () => {
  const withKey = (change: Partial<LookKeyLight>) => ({
    ...DEFAULT_LOOK,
    lights: { ...DEFAULT_LOOK.lights, key: { ...DEFAULT_LOOK.lights.key, ...change } },
  });

  it('differs between the presets and ignores what applies at draw time', () => {
    const keys = Object.values(LOOK_PRESETS).map(lightingKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(lightingKey({ ...withKey({ color: [9, 9, 9] }), catcher: { strength: 0.2 } })).toBe(
      lightingKey(DEFAULT_LOOK),
    );
    expect(lightingKey(LIGHT_RIG_V0)).toBe(lightingKey(DEFAULT_LOOK));
  });

  it('changes with the key direction, its disc and the dome', () => {
    const base = lightingKey(DEFAULT_LOOK);
    expect(lightingKey(withKey({ angularRadius: 0.05 }))).not.toBe(base);
    expect(lightingKey(withKey({ direction: [0, 1, 0] }))).not.toBe(base);
    const sky = { ...DEFAULT_LOOK, environment: { ...DEFAULT_LOOK.environment, sky: [0.5, 0.52, 0.56] as const } };
    expect(lightingKey(sky)).not.toBe(base);
  });
});
