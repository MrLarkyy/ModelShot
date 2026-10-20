import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/export', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/export');
  });
});
