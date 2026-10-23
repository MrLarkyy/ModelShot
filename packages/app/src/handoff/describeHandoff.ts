import type { HandoffRead } from './readHandoffRecord';

const NOTHING: Record<Exclude<HandoffRead['kind'], 'files'>, string> = {
  none: 'no files were handed over',
  expired: 'the files were older than 10 minutes',
  invalid: 'unreadable handoff',
};

// Why a handoff opened nothing, as a plain sentence for the status line.
export function describeHandoff(read: Exclude<HandoffRead, { kind: 'files' }>): string {
  const reason = read.kind === 'invalid' ? ` (${read.reason})` : '';
  return `Nothing to open: ${NOTHING[read.kind]}${reason}.`;
}
