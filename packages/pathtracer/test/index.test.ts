import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/pathtracer', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/pathtracer');
  });
});
