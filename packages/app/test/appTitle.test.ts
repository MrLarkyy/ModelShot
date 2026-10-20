import { describe, expect, it } from 'vitest';
import { appTitle } from '../src/appTitle';

describe('appTitle', () => {
  it('returns the product name', () => {
    expect(appTitle()).toBe('ModelShot');
  });
});
