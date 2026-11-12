export const HINTS_KEY = 'modelshot-hints-v1';

type Backing = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Whether the one-time shortcut hint was dismissed, in this browser's localStorage only. A blocked or full storage never
// throws: the hint then counts as not dismissed and the user is told once.
export class HintStore {
  private told = false;
  private session = false;

  constructor(
    private readonly backing: Backing | null,
    private readonly notify: (message: string) => void = () => undefined,
  ) {}

  get dismissed(): boolean {
    if (this.session) return true;
    try {
      return this.backing?.getItem(HINTS_KEY) === '1';
    } catch {
      this.tell();
      return false;
    }
  }

  dismiss(): void {
    this.session = true;
    try {
      this.backing?.setItem(HINTS_KEY, '1');
    } catch {
      this.tell();
    }
  }

  /** "Forget local data": the hint shows again after the next open. */
  reset(): void {
    this.session = false;
    try {
      this.backing?.removeItem(HINTS_KEY);
    } catch {
      this.tell();
    }
  }

  private tell(): void {
    if (this.told) return;
    this.told = true;
    this.notify('The shortcut hint cannot be remembered in this browser.');
  }
}
