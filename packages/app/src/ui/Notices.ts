const MAX_SHOWN_CHARS = 600;
export const TOAST_MS = 5000;

const clip = (text: string): string =>
  text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS - 1)}…` : text;

export type LightingState = 'busy' | 'lit' | 'warn';

const LIGHTING_TEXT: Readonly<Record<LightingState, string>> = {
  busy: 'Lighting the preview…',
  lit: 'Preview lit.',
  warn: 'The preview shows unbaked light.',
};

type Scheduler = (callback: () => void, ms: number) => unknown;
type Canceller = (handle: unknown) => void;

export interface NoticeElements {
  /** The role="status" line: exactly the latest message. */
  readonly status: HTMLElement;
  /** The model dot: the lasting lighting state. */
  readonly state: HTMLElement;
  /** The saving-failure text, a live region that is always in the tree; empty it collapses. */
  readonly storageChip: HTMLElement;
  readonly storageClose: HTMLElement;
  readonly alertBox: HTMLElement;
  readonly alertText: HTMLElement;
}

// One status line (role="status"), one lasting error (role="alert") and the lighting state on the model dot. Text only:
// messages carry file names.
export class Notices {
  private pinned: string | null = null;
  private timer: unknown = null;
  private toastedReason: string | null = null;

  constructor(
    private readonly elements: NoticeElements,
    private readonly schedule: Scheduler = (callback, ms) => setTimeout(callback, ms),
    private readonly cancel: Canceller = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  ) {}

  /** Replaces the message. The text stays after the fade so the line still reads as the last thing that happened. */
  status(message: string): void {
    const line = this.elements.status;
    line.textContent = clip(message);
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    if (message === '') {
      line.classList.remove('toast-shown');
      return;
    }
    line.classList.add('toast-shown');
    this.timer = this.schedule(() => {
      this.timer = null;
      line.classList.remove('toast-shown');
    }, TOAST_MS);
  }

  /**
   * The dot: a shape per state (colour is not the only cue), the text for assistive technology and the tooltip.
   * `detail` is why the light is not baked: the dot is 12 px, so a reason is also said once in the status line,
   * until the preview is lit again.
   */
  lighting(state: LightingState, detail?: string): void {
    const dot = this.elements.state;
    const text = detail ? clip(`${LIGHTING_TEXT[state].replace(/\.$/, '')}: ${detail}`) : LIGHTING_TEXT[state];
    dot.textContent = text;
    dot.title = text;
    dot.dataset['state'] = state;
    if (state === 'lit') this.toastedReason = null;
    if (detail && detail !== this.toastedReason) {
      this.toastedReason = detail;
      this.status(text);
    }
  }

  /** A saving failure the app works around: not an error. It stays in its own chip until dismissed or the page reloads. */
  storage(message: string): void {
    this.elements.storageChip.textContent = clip(message);
    this.elements.storageClose.hidden = false;
  }

  dismissStorage(): void {
    this.elements.storageChip.textContent = '';
    this.elements.storageClose.hidden = true;
  }

  alert(message: string): void {
    this.elements.alertText.textContent = clip(message);
    this.elements.alertBox.hidden = false;
  }

  /** A failure that does not go away (the graphics driver): clearAlert brings it back instead of wiping it. */
  pinAlert(message: string): void {
    this.pinned = clip(message);
    this.alert(message);
  }

  clearAlert(): void {
    this.elements.alertText.textContent = this.pinned ?? '';
    this.elements.alertBox.hidden = this.pinned === null;
  }

  /** The Dismiss button: the visitor has read the error, a pinned one too, so it does not come back. */
  dismissAlert(): void {
    this.pinned = null;
    this.clearAlert();
  }
}
