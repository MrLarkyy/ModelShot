import { ReferenceList } from '../resources/ReferenceList';
import type { ReferenceListOptions } from '../resources/ReferenceListOptions';
import { DEFAULT_OBJ_LIMITS } from './ObjLoadOptions';
import { listStatementReferences } from './listStatementReferences';
import type { DecodedObjText } from './objText';

/**
 * The material libraries an `.obj` names in `mtllib` (the rest of the line, as the loader reads it), in order, each
 * spelling once. A file the loader would refuse lists nothing; loading it reports why.
 */
export function listObjReferences(
  input: string | Uint8Array | DecodedObjText,
  options: ReferenceListOptions,
): string[] {
  const list = new ReferenceList(options.maxReferences);
  const ok = listStatementReferences(input, 'model.obj', list, (statement) => {
    if (statement.keyword === 'mtllib') list.add(statement.rest(0).slice(0, DEFAULT_OBJ_LIMITS.maxStringChars));
  });
  return ok ? list.references : [];
}
