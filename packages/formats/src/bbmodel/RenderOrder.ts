import { BbmodelError } from './BbmodelError';
import type { BbmodelWarningList } from './BbmodelWarning';
import { childPath, field, type JsonObject } from './JsonFields';
import { quoteValue } from '../text/quoteValue';

// Blockbench's element `render_order` and the three.js renderOrder it sets (outliner.js updateRenderOrder).
const RENDER_ORDERS: ReadonlyMap<string, number> = new Map([
  ['default', 0],
  ['behind', -1],
  ['in_front', 1],
]);

/** `SceneMesh.renderOrder` of a cube or mesh: absent or unknown 0 (unknown warns), a non-string `INVALID_FIELD`. */
export function readRenderOrder(element: JsonObject, path: string, warnings: BbmodelWarningList): number {
  const value = field(element, 'render_order');
  if (value === undefined) return 0;
  const valuePath = childPath(path, 'render_order');
  if (typeof value !== 'string') {
    throw new BbmodelError(
      'INVALID_FIELD',
      valuePath,
      `expected default, behind or in_front, got ${quoteValue(value)}`,
    );
  }
  const order = RENDER_ORDERS.get(value);
  if (order === undefined) {
    warnings.add(
      'UNSUPPORTED_VALUE',
      valuePath,
      `${quoteValue(value)} is not default, behind or in_front; using default`,
    );
    return 0;
  }
  return order;
}
