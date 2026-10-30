import type { SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { textureFilters, withTextureFilters } from '../src/session/withTextureFilters';

const texture = (filter?: 'nearest' | 'linear'): SceneDocument['textures'][number] =>
  ({ name: 't', ...(filter ? { filter } : {}) }) as never;
const doc = { textures: [texture(), texture('linear')] } as unknown as SceneDocument;

describe('withTextureFilters', () => {
  it('reads nearest for a texture without a filter', () => {
    expect(textureFilters(doc)).toEqual(['nearest', 'linear']);
  });

  it('returns the same document when nothing changes', () => {
    expect(withTextureFilters(doc, ['nearest', 'linear'])).toBe(doc);
    expect(withTextureFilters(doc, [])).toBe(doc);
  });

  it('replaces only the textures that change and ignores indices past the end', () => {
    const changed = withTextureFilters(doc, ['linear', 'linear', 'nearest']);
    expect(changed.textures[0]?.filter).toBe('linear');
    expect(changed.textures[1]).toBe(doc.textures[1]);
    expect(changed.textures).toHaveLength(2);
    expect(doc.textures[0]).not.toHaveProperty('filter');
  });
});
