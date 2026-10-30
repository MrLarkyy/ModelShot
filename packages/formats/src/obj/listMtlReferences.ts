import { ReferenceList } from '../resources/ReferenceList';
import type { ReferenceListOptions } from '../resources/ReferenceListOptions';
import { DEFAULT_OBJ_LIMITS } from './ObjLoadOptions';
import { listStatementReferences } from './listStatementReferences';
import { mapKdFileName } from './mapKdFileName';

/**
 * The textures an `.mtl` names in `map_Kd`, as the loader reads them: per material its last `map_Kd`, the first
 * definition of a material name only, options skipped. In order, each spelling once. A file the loader would
 * refuse lists nothing; loading it reports why.
 */
export function listMtlReferences(input: string | Uint8Array, options: ReferenceListOptions): string[] {
  const { maxStringChars } = DEFAULT_OBJ_LIMITS;
  const list = new ReferenceList(options.maxReferences);
  const names = new Set<string>();
  let defining = false;
  let map = '';
  const finish = (): void => {
    if (defining) list.add(map);
    map = '';
  };
  const ok = listStatementReferences(input, 'model.mtl', list, (statement) => {
    if (statement.keyword === 'newmtl') {
      finish();
      const name = statement.rest(0).slice(0, maxStringChars);
      defining = !names.has(name);
      names.add(name);
    } else if (statement.keyword === 'map_Kd' && defining) {
      map = mapKdFileName(statement, maxStringChars);
    }
  });
  if (!ok) return [];
  finish();
  return list.references;
}
