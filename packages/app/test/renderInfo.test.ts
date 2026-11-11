import { describe, expect, it } from 'vitest';
import { formatElapsed, progressText, resultText } from '../src/render/renderInfo';

describe('formatElapsed', () => {
  it('counts minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_999)).toBe('0:59');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(3_600_000)).toBe('60:00');
  });

  it('clamps a negative or non-finite time to zero', () => {
    expect(formatElapsed(-5)).toBe('0:00');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
  });
});

describe('progressText', () => {
  it('shows samples, percent and elapsed', () => {
    expect(progressText(128, 256, 12_000)).toBe('128 / 256 samples · 50 % · 0:12');
  });

  it('rounds the percent', () => {
    expect(progressText(1, 3, 0)).toBe('1 / 3 samples · 33 % · 0:00');
    expect(progressText(2, 3, 0)).toBe('2 / 3 samples · 67 % · 0:00');
  });

  it('survives a target of zero or NaN', () => {
    expect(progressText(5, 0, 1000)).toBe('0 / 0 samples · 0 % · 0:01');
    expect(progressText(Number.NaN, Number.NaN, 0)).toBe('0 / 0 samples · 0 % · 0:00');
  });

  it('never passes 100 %', () => {
    expect(progressText(300, 256, 0)).toBe('256 / 256 samples · 100 % · 0:00');
  });
});

describe('resultText', () => {
  it('shows size, samples and time', () => {
    expect(resultText(1920, 1080, 256, 24_000)).toBe('1920 × 1080 px · 256 samples · 0:24');
  });
});
