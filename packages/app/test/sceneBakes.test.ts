import { describe, expect, it } from 'vitest';
import { sceneBakes } from '../src/session/sceneBakes';

const flags = [false, true];

describe('sceneBakes', () => {
  for (const sceneChanged of flags) {
    for (const lookChanged of flags) {
      for (const reposes of flags) {
        it(`scene ${sceneChanged}, look ${lookChanged}, clip pose ${reposes}: one bake when something lit changed`, () => {
          const bakes = sceneBakes({ sceneChanged, lookChanged, reposes });
          const count = Number(bakes.document) + Number(bakes.look) + Number(bakes.relight);
          expect(count).toBe(sceneChanged || lookChanged ? 1 : 0);
        });
      }
    }
  }

  it('bakes the final state: the pose shown, else the new look over the new scene', () => {
    expect(sceneBakes({ sceneChanged: true, lookChanged: true, reposes: true })).toEqual({
      document: false,
      look: false,
      relight: true,
    });
    expect(sceneBakes({ sceneChanged: true, lookChanged: true, reposes: false })).toEqual({
      document: false,
      look: true,
      relight: false,
    });
    expect(sceneBakes({ sceneChanged: true, lookChanged: false, reposes: false }).document).toBe(true);
    expect(sceneBakes({ sceneChanged: false, lookChanged: true, reposes: true }).look).toBe(true);
  });
});
