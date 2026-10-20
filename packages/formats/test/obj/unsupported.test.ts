import { describe, expect, it } from 'vitest';
import { loadObj } from '../../src/index';
import { lines, QUAD, QUAD_FACE } from './fixtures';

const warn = (text: string) => loadObj(text).warnings.map((w) => [w.code, w.path, w.message]);

describe('reported OBJ features', () => {
  it('unsupported statements are reported once per keyword, with their count and first line', () => {
    const text = lines(
      ...QUAD,
      'l 1 2',
      'p 1',
      'l 2 3',
      'cstype bspline',
      'curv 0 1 1 2',
      'surf 0 1 0 1 1 2 3',
      'vp 0.5',
      'lod 1',
      'zz 1',
      QUAD_FACE,
    );
    expect(warn(text)).toEqual([
      ['UNSUPPORTED_STATEMENT', 'model.obj:10', 'Statement ignored at model.obj:10: "l" (2 lines) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:11', 'Statement ignored at model.obj:11: "p" (1 line) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:13', 'Statement ignored at model.obj:13: "cstype" (1 line) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:14', 'Statement ignored at model.obj:14: "curv" (1 line) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:15', 'Statement ignored at model.obj:15: "surf" (1 line) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:16', 'Statement ignored at model.obj:16: "vp" (1 line) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:17', 'Statement ignored at model.obj:17: "lod" (1 line) is not drawn'],
      ['UNSUPPORTED_STATEMENT', 'model.obj:18', 'Statement ignored at model.obj:18: "zz" (1 line) is not drawn'],
    ]);
  });

  it('vertex colours are reported once; the positions load', () => {
    const text = lines('v 0 0 0 1 0 0', 'v 1 0 0 0 1 0', 'v 0 1 0 0 0 1', 'f 1 2 3');
    const { scene, warnings } = loadObj(text, { unitScale: 1 });
    expect([...scene.meshes[0]!.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_VERTEX_COLOR', 'model.obj:1']]);
  });

  it('smoothing groups without any vn are reported once; with vn or s off they are not', () => {
    const flat = lines('v 0 0 0', 'v 1 0 0', 'v 0 1 0', 's 1', 'f 1 2 3', 's 2', 'f 1 2 3');
    expect(warn(flat).map(([code, path]) => [code, path])).toEqual([['SMOOTHING_IGNORED', 'model.obj:4']]);
    expect(warn(lines('v 0 0 0', 'v 1 0 0', 'v 0 1 0', 's off', 'f 1 2 3'))).toEqual([]);
    expect(warn(lines(...QUAD, 's 1', QUAD_FACE))).toEqual([]);
  });

  it('a keyword longer than 32 characters is quoted shortened', () => {
    const [[, , message] = []] = warn(lines(...QUAD, `${'A'.repeat(40)} 1`, QUAD_FACE));
    expect(message).not.toMatch(/A{33}/);
  });
});
