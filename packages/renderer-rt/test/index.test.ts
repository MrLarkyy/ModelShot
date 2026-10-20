import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/renderer-rt', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/renderer-rt');
  });
});
