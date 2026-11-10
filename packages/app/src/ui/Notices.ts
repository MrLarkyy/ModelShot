const MAX_SHOWN_CHARS = 600;
export const TOAST_MS = 5000;

const clip = (text: string): string =>
  text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS - 1)}…` : text;

const lightingState = (message: string): 'lit' | 'busy' | 'warn' =>
  message === 'Preview lit.' ? 'lit' : message.startsWith('Lighting') ? 'busy' : 'warn';

type Scheduler = (callback: () => void, ms: number) => unknown;
type Canceller = (handle: unknown) => void;

export interface NoticeElements {
  /** The role="status" line: exactly the latest message. */
  readonly status: HTMLElement;
  /** The model dot: the lasting lighting state. */
  readonly state: HTMLElement;
  readonly alertBox: HTMLElement;
  readonly alertText: HTMLElement;
}

// One status line (role="status"), one lasting error (role="alert") and the lighting state on the model dot. Text only:
// messages carry file names.
export class Notices {
  private timer: unknown = null;
  private message = '';
  private storageNote = '';

  constructor(
    private readonly elements: NoticeElements,
    private readonly schedule: Scheduler = (callback, ms) => setTimeout(callback, ms),
    private readonly cancel: Canceller = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  ) {}

  /** Replaces the message. The text stays after the fade so the line still reads as the last thing that happened. */
  status(message: string): void {
    const line = this.elements.status;
    this.message = message;
    this.show();
    this.fade(line, message === '' && this.storageNote === '');
  }

  private show(): void {
    this.elements.status.textContent = clip(
      this.storageNote === '' ? this.message : `${this.message} ${this.storageNote}`.trim(),
    );
  }

  private fade(line: HTMLElement, empty: boolean): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    if (empty) {
      line.classList.remove('toast-shown');
      return;
    }
    line.classList.add('toast-shown');
    this.timer = this.schedule(() => {
      this.timer = null;
      line.classList.remove('toast-shown');
    }, TOAST_MS);
  }

  lighting(message: string): void {
    this.elements.state.textContent = clip(message);
    this.elements.state.dataset['state'] = lightingState(message);
  }

  /**
   * A saving failure the app works around: not an error. It follows the latest message instead of replacing it, so it
   * can neither hide "Opened x" nor be hidden by it. The one case where the line holds two facts.
   */
  storage(message: string): void {
    this.storageNote = message;
    this.show();
    this.fade(this.elements.status, false);
  }

  alert(message: string): void {
    this.elements.alertText.textContent = clip(message);
    this.elements.alertBox.hidden = false;
  }

  clearAlert(): void {
    this.elements.alertText.textContent = '';
    this.elements.alertBox.hidden = true;
  }
}
