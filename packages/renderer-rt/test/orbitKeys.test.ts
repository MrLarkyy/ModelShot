import { describe, expect, it } from 'vitest';
import { orbitKeyAction } from '../src/index';

describe('orbitKeyAction', () => {
  it('maps arrows to orbit and shift + arrows to pan', () => {
    expect(orbitKeyAction('ArrowLeft', false)).toEqual({ kind: 'rotate', yawDeg: -7.5, pitchDeg: 0 });
    expect(orbitKeyAction('ArrowUp', false)).toEqual({ kind: 'rotate', yawDeg: 0, pitchDeg: 7.5 });
    expect(orbitKeyAction('ArrowRight', true)).toEqual({ kind: 'pan', dxPx: 24, dyPx: -0 });
    expect(orbitKeyAction('ArrowDown', true)).toEqual({ kind: 'pan', dxPx: 0, dyPx: 24 });
  });

  it('maps zoom, reset, projection and isometric keys', () => {
    expect(orbitKeyAction('+', true)).toEqual({ kind: 'zoom', factor: 1 / 1.15 });
    expect(orbitKeyAction('-', false)).toEqual({ kind: 'zoom', factor: 1.15 });
    expect(orbitKeyAction('Home', false)).toEqual({ kind: 'reset' });
    expect(orbitKeyAction('0', false)).toEqual({ kind: 'reset' });
    expect(orbitKeyAction('O', true)).toEqual({ kind: 'toggleProjection' });
    expect(orbitKeyAction('i', false)).toEqual({ kind: 'isometric' });
  });

  it('leaves other keys to the page', () => {
    for (const key of ['a', 'Tab', 'Enter', ' ', 'constructor', 'toString'])
      expect(orbitKeyAction(key, false)).toBeNull();
  });
});
