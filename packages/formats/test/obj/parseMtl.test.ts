import { describe, expect, it } from 'vitest';
import { BLEND_ALPHA_CUTOFF, loadObj } from '../../src/index';
import { encodeSolidPng } from '../../src/png/encodeSolidPng';
import { pngHeader } from '../bbmodel/fixtures';
import { expectObjError, lines, QUAD, QUAD_FACE } from './fixtures';

const PNG = encodeSolidPng([1, 2, 3, 255]);
const encode = (text: string) => new TextEncoder().encode(text);

function withMtl(mtl: string, files: [string, Uint8Array][] = [], use = 'm') {
  const obj = lines('mtllib lib.mtl', ...QUAD, `usemtl ${use}`, QUAD_FACE);
  return loadObj(obj, { files: new Map([['lib.mtl', encode(mtl)], ...files]) });
}

/** The RGBA pixel stored in a 1×1 PNG from `encodeSolidPng`. */
function solidPixel(bytes: Uint8Array | null): number[] {
  if (!bytes) throw new Error('no bytes');
  return [...bytes.slice(33 + 8 + 8, 33 + 8 + 12)];
}

describe('parseMtl', () => {
  it('Kd alone: opaque, the colour as sRGB bytes in a 1×1 texture, centre UVs', () => {
    const { scene, warnings } = withMtl(lines('newmtl m', 'Kd 1 0.5 0'));
    expect(scene.materials).toEqual([{ name: 'm', texture: 0, alphaMode: 'opaque' }]);
    expect(solidPixel(scene.textures[0]!.bytes)).toEqual([255, 128, 0, 255]);
    expect([...scene.meshes[0]!.uvs.slice(0, 2)]).toEqual([0.5, 0.5]);
    expect(warnings).toEqual([]);
  });

  it('d < 1, or Tr > 0 without d: blend with only byte 0 hidden, opacity in the texture alpha', () => {
    const d = withMtl(lines('newmtl m', 'Kd 0 0 1', 'd 0.5'));
    expect(d.scene.materials[0]).toEqual({
      name: 'm',
      texture: 0,
      alphaMode: 'blend',
      alphaCutoff: BLEND_ALPHA_CUTOFF,
    });
    expect(solidPixel(d.scene.textures[0]!.bytes)).toEqual([0, 0, 255, 128]);
    const tr = withMtl(lines('newmtl m', 'Tr 0.25'));
    expect(solidPixel(tr.scene.textures[0]!.bytes)).toEqual([255, 255, 255, 191]);
    const both = withMtl(lines('newmtl m', 'd 1', 'Tr 0.5'));
    expect(both.scene.materials[0]!.alphaMode).toBe('opaque');
  });

  it('map_Kd: the picked PNG, blend, its UVs and face rectangles; Kd beside it is reported', () => {
    const { scene, warnings } = withMtl(lines('newmtl m', 'Kd 0.5 0.5 0.5', 'map_Kd tex/Wood Grain.png'), [
      ['wood grain.png', PNG],
    ]);
    expect(scene.materials[0]).toMatchObject({ alphaMode: 'blend', alphaCutoff: BLEND_ALPHA_CUTOFF });
    expect(scene.textures[0]).toMatchObject({ name: 'Wood Grain.png', width: 1, missing: false });
    expect([...scene.meshes[0]!.uvs]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect([...scene.meshes[0]!.uvRects.slice(0, 4)]).toEqual([0, 0, 1, 1]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['BASE_COLOR_FACTOR_IGNORED', 'lib.mtl:1']]);
  });

  it('map_Kd options are reported and skipped; the file name is the rest of the line', () => {
    const mtl = lines('newmtl m', 'map_Kd -o 0.5 0.5 -s 2 2 2 -clamp on -bm 1 my tex.png');
    const { scene, warnings } = withMtl(mtl, [['my tex.png', PNG]]);
    expect(scene.textures[0]).toMatchObject({ name: 'my tex.png', missing: false });
    expect(warnings.map((w) => [w.code, w.message])).toEqual([
      ['UNSUPPORTED_MAP_OPTION', 'Texture map options ignored at lib.mtl:1: -o -s -clamp -bm of map_Kd in "m"'],
    ]);
  });

  it('a missing or non-PNG map is drawn missing with a warning; an oversized one fails', () => {
    const missing = withMtl(lines('newmtl m', 'map_Kd gone.png'));
    expect(missing.scene.textures[0]!.missing).toBe(true);
    expect(missing.warnings.map((w) => w.code)).toEqual(['MISSING_RESOURCE']);
    const remote = withMtl(lines('newmtl m', 'map_Kd https://example.com/a.png'));
    expect(remote.warnings[0]!.message).toMatch(/not fetched/);
    const jpeg = withMtl(lines('newmtl m', 'map_Kd a.jpg'), [['a.jpg', new Uint8Array([0xff, 0xd8, 0xff])]]);
    expect(jpeg.scene.textures[0]!.missing).toBe(true);
    expect(jpeg.warnings.map((w) => w.code)).toEqual(['UNSUPPORTED_IMAGE']);
    const obj = lines('mtllib lib.mtl', ...QUAD, 'usemtl m', QUAD_FACE);
    const files = new Map([
      ['lib.mtl', encode(lines('newmtl m', 'map_Kd big.png'))],
      ['big.png', pngHeader(4097, 1)],
    ]);
    expectObjError(obj, 'TEXTURE_TOO_LARGE', 'lib.mtl:1', { files });
  });

  it('reports other maps and lighting parameters once per material', () => {
    const mtl = lines(
      'newmtl m',
      'Ka 1 1 1',
      'Ks 1 1 1',
      'Ns 10',
      'illum 2',
      'map_Bump n.png',
      'bump n.png',
      'disp d.png',
      'map_d a.png',
    );
    const { warnings } = withMtl(mtl);
    expect(warnings.map((w) => [w.code, w.message])).toEqual([
      [
        'UNSUPPORTED_MATERIAL_FEATURE',
        'Material maps ignored at lib.mtl:1: map_Bump, bump, disp, map_d of "m" not drawn',
      ],
      [
        'MATERIAL_PARAMS_IGNORED',
        'Material parameters ignored at lib.mtl:1: Ka, Ks, Ns, illum of "m" (diffuse colour and opacity only)',
      ],
    ]);
  });

  it('a missing library or an unknown material draws plain faces, with a warning', () => {
    const noLib = loadObj(lines('mtllib lib.mtl', ...QUAD, 'usemtl m', QUAD_FACE));
    expect(noLib.scene.meshes[0]!.groups[0]!.material).toBe(-1);
    expect(noLib.warnings.map((w) => [w.code, w.path])).toEqual([
      ['MISSING_RESOURCE', 'model.obj:1'],
      ['UNKNOWN_MATERIAL', 'model.obj:11'],
    ]);
    const unknown = withMtl(lines('newmtl m'), [], 'other');
    expect(unknown.scene.materials).toEqual([]);
    expect(unknown.warnings.map((w) => w.code)).toEqual(['UNKNOWN_MATERIAL']);
  });

  it('the first definition of a name wins; Kd with one value is grey', () => {
    const { scene } = withMtl(lines('newmtl m', 'Kd 0.2', 'newmtl m', 'Kd 1 0 0'));
    expect(solidPixel(scene.textures[0]!.bytes)).toEqual([51, 51, 51, 255]);
  });

  it('rejects non-finite numbers in a library', () => {
    const obj = lines('mtllib lib.mtl', ...QUAD, 'usemtl m', QUAD_FACE);
    expectObjError(obj, 'NON_FINITE_DATA', 'lib.mtl:2', {
      files: new Map([['lib.mtl', encode(lines('newmtl m', 'Kd 1 NaN 0'))]]),
    });
  });
});
