import type { ExportProgress } from './ExportOptions';

/**
 * Turns frames and samples into `ExportProgress`: each frame counts as its samples plus one step of encoding, the
 * finished file as one more, so `fraction` grows with every report and is 1 only at the end.
 */
export class ProgressReporter {
  private last = -1;

  constructor(
    private readonly frames: number,
    private readonly samples: number,
    private readonly listener?: (progress: ExportProgress) => void,
  ) {}

  render(frame: number, samplesDone: number): void {
    this.report('render', frame, samplesDone, frame * (this.samples + 1) + samplesDone);
  }

  encoded(frame: number): void {
    this.report('encode', frame, this.samples, (frame + 1) * (this.samples + 1));
  }

  finished(): void {
    this.report('encode', this.frames - 1, this.samples, this.frames * (this.samples + 1) + 1);
  }

  private report(phase: ExportProgress['phase'], frame: number, samplesDone: number, units: number): void {
    const fraction = Math.min(1, units / (this.frames * (this.samples + 1) + 1));
    if (fraction < this.last) return;
    this.last = fraction;
    this.listener?.({ phase, frame, frames: this.frames, samplesDone, samples: this.samples, fraction });
  }
}
