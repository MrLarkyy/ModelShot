import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/scene', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/scene');
  });
});
