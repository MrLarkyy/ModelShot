import { checkHandoffFiles } from '../handoff/checkHandoffFiles';
import { IntakeError } from './IntakeError';

// Drop, picker and landing handoff share one limit: the handoff's (32 files, 256 MiB, known extensions), checked on
// names and sizes before any file is read.
export function checkIntake(files: readonly File[]): IntakeError | null {
  const violation = checkHandoffFiles(files);
  return violation ? new IntakeError(violation.code, violation.message) : null;
}
