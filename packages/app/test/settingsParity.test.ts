import { MAX_SUPERSAMPLE } from '@modelshot/pathtracer';
import { MAX_EXPORT_SIDE } from '@modelshot/export';
import { describe, expect, it } from 'vitest';
import { exportFileName } from '../src/export/downloadBlob';
import { MAX_SUPERSAMPLE_CHOICE } from '../src/render/RenderSettings';
import { readModelState } from '../src/state/readAppState';

describe('constants the page repeats so that the tracer and the export code load later', () => {
  it('the supersampling menu ends at the tracer maximum', () => {
    expect(MAX_SUPERSAMPLE_CHOICE).toBe(MAX_SUPERSAMPLE);
  });

  it('a stored export size is accepted up to the export side limit and not beyond', () => {
    const exportBlock = (width: number): Record<string, unknown> => ({
      kind: 'still',
      clipFormat: 'gif',
      width,
      height: 1,
      samples: 1,
      supersample: 1,
      denoise: false,
      transparent: true,
      fps: 24,
      frames: 4,
    });
    const base = {
      v: 1,
      camera: {
        yawDeg: 0,
        pitchDeg: 0,
        fovYDeg: 35,
        projection: 'perspective',
        distance: 1,
        orthoHeight: 1,
        target: [0, 0, 0],
      },
      look: 'studio',
      hiddenNodes: [],
      hiddenMeshes: [],
      render: { samples: 1, supersample: 1, denoise: false },
      savedAt: 1,
    };
    expect(readModelState({ ...base, export: exportBlock(MAX_EXPORT_SIDE) })?.export?.width).toBe(MAX_EXPORT_SIDE);
    expect(readModelState({ ...base, export: exportBlock(MAX_EXPORT_SIDE + 1) })).not.toHaveProperty('export');
  });
});

describe('exportFileName', () => {
  it.each([
    ['single-cube.bbmodel', 'png', 'single-cube-modelshot.png'],
    ['my model (v2).GLB', 'gif', 'my-model-v2-modelshot.gif'],
    ['../../etc/passwd.obj', 'webm', 'etc-passwd-modelshot.webm'],
    ['.bbmodel', 'png', 'model-modelshot.png'],
    ['', 'png', 'model-modelshot.png'],
    ['a.bbmodel', '../x', 'a-modelshot.x'],
  ])('names %j as %s', (name, extension, expected) => {
    expect(exportFileName(name, extension)).toBe(expected);
  });

  it('keeps a long name to 60 characters', () => {
    expect(exportFileName(`${'a'.repeat(200)}.obj`, 'png')).toBe(`${'a'.repeat(60)}-modelshot.png`);
  });
});
