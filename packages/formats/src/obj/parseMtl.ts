import { quoteValue } from '../text/quoteValue';
import { ObjError } from './ObjError';
import type { ObjLimits } from './ObjLoadOptions';
import type { ObjWarningList } from './ObjWarning';
import { KeywordTally, MAX_TRACKED_KEYWORDS } from './KeywordTally';
import { forEachStatement } from './objText';

/** What the loader uses of an MTL material. */
export interface MtlMaterial {
  readonly name: string;
  /** Diffuse colour, 0..1 per channel, read as sRGB (as three.js's MTLLoader does); absent: white. */
  readonly diffuse: readonly [number, number, number];
  /** Opacity 0..1 (`d`, or `1 − Tr`); absent: 1. */
  readonly opacity: number;
  /** `map_Kd` file reference, `''` for none. */
  readonly diffuseMap: string;
  readonly path: string;
}

/** Map options and how many arguments each takes at most (`-o`, `-s`, `-t` take 1 to 3 numbers). */
const MAP_OPTIONS: Readonly<Record<string, number>> = {
  '-blendu': 1,
  '-blendv': 1,
  '-bm': 1,
  '-boost': 1,
  '-cc': 1,
  '-clamp': 1,
  '-imfchan': 1,
  '-mm': 2,
  '-o': 3,
  '-s': 3,
  '-t': 3,
  '-texres': 1,
  '-type': 1,
};
const IGNORED_PARAMS = new Set([
  'Ka',
  'Ks',
  'Ke',
  'Ns',
  'Ni',
  'illum',
  'Tf',
  'sharpness',
  'Pr',
  'Pm',
  'Ps',
  'Pc',
  'Pcr',
  'aniso',
  'anisor',
]);
const UNSUPPORTED_MAPS = new Set(['bump', 'norm', 'disp', 'decal', 'refl']);

interface Pending {
  name: string;
  path: string;
  diffuse: [number, number, number];
  opacity: number;
  hasD: boolean;
  diffuseMap: string;
  options: Set<string>;
  maps: Set<string>;
  params: Set<string>;
}

/**
 * Parses an MTL library. Per material: `Kd`, `d` / `Tr`, `map_Kd` (its options reported, the file name is the rest of
 * the line); other maps and lighting parameters are reported once per material. The first definition of a name wins.
 */
export function parseMtl(
  text: string,
  fileName: string,
  limits: ObjLimits,
  warnings: ObjWarningList,
  into: Map<string, MtlMaterial>,
): void {
  let pending: Pending | null = null;
  const unsupported = new KeywordTally();
  const finish = (): void => {
    if (!pending) return;
    const { name, path, diffuse, opacity, diffuseMap, options, maps, params } = pending;
    if (options.size > 0)
      warnings.add('UNSUPPORTED_MAP_OPTION', path, `${[...options].join(' ')} of map_Kd in ${quoteValue(name)}`);
    if (maps.size > 0)
      warnings.add('UNSUPPORTED_MATERIAL_FEATURE', path, `${[...maps].join(', ')} of ${quoteValue(name)} not drawn`);
    if (params.size > 0) {
      warnings.add(
        'MATERIAL_PARAMS_IGNORED',
        path,
        `${[...params].join(', ')} of ${quoteValue(name)} (diffuse colour and opacity only)`,
      );
    }
    if (!into.has(name)) into.set(name, { name, path, diffuse, opacity, diffuseMap });
    pending = null;
  };

  forEachStatement(text, fileName, limits.maxLineChars, (statement) => {
    const { keyword, args, path } = statement;
    if (keyword === 'newmtl') {
      finish();
      const name = statement.rest(0).slice(0, limits.maxStringChars);
      if (!into.has(name) && into.size >= limits.maxMaterials) {
        throw new ObjError('TOO_MANY_MATERIALS', path, `more than ${limits.maxMaterials} materials`);
      }
      pending = {
        name,
        path,
        diffuse: [1, 1, 1],
        opacity: 1,
        hasD: false,
        diffuseMap: '',
        options: new Set(),
        maps: new Set(),
        params: new Set(),
      };
      return;
    }
    const material: Pending | null = pending;
    if (!material) {
      unsupported.add(keyword, path);
      return;
    }
    if (keyword === 'Kd') {
      // `Kd spectral file` and `Kd xyz x y z` are other colour spaces the loader does not read.
      if (args[0] === 'spectral' || args[0] === 'xyz') material.params.add(`Kd ${args[0]}`);
      else {
        const [r, g = r, b = r] = args.slice(0, 3).map((token) => readNumber(token, path));
        if (r === undefined) throw new ObjError('INVALID_STATEMENT', path, 'Kd: expected r g b');
        material.diffuse = [clamp01(r), clamp01(g ?? r), clamp01(b ?? r)];
      }
    } else if (keyword === 'd') {
      material.opacity = clamp01(readNumber(args[args.length - 1], path));
      material.hasD = true;
    } else if (keyword === 'Tr') {
      if (!material.hasD) material.opacity = clamp01(1 - readNumber(args[args.length - 1], path));
    } else if (keyword === 'map_Kd') {
      let index = 0;
      while (index < args.length - 1 && Object.hasOwn(MAP_OPTIONS, args[index] ?? '')) {
        const option = args[index] ?? '';
        material.options.add(option);
        index++;
        const max = MAP_OPTIONS[option] ?? 0;
        const numeric = option === '-o' || option === '-s' || option === '-t';
        for (let taken = 0; taken < max && index < args.length - 1; taken++) {
          if (numeric && taken > 0 && !Number.isFinite(Number(args[index]))) break;
          index++;
        }
      }
      material.diffuseMap = statement.rest(index).slice(0, limits.maxStringChars);
    } else if (keyword.startsWith('map_') || UNSUPPORTED_MAPS.has(keyword)) {
      if (material.maps.size < MAX_TRACKED_KEYWORDS) material.maps.add(keyword.slice(0, 32));
    } else if (IGNORED_PARAMS.has(keyword)) {
      material.params.add(keyword);
    } else {
      unsupported.add(keyword, path);
    }
  });
  finish();
  unsupported.report(warnings, 'ignored');
}

function readNumber(token: string | undefined, path: string): number {
  const value = Number(token);
  if (token === undefined || token === '' || !Number.isFinite(value)) {
    throw new ObjError('NON_FINITE_DATA', path, `expected a finite number, got ${quoteValue(token)}`);
  }
  return value;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
