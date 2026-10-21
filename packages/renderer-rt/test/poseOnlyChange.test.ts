import { poseScene } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { lightmapLayout } from '../src/lightmapLayout';
import { poseOnlyChange } from '../src/poseOnlyChange';
import { quadScene } from './testScene';

const pose = { name: 'p', bones: [{ bone: 'root', rotation: [10, 20, 30] as [number, number, number] }] };

describe('poseOnlyChange', () => {
  it('holds for another pose of the same document, posed again or back at rest', () => {
    const doc = quadScene();
    const posed = poseScene(doc, pose).document;
    expect(poseOnlyChange(doc, posed)).toBe(true);
    expect(poseOnlyChange(posed, poseScene(posed, null).document)).toBe(true);
    // What it lets the renderer keep is what a fresh layout of the posed document gives.
    expect(lightmapLayout(posed).layoutKey).toBe(lightmapLayout(doc).layoutKey);
  });

  it('fails for other meshes, materials or textures, or another rest pose, pivot, hierarchy or visibility', () => {
    const doc = quadScene();
    const node = doc.nodes[0]!;
    expect(poseOnlyChange(doc, { ...doc, meshes: [...doc.meshes] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, materials: [...doc.materials] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, textures: [...doc.textures] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, nodes: [{ ...node, rotation: [0, 0, 5] }] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, nodes: [{ ...node, pivot: [1, 0, 0] }] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, nodes: [{ ...node, visible: false }] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, nodes: [{ ...node, meshes: [] }] })).toBe(false);
    expect(poseOnlyChange(doc, { ...doc, nodes: [] })).toBe(false);
  });
});
