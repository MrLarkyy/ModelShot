import type { SceneAnimation, SceneDocument } from '@modelshot/scene';

/** `doc` with one clip that turns every node about y over a second: a rotation channel per node. */
export function withSpinClip(doc: SceneDocument): SceneDocument {
  const clip: SceneAnimation = {
    name: 'spin',
    loop: 'loop',
    length: 1,
    channels: doc.nodes.map((_, node) => ({
      node,
      property: 'rotation' as const,
      keyframes: [
        { time: 0, value: [0, 0, 0] as [number, number, number], interpolation: 'linear' as const },
        { time: 1, value: [0, 90, 0] as [number, number, number], interpolation: 'linear' as const },
      ],
    })),
  };
  return { ...doc, animations: [clip] };
}
