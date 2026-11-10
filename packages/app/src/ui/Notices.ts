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
  /** The saving-failure chip: a lasting state beside the status line, not part of it. */
  readonly storageChip: HTMLElement;
  readonly alertBox: HTMLElement;
  readonly alertText: HTMLElement;
}

// One status line (role="status"), one lasting error (role="alert") and the lighting state on the model dot. Text only:
// messages carry file names.
export class Notices {
  private timer: unknown = null;

  constructor(
    private readonly elements: NoticeElements,
    private readonly schedule: Scheduler = (callback, ms) => setTimeout(callback, ms),
    private readonly cancel: Canceller = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  ) {}

  /** Replaces the message. The text stays after the fade so the line still reads as the last thing that happened. */
  status(message: string): void {
    const line = this.elements.status;
    line.textContent = clip(message);
    this.fade(line, message === '');
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

  /** A saving failure the app works around: not an error. It stays in its own chip until the page reloads. */
  storage(message: string): void {
    this.elements.storageChip.textContent = clip(message);
    this.elements.storageChip.hidden = false;
  }

  /** The bake settled: the dot follows the viewer's signal, whatever message came with it. */
  bakeSettled(lit: boolean): void {
    if (lit) this.lighting('Preview lit.');
    else if (this.elements.state.dataset['state'] !== 'warn') this.lighting('The preview shows unbaked light.');
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
