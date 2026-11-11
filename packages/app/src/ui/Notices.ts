const MAX_SHOWN_CHARS = 600;

const clip = (text: string): string =>
  text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS - 1)}…` : text;

// The status line (role="status") and the error line (role="alert"). Text only: messages carry file names.
export class Notices {
  private pinned: string | null = null;

  constructor(
    private readonly main: HTMLElement,
    private readonly lightingLine: HTMLElement,
    private readonly alertLine: HTMLElement,
    private readonly storageLine: HTMLElement,
  ) {}

  status(message: string): void {
    this.main.textContent = clip(message);
  }

  lighting(message: string): void {
    this.lightingLine.textContent = clip(message);
  }

  /** Kept apart from the status line: later messages do not wipe it. */
  storage(message: string): void {
    this.storageLine.textContent = clip(message);
  }

  alert(message: string): void {
    this.alertLine.textContent = clip(message);
    this.alertLine.hidden = false;
  }

  /** A failure that does not go away (the graphics driver): clearAlert brings it back instead of wiping it. */
  pinAlert(message: string): void {
    this.pinned = clip(message);
    this.alert(message);
  }

  clearAlert(): void {
    this.alertLine.textContent = this.pinned ?? '';
    this.alertLine.hidden = this.pinned === null;
  }
}
