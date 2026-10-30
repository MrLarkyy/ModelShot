import type { ObjStatement } from './objText';

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

/**
 * The file name of a `map_Kd` statement: the rest of the line after its options (inner spaces kept), at most
 * `maxChars` characters. Each option met is added to `options` when given. The last argument is always the name.
 */
export function mapKdFileName(statement: ObjStatement, maxChars: number, options?: Set<string>): string {
  const { args } = statement;
  let index = 0;
  while (index < args.length - 1 && Object.hasOwn(MAP_OPTIONS, args[index] ?? '')) {
    const option = args[index] ?? '';
    options?.add(option);
    index++;
    const max = MAP_OPTIONS[option] ?? 0;
    const numeric = option === '-o' || option === '-s' || option === '-t';
    for (let taken = 0; taken < max && index < args.length - 1; taken++) {
      if (numeric && taken > 0 && !Number.isFinite(Number(args[index]))) break;
      index++;
    }
  }
  return statement.rest(index).slice(0, maxChars);
}
