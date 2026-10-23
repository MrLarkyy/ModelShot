import type { ModelState } from './AppState';
import type { AppStateStore } from './appStateDb';

export const SAVE_DEBOUNCE_MS = 500;

type Snapshot = Omit<ModelState, 'v' | 'savedAt'>;

// Writes the user's setup after it stopped changing, and never lets a storage failure (quota, a blocked database,
// private browsing) reach the flow: the app tells the user once and keeps working.
export class StatePersistence {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { key: string; snapshot: () => Snapshot } | null = null;
  private notified = false;
  private forgotten = false;

  constructor(
    private readonly store: AppStateStore,
    private readonly notify: (message: string) => void,
    private readonly debounceMs = SAVE_DEBOUNCE_MS,
  ) {}

  scheduleModel(key: string, snapshot: () => Snapshot): void {
    if (this.forgotten) return;
    this.pending = { key, snapshot };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const pending = this.pending;
    this.pending = null;
    if (!pending || this.forgotten) return;
    await this.guard(() => this.store.saveModel(pending.key, pending.snapshot()));
  }

  async saveSession(files: readonly File[], modelKey: string): Promise<void> {
    if (this.forgotten) return;
    await this.guard(() => this.store.saveSession(files, modelKey));
  }

  /** Deletes everything stored and stops saving until `resume`. */
  async forget(): Promise<void> {
    clearTimeout(this.timer);
    this.pending = null;
    this.forgotten = true;
    try {
      await this.store.forget();
    } catch (error) {
      this.forgotten = false;
      this.tell(error);
      throw error;
    }
  }

  /** Saving starts again, after a model was opened following "Forget local data". */
  resume(): void {
    this.forgotten = false;
  }

  private async guard(save: () => Promise<void>): Promise<void> {
    try {
      await save();
    } catch (error) {
      this.tell(error);
    }
  }

  private tell(error: unknown): void {
    if (this.notified) return;
    this.notified = true;
    const why = error instanceof Error ? error.message : String(error);
    this.notify(`Your settings are not being kept on this device. ${why} The app keeps working.`);
  }
}
