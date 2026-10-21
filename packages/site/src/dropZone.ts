import { checkHandoffFiles, HandoffLimits, putHandoffFiles } from '@modelshot/app/handoff';

export interface DropZoneParts {
  readonly zone: HTMLElement;
  readonly input: HTMLInputElement;
  readonly alert: HTMLElement;
  readonly openButtons: Iterable<HTMLElement>;
}

// The app lives on the same origin under /app/ (docs/site.md); it takes the files from IndexedDB on load.
export const APP_HANDOFF_URL = './app/?open=handoff';

function preventNavigation(event: DragEvent): void {
  event.preventDefault();
}

// Wires the picker, the drop zone and the page: chosen files are checked against the handoff limits, stored locally
// and opened in the app. Nothing is uploaded; a file dropped anywhere else on the page is ignored, not opened.
export function wireDropZone(
  parts: DropZoneParts,
  view: Window = window,
  navigate: (url: string) => void = (url) => view.location.assign(url),
): void {
  const { zone, input, alert } = parts;
  input.accept = HandoffLimits.extensions.join(',');

  async function handOff(files: File[]): Promise<void> {
    alert.textContent = '';
    const error = checkHandoffFiles(files);
    if (error) {
      alert.textContent = error.message;
      return;
    }
    try {
      await putHandoffFiles(files);
    } catch (failure) {
      alert.textContent = failure instanceof Error ? failure.message : String(failure);
      return;
    }
    navigate(APP_HANDOFF_URL);
  }

  for (const button of parts.openButtons) button.addEventListener('click', () => input.click());
  // The selection is taken and the input emptied on every attempt, so choosing the same file again after a refusal,
  // a storage failure or coming Back from the app fires change again.
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    void handOff(files);
  });
  view.addEventListener('pageshow', () => {
    input.value = '';
    alert.textContent = '';
  });

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('is-dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-dragging');
    void handOff(Array.from(event.dataTransfer?.files ?? []));
  });
  view.addEventListener('dragover', preventNavigation);
  view.addEventListener('drop', preventNavigation);
}
