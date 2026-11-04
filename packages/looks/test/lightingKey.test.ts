import { describe, expect, it } from 'vitest';
import { lightingKey } from '../src/lightingKey';
import type { LookHdriEnvironment, LookPreset } from '../src/LookPreset';
import { LOOK_PRESETS } from '../src/lookPresets';

const preset = (id: string): LookPreset => {
  const look = LOOK_PRESETS[id];
  if (!look) throw new Error(`no preset ${id}`);
  return look;
};

const withImage = (change: Partial<LookHdriEnvironment>): LookPreset => {
  const softbox = preset('softbox');
  if (softbox.environment.kind !== 'hdri') throw new Error('softbox is lit by an image');
  return { ...softbox, environment: { ...softbox.environment, ...change } };
};

describe('lightingKey', () => {
  // MS-47: every dome key reads as it did before images existed, so a stored bake of a dome look stays valid.
  it.each([
    ['studio', 'look-light:[[0.39904,0.79808,0.4514],0.04,[0.5,0.52,0.55],[0.2,0.19,0.18]]'],
    [
      'marketplace',
      'look-light:[[0.5063696835418333,0.6582805886043833,-0.5570066518960167],0.06,[0.2,0.24,0.4],[0.07,0.07,0.11]]',
    ],
    [
      'rim',
      'look-light:[[0.30036064929872747,0.6007212985974549,-0.7408896016035278],0.04,[0.08,0.08,0.09],[0.03,0.03,0.035]]',
    ],
  ])('%s: the pinned dome key', (id, key) => {
    expect(lightingKey(preset(id))).toBe(key);
  });

  it('softbox: the image, its intensity and its rotation, after the key', () => {
    expect(lightingKey(preset('softbox'))).toBe(
      'look-light:[[-0.5014059075751371,0.62174332539317,-0.6016870890901646],0.08,"hdri","softbox-studio",1,0]',
    );
  });

  it('an image look differs from every dome look and changes with intensity and rotation', () => {
    const base = lightingKey(preset('softbox'));
    for (const id of ['studio', 'marketplace', 'rim']) expect(lightingKey(preset(id))).not.toBe(base);
    expect(lightingKey(withImage({ intensity: 2 }))).not.toBe(base);
    expect(lightingKey(withImage({ rotationDeg: 90 }))).not.toBe(base);
    expect(lightingKey(withImage({ rotationDeg: 0 }))).toBe(base);
  });
});
