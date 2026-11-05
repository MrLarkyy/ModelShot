export interface RelightDebtHost {
  /** Bakes the light again for the document shown. */
  readonly relight: () => void;
  /** The pose shown is passing (a clip plays, a gizmo drag moves it): light baked for it is not the light of what stays. */
  readonly passing: () => boolean;
  /** A bake now would light a document about to be replaced: one is being set, or an edit is being committed. */
  readonly held: () => boolean;
}

// The one owner of "the preview owes a bake for the pose finally shown". Any bake (a document, a look, a relight) lights
// the document shown and so pays the debt, unless that pose is passing; a pose other than the lit one that stays for
// `delayMs` is relit once. A passing pose waits for `settled`, a held one for the document or commit under way.
export class RelightDebt {
  private stale = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly host: RelightDebtHost,
    private readonly delayMs: number,
  ) {}

  /** A bake is owed for the pose shown. */
  get owed(): boolean {
    return this.stale;
  }

  /** A pose other than the lit one was shown: lit once it stays, a passing one once it has `settled`. */
  posed(): void {
    this.stale = true;
    if (!this.host.passing()) this.arm();
  }

  /** Lights the pose shown at once, a passing one too: a scene change during playback is not left unlit until a pause. */
  relightNow(): void {
    this.stale = true;
    if (this.host.held()) this.arm();
    else this.pay();
  }

  /** What kept the pose passing or held ended (a pause, the end of a drag or a commit): an owed bake falls due. */
  settled(): void {
    if (this.stale && !this.host.passing()) this.arm();
  }

  /** A bake of the document shown started. */
  bakeStarted(): void {
    this.cancel();
    this.stale = this.host.passing();
  }

  /** Nothing is owed: a new model was shown with its own bake. */
  reset(): void {
    this.cancel();
    this.stale = false;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private arm(): void {
    this.cancel();
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stale || this.host.passing()) return;
      if (this.host.held()) this.arm();
      else this.pay();
    }, this.delayMs);
  }

  private pay(): void {
    if (this.disposed) return;
    this.cancel();
    this.stale = false;
    this.host.relight();
  }

  private cancel(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
