import { HandoffLimits } from './HandoffLimits';

export interface HandoffFileLike {
  readonly name: string;
  readonly size: number;
}

export type HandoffViolation =
  | { readonly code: 'EMPTY' }
  | { readonly code: 'TOO_MANY'; readonly count: number }
  | { readonly code: 'UNSUPPORTED_TYPE'; readonly name: string }
  | { readonly code: 'TOO_LARGE'; readonly bytes: number };

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return HandoffLimits.extensions.some((extension) => lower.endsWith(extension) && lower.length > extension.length);
}

// The first handoff limit a selection breaks, or null. The count is checked before any file is looked at.
export function findHandoffViolation(files: readonly HandoffFileLike[]): HandoffViolation | null {
  if (files.length === 0) return { code: 'EMPTY' };
  if (files.length > HandoffLimits.maxFiles) return { code: 'TOO_MANY', count: files.length };
  const unsupported = files.find((file) => !hasAllowedExtension(file.name));
  if (unsupported) return { code: 'UNSUPPORTED_TYPE', name: unsupported.name };
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  return bytes > HandoffLimits.maxTotalBytes ? { code: 'TOO_LARGE', bytes } : null;
}
