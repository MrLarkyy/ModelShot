const MAX_SHOWN_CHARS = 600;

const clip = (text: string): string =>
  text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS - 1)}…` : text;

// The status line (role="status") and the error line (role="alert"). Text only: messages carry file names.
export class Notices {
  constructor(
    private readonly main: HTMLElement,
    private readonly lightingLine: HTMLElement,
    private readonly alertLine: HTMLElement,
  ) {}

  status(message: string): void {
    this.main.textContent = clip(message);
  }

  lighting(message: string): void {
    this.lightingLine.textContent = clip(message);
  }

  alert(message: string): void {
    this.alertLine.textContent = clip(message);
    this.alertLine.hidden = false;
  }

  clearAlert(): void {
    this.alertLine.textContent = '';
    this.alertLine.hidden = true;
  }
}
