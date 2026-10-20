import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/looks', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/looks');
  });
});
