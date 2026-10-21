import type { HandoffRead } from './readHandoffRecord';

export interface HandoffSummary {
  readonly message: string;
  readonly items: readonly string[];
}

const NOTHING: Record<Exclude<HandoffRead['kind'], 'files'>, string> = {
  none: 'no files were handed over',
  expired: 'the files were older than 10 minutes',
  invalid: 'unreadable handoff',
};

// Plain strings for textContent: file names are user data and are never parsed as markup.
export function describeHandoff(read: HandoffRead): HandoffSummary {
  if (read.kind !== 'files') {
    const reason = read.kind === 'invalid' ? ` (${read.reason})` : '';
    return { message: `Nothing to open: ${NOTHING[read.kind]}${reason}.`, items: [] };
  }
  return {
    message: `${read.files.length} file(s) kept on this device. Opening models arrives with the editor.`,
    items: read.files.map((file) => `${file.name} · ${file.size} bytes`),
  };
}
