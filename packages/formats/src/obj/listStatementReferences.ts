import type { ReferenceList } from '../resources/ReferenceList';
import { ObjError } from './ObjError';
import { DEFAULT_OBJ_LIMITS } from './ObjLoadOptions';
import { forEachStatement, readObjText, type ObjStatement } from './objText';

/** Ends the scan once the list is full. */
class ListFull extends Error {}

/**
 * Scans an OBJ or MTL text with the loader's size and line limits, calling `visit` per statement until `list` is
 * full; `false` when the loader would refuse the text (it then reports why).
 */
export function listStatementReferences(
  input: string | Uint8Array,
  fileName: string,
  list: ReferenceList,
  visit: (statement: ObjStatement) => void,
): boolean {
  try {
    const text = readObjText(input, fileName, DEFAULT_OBJ_LIMITS.maxFileBytes);
    forEachStatement(text, fileName, DEFAULT_OBJ_LIMITS.maxLineChars, (statement) => {
      visit(statement);
      if (list.full) throw new ListFull();
    });
  } catch (error) {
    if (error instanceof ListFull) return true;
    if (error instanceof ObjError) return false;
    throw error;
  }
  return true;
}
