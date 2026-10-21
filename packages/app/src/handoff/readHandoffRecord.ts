import { findHandoffViolation, type HandoffViolation } from './findHandoffViolation';
import { HandoffLimits } from './HandoffLimits';

export const HANDOFF_RECORD_VERSION = 1;

export type HandoffRead =
  | { readonly kind: 'files'; readonly files: readonly File[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'invalid'; readonly reason: HandoffRecordProblem };

export type HandoffRecordProblem =
  'NOT_A_RECORD' | 'VERSION' | 'CREATED_AT' | 'NO_FILE_LIST' | 'NOT_A_FILE' | HandoffViolation['code'];

// Clock skew between the landing tab and the app tab is tolerated up to this much.
const FUTURE_SKEW_MS = 60_000;

// Own data properties only: a getter or an inherited value never runs or counts.
function own(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value;
}

// The stored record is untrusted (any page script on the origin can write it): every field is checked, nothing
// throws, and only real File objects within the handoff limits come back.
export function readHandoffRecord(value: unknown, now: number): HandoffRead {
  if (value === undefined) return { kind: 'none' };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'invalid', reason: 'NOT_A_RECORD' };
  }
  if (own(value, 'v') !== HANDOFF_RECORD_VERSION) return { kind: 'invalid', reason: 'VERSION' };
  const createdAt = own(value, 'createdAt');
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt > now + FUTURE_SKEW_MS) {
    return { kind: 'invalid', reason: 'CREATED_AT' };
  }
  if (now - createdAt > HandoffLimits.maxAgeMs) return { kind: 'expired' };
  const stored = own(value, 'files');
  if (!Array.isArray(stored)) return { kind: 'invalid', reason: 'NO_FILE_LIST' };
  if (stored.length > HandoffLimits.maxFiles) return { kind: 'invalid', reason: 'TOO_MANY' };
  // Array.from turns holes into undefined, which every() would otherwise skip.
  const files: unknown[] = Array.from(stored as unknown[]);
  if (!files.every((entry) => entry instanceof File)) return { kind: 'invalid', reason: 'NOT_A_FILE' };
  const violation = findHandoffViolation(files);
  if (violation) return { kind: 'invalid', reason: violation.code };
  return { kind: 'files', files };
}
