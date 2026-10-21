import { findHandoffViolation, type HandoffFileLike, type HandoffViolation } from './findHandoffViolation';
import { HandoffError } from './HandoffError';
import { HandoffLimits } from './HandoffLimits';

const MIB = 1024 * 1024;
const MAX_NAME_SHOWN = 80;

function shownName(name: string): string {
  return name.length > MAX_NAME_SHOWN ? `${name.slice(0, MAX_NAME_SHOWN - 1)}…` : name;
}

function message(violation: HandoffViolation): string {
  switch (violation.code) {
    case 'EMPTY':
      return 'No file was chosen.';
    case 'TOO_MANY':
      return `${violation.count} files chosen; at most ${HandoffLimits.maxFiles} can be opened at once.`;
    case 'UNSUPPORTED_TYPE':
      return `"${shownName(violation.name)}" is not a model, texture or skin; ModelShot opens ${HandoffLimits.extensions.join(' ')}.`;
    case 'TOO_LARGE':
      return `The files add up to ${Math.ceil(violation.bytes / MIB)} MiB; the limit is ${HandoffLimits.maxTotalBytes / MIB} MiB.`;
  }
}

// null when the selection may be handed to the app; otherwise an error naming the limit, for the page to show.
export function checkHandoffFiles(files: readonly HandoffFileLike[]): HandoffError | null {
  const violation = findHandoffViolation(files);
  return violation ? new HandoffError(violation.code, message(violation)) : null;
}
