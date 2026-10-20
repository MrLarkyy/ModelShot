import { describe, expect, it } from 'vitest';
import { packageName } from '../src/index';

describe('@modelshot/embed', () => {
  it('names itself', () => {
    expect(packageName).toBe('@modelshot/embed');
  });
});
