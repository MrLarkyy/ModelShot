import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/formats', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/formats');
  });
});
