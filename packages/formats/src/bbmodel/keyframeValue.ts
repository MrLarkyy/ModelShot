import { MAX_ANIMATION_VALUE } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import { quoteValue } from '../text/quoteValue';

const DECIMAL_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * A Blockbench Molang field read as a constant: a number, or a string holding a decimal literal (`"-12.5"`; blank
 * counts as 0, as Blockbench's Molang parser does). `null` for any other string: a Molang expression, which ModelShot
 * does not evaluate. Another JSON type, a string over `maxChars`, or a number beyond ±`MAX_ANIMATION_VALUE` is an
 * `INVALID_FIELD`.
 */
export function keyframeValue(value: unknown, path: string, maxChars: number): number | null {
  let number: number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string') {
    if (value.length > maxChars) throw invalid(path, `a string of at most ${maxChars} characters`, value);
    const text = value.trim();
    if (text === '') return 0;
    if (!DECIMAL_LITERAL.test(text)) return null;
    number = Number(text);
  } else {
    throw invalid(path, 'a number or a Molang string', value);
  }
  if (!Number.isFinite(number) || Math.abs(number) > MAX_ANIMATION_VALUE) {
    throw invalid(path, `a finite number within ±${MAX_ANIMATION_VALUE}`, value);
  }
  return number;
}

function invalid(path: string, expected: string, value: unknown): BbmodelError {
  return new BbmodelError('INVALID_FIELD', path, `expected ${expected}, got ${quoteValue(value)}`);
}
