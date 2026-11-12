export const SECTIONS_KEY = 'modelshot.sections.v1';

/** A stored record larger than this is ignored: it holds one flag per section. */
export const MAX_SECTIONS_BYTES = 2048;

/** Every collapsible section of the editor panels; an id outside this list is dropped from a stored record. */
export const SECTION_IDS = [
  'object-state',
  'object-transform',
  'object-arms',
  'object-animation',
  'material-group',
  'material-texture',
  'material-filtering',
  'material-transparency',
  'material-edges',
  'light-key',
  'light-fill',
  'light-rim',
  'light-shadows',
  'light-others',
  'light-environment',
  'look-backdrop',
  'look-grading',
  'render-quality',
  'render-output',
  'render-camera',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

type Backing = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The sections stored closed; anything unreadable, oversized or unknown leaves every section open. */
export function parseSections(raw: string | null): ReadonlySet<SectionId> {
  const closed = new Set<SectionId>();
  if (raw === null || raw.length > MAX_SECTIONS_BYTES) return closed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return closed;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return closed;
  for (const id of SECTION_IDS) {
    if (Object.getOwnPropertyDescriptor(parsed, id)?.value === false) closed.add(id);
  }
  return closed;
}

// Which sections the user closed, in this browser's localStorage. A blocked or full storage keeps the choice for the
// session and tells the user once; it never reaches the editor flow.
export class SectionState {
  private closed: Set<SectionId>;
  private told = false;

  constructor(
    private readonly backing: Backing | null,
    private readonly notify: (message: string) => void = () => undefined,
  ) {
    let raw: string | null = null;
    try {
      raw = backing?.getItem(SECTIONS_KEY) ?? null;
    } catch {
      this.tell();
    }
    this.closed = new Set(parseSections(raw));
  }

  isOpen(id: SectionId): boolean {
    return !this.closed.has(id);
  }

  set(id: SectionId, open: boolean): void {
    if (open) this.closed.delete(id);
    else this.closed.add(id);
    try {
      const record: Record<string, boolean> = {};
      for (const closedId of this.closed) record[closedId] = false;
      this.backing?.setItem(SECTIONS_KEY, JSON.stringify(record));
    } catch {
      this.tell();
    }
  }

  /** All sections open, and the stored record removed ("Forget local data"). */
  reset(): void {
    this.closed = new Set();
    try {
      this.backing?.removeItem(SECTIONS_KEY);
    } catch {
      this.tell();
    }
  }

  private tell(): void {
    if (this.told) return;
    this.told = true;
    this.notify('Section choices could not be saved in this browser; they last until you close the tab.');
  }
}
