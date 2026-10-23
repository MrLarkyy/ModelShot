import { DEFAULT_LOOK, LOOK_PRESETS, type LookPreset } from '@modelshot/looks';
import { OrbitController, type CanvasCssSize } from '@modelshot/renderer-rt';
import type { SceneDocument } from '@modelshot/scene';
import { ExportDialog } from './export/ExportDialog';
import type { ExportSettings } from './export/ExportSettings';
import { describeHandoff } from './handoff/describeHandoff';
import { takeHandoffFiles } from './handoff/fileHandoff';
import { bindDrop } from './intake/bindDrop';
import { checkIntake } from './intake/checkIntake';
import { groupFiles, type LoadRequest } from './intake/groupFiles';
import { IntakeError } from './intake/IntakeError';
import type { LoadedModel, PlayerArmsChoice } from './intake/LoadMessages';
import { LOAD_TIMEOUT_MS, loadModel } from './intake/loadModel';
import { CameraPanel } from './panels/CameraPanel';
import { LookPanel } from './panels/LookPanel';
import { RenderPanel } from './panels/RenderPanel';
import { ScenePanel } from './panels/ScenePanel';
import { RenderSession } from './render/RenderSession';
import { DEFAULT_RENDER_SETTINGS, type RenderSettingsValues } from './render/RenderSettings';
import { applyLook } from './session/applyLook';
import { hiddenIndices, visibilityFromHidden } from './session/visibility';
import { withVisibility } from './session/withVisibility';
import { bindShortcuts } from './shortcuts/bindShortcuts';
import { HelpDialog } from './shortcuts/HelpDialog';
import type { ModelState } from './state/AppState';
import type { AppStateStore } from './state/appStateDb';
import { StatePersistence } from './state/StatePersistence';
import { byId } from './ui/dom';
import { Notices } from './ui/Notices';
import { Viewer } from './viewer/Viewer';

const MAX_WARNING_NOTES = 3;

type Snapshot = Omit<ModelState, 'v' | 'savedAt'>;

interface OpenModel {
  readonly loaded: LoadedModel;
  readonly request: LoadRequest;
  readonly files: readonly File[];
  readonly arms: PlayerArmsChoice;
}

// The app: opens files, shows the model, and owns the panels, the render, the export and the local state. Every byte
// stays in this page; the only network use is loading the app's own files.
export class App {
  private readonly notices: Notices;
  private readonly persistence: StatePersistence;
  private readonly renderSession: RenderSession;
  private readonly exportDialog: ExportDialog;
  private readonly helpDialog: HelpDialog;
  private readonly scenePanel: ScenePanel;
  private readonly lookPanel: LookPanel;
  private readonly cameraPanel: CameraPanel;
  private readonly renderPanel: RenderPanel;
  private readonly renderButton = byId('render-button', HTMLButtonElement);
  private readonly exportButton = byId('export-button', HTMLButtonElement);
  private readonly resultCanvas = byId('result', HTMLCanvasElement);
  private readonly progressBox = byId('render-progress', HTMLElement);
  private readonly progress = byId('progress', HTMLProgressElement);
  private readonly fileInput = byId('file-input', HTMLInputElement);
  private viewer: Viewer | null = null;
  private open: OpenModel | null = null;
  private base: SceneDocument | null = null;
  private nodeVisible: boolean[] = [];
  private meshVisible: boolean[] = [];
  private look: LookPreset = DEFAULT_LOOK;
  private arms: PlayerArmsChoice = 'classic';
  private renderValues: RenderSettingsValues = { ...DEFAULT_RENDER_SETTINGS };
  private exportValues: ExportSettings | null = null;
  private cssSize: CanvasCssSize | null = null;
  private loading = false;
  private exporting = false;
  private watchdogMs = LOAD_TIMEOUT_MS;
  private hangNext = false;
  private failNext = false;
  private committing = false;

  constructor(private readonly store: AppStateStore) {
    this.notices = new Notices(
      byId('status-main', HTMLElement),
      byId('status-lighting', HTMLElement),
      byId('alert', HTMLElement),
      byId('status-storage', HTMLElement),
    );
    this.persistence = new StatePersistence(store, (message) => this.notices.storage(message));
    try {
      this.viewer = Viewer.create(byId('preview', HTMLCanvasElement), {
        onStatus: (message) => this.notices.lighting(message),
        onResize: (size) => {
          const previous = this.cssSize;
          this.cssSize = size;
          const same =
            previous?.cssWidth === size.cssWidth &&
            previous.cssHeight === size.cssHeight &&
            previous.devicePixelRatio === size.devicePixelRatio;
          if (!same) this.invalidateRender();
        },
        onChange: () => this.cameraChanged(),
        preserveDrawingBuffer: import.meta.env.MODE === 'e2e',
      });
    } catch (error) {
      this.notices.alert(`The 3D view cannot start: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.renderSession = new RenderSession(this.resultCanvas, {
      document: () => this.viewer?.document ?? null,
      camera: () => this.requireViewer().settledCamera(),
      look: () => this.look,
      size: () => this.cssSize,
      settings: () => this.renderValues,
      onProgress: (done, target) => this.renderProgress(done, target),
      onDone: (warnings) => this.renderDone(warnings.map((w) => w.message)),
      onCancelled: () => this.renderStopped('Render cancelled.'),
      onError: (error) => this.renderFailed(error),
    });
    this.scenePanel = new ScenePanel(byId('scene-panel', HTMLElement), {
      setNodeVisible: (index, visible) => this.setVisible(this.nodeVisible, index, visible),
      setMeshVisible: (index, visible) => this.setVisible(this.meshVisible, index, visible),
      setArms: (arms) => void this.changeArms(arms),
    });
    this.lookPanel = new LookPanel(byId('look-panel', HTMLElement), this.look.id, (id) => this.selectLook(id));
    this.cameraPanel = new CameraPanel(byId('camera-panel', HTMLElement), {
      orbit: this.viewer?.orbit ?? new OrbitController(),
      changed: () => this.viewer?.changed(),
      frameModel: () => this.viewer?.frameModel(),
      resetView: () => this.viewer?.resetView(),
    });
    this.renderPanel = new RenderPanel(byId('render-panel', HTMLElement), this.renderValues, (values) => {
      this.renderValues = values;
      this.scheduleSave();
    });
    this.exportDialog = new ExportDialog(byId('export-dialog', HTMLDialogElement), {
      document: () => this.viewer?.document ?? null,
      modelName: () => this.open?.loaded.name ?? 'model',
      camera: () => this.requireViewer().settledCamera(),
      viewportAspect: () => (this.cssSize ? this.cssSize.cssWidth / Math.max(1, this.cssSize.cssHeight) : 1),
      tracer: async () => {
        const tracer = await this.renderSession.tracer();
        tracer.setLook(this.look);
        return tracer;
      },
      settings: () => this.exportValues,
      onSettings: (settings) => {
        this.exportValues = settings;
        this.scheduleSave();
      },
      begin: () => this.beginExport(),
      end: () => this.endExport(),
    });
    this.helpDialog = new HelpDialog(byId('help-dialog', HTMLDialogElement));
    this.bindControls();
    this.setActionsEnabled();
  }

  /** Reads the landing page's handoff when asked for, else reopens the last session. */
  async start(): Promise<void> {
    const params = new URLSearchParams(location.search);
    if (params.get('open') === 'handoff') {
      // The query is dropped at once: a reload reopens the session instead of looking for a handoff that is gone.
      history.replaceState(null, '', `${location.pathname}${location.hash}`);
      await this.openHandoff();
      return;
    }
    await this.restoreSession();
  }

  /** Opens `files` (drop, picker, handoff or the restored session). A failure keeps the model that is shown. */
  async openFiles(files: readonly File[]): Promise<void> {
    if (!this.viewer) return;
    if (this.loading) {
      this.notices.status('Still opening the previous files.');
      return;
    }
    this.notices.clearAlert();
    const refused = checkIntake(files);
    if (refused) {
      this.notices.alert(refused.message);
      return;
    }
    this.loading = true;
    let name = 'the files';
    try {
      const request = groupFiles(files);
      name = request.kind === 'model' ? request.model.name : request.skin.name;
      this.notices.status(`Opening ${name}…`);
      let arms = this.arms;
      let loaded = await this.load(request, arms);
      const saved = await this.readSaved(loaded.key);
      if (loaded.kind === 'skin' && saved?.arms && saved.arms !== arms) {
        arms = saved.arms;
        loaded = await this.load(request, saved.arms);
      }
      this.persistence.resume();
      if (!(await this.commit({ loaded, request, files, arms }, saved, true))) {
        this.notices.alert(`Could not show ${name}: the scene changed while it was opening.`);
        return;
      }
      void this.persistence.saveSession(files, loaded.key);
      this.scheduleSave();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.notices.alert(
        error instanceof IntakeError ? `Could not open ${name}: ${why}` : `Could not show ${name}: ${why}`,
      );
      this.notices.status(this.open ? `Still showing ${this.open.loaded.name}.` : '');
    } finally {
      this.loading = false;
    }
  }

  /** The parts the e2e build exposes to its tests. */
  internals(): {
    viewer: Viewer | null;
    renderSession: RenderSession;
    setWatchdogMs: (ms: number) => void;
    hangNextLoad: () => void;
    failNextScene: () => void;
  } {
    return {
      viewer: this.viewer,
      renderSession: this.renderSession,
      setWatchdogMs: (ms) => (this.watchdogMs = ms),
      hangNextLoad: () => (this.hangNext = true),
      failNextScene: () => (this.failNext = true),
    };
  }

  private requireViewer(): Viewer {
    if (!this.viewer) throw new Error('The 3D view is not available.');
    return this.viewer;
  }

  private load(request: LoadRequest, arms: PlayerArmsChoice): Promise<LoadedModel> {
    const hang = import.meta.env.MODE === 'e2e' && this.hangNext;
    this.hangNext = false;
    return loadModel(request, { arms, timeoutMs: this.watchdogMs, hang });
  }

  private setDocument(viewer: Viewer, doc: SceneDocument, reframe: boolean): ReturnType<Viewer['setDocument']> {
    const fail = import.meta.env.MODE === 'e2e' && this.failNext;
    this.failNext = false;
    return fail ? Promise.reject(new Error('The scene could not be built (e2e).')) : viewer.setDocument(doc, reframe);
  }

  private async readSaved(key: string): Promise<ModelState | null> {
    try {
      return await this.store.loadModel(key);
    } catch {
      return null;
    }
  }

  /** False when the scene was replaced while this one was loading: nothing of it is applied. */
  private async commit(open: OpenModel, saved: ModelState | null, reframe: boolean): Promise<boolean> {
    const viewer = this.requireViewer();
    // The previous model's setup is saved before the view changes under it.
    await this.persistence.flush();
    const doc = open.loaded.doc;
    let nodeVisible = doc.nodes.map((node) => node.visible);
    let meshVisible = doc.meshes.map((mesh) => mesh.visible);
    if (saved) {
      nodeVisible = visibilityFromHidden(doc.nodes.length, saved.hiddenNodes);
      meshVisible = visibilityFromHidden(doc.meshes.length, saved.hiddenMeshes);
    } else if (
      !reframe &&
      this.nodeVisible.length === nodeVisible.length &&
      this.meshVisible.length === meshVisible.length
    ) {
      nodeVisible = this.nodeVisible;
      meshVisible = this.meshVisible;
    }
    const look = (saved && Object.hasOwn(LOOK_PRESETS, saved.look) ? LOOK_PRESETS[saved.look] : undefined) ?? this.look;
    this.committing = true;
    let result;
    try {
      result = await this.setDocument(viewer, withVisibility(doc, nodeVisible, meshVisible), reframe);
      if (!result.applied) return false;
      this.look = applyLook(look, [viewer, this.renderSession.existingTracer()]);
      this.open = open;
      this.arms = open.arms;
      this.base = doc;
      this.nodeVisible = [...nodeVisible];
      this.meshVisible = [...meshVisible];
      if (saved) {
        this.renderValues = saved.render;
        if (saved.export) this.exportValues = saved.export;
        if (reframe) viewer.orbit.setState(saved.camera);
      }
    } finally {
      this.committing = false;
    }
    viewer.changed();
    this.showPanels();
    const notes = [...open.loaded.warnings, ...result.warnings.map((w) => w.message)];
    const shown = notes.slice(0, MAX_WARNING_NOTES).join(' ');
    this.notices.status(
      notes.length > 0
        ? `Opened ${open.loaded.name} with ${notes.length} note(s): ${shown}`
        : `Opened ${open.loaded.name}.`,
    );
    return true;
  }

  private showPanels(): void {
    const open = this.open;
    byId('empty', HTMLElement).hidden = open !== null;
    this.scenePanel.show(
      open && this.base
        ? {
            doc: this.base,
            nodeVisible: this.nodeVisible,
            meshVisible: this.meshVisible,
            player: open.loaded.kind === 'skin' ? { arms: this.arms } : null,
          }
        : null,
    );
    this.lookPanel.show(this.look.id);
    this.cameraPanel.sync();
    this.renderPanel.show(this.renderValues);
    this.setActionsEnabled();
  }

  private setActionsEnabled(): void {
    const ready = this.open !== null && this.viewer !== null;
    const idle = !this.renderSession.busy && !this.exporting;
    this.renderButton.disabled = !ready || !idle;
    this.exportButton.disabled = !ready || !idle;
  }

  private setVisible(flags: boolean[], index: number, visible: boolean): void {
    if (this.loading) {
      // The scene of the new files is being prepared; the panel goes back to what the shown model has.
      this.showPanels();
      return;
    }
    flags[index] = visible;
    void this.applyVisibility();
  }

  private async applyVisibility(): Promise<void> {
    const base = this.base;
    if (!base || !this.viewer) return;
    try {
      await this.setDocument(this.viewer, withVisibility(base, this.nodeVisible, this.meshVisible), false);
      this.scheduleSave();
    } catch (error) {
      this.notices.alert(`Could not update the view: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async changeArms(arms: PlayerArmsChoice): Promise<void> {
    const open = this.open;
    if (!open || open.loaded.kind !== 'skin' || this.loading || arms === this.arms) return;
    this.loading = true;
    this.notices.clearAlert();
    try {
      const loaded = await this.load(open.request, arms);
      if (!(await this.commit({ ...open, loaded, arms }, null, false))) {
        this.notices.alert('Could not change the arms: the scene changed while it was loading.');
        this.showPanels();
        return;
      }
      this.scheduleSave();
    } catch (error) {
      this.notices.alert(`Could not change the arms: ${error instanceof Error ? error.message : String(error)}`);
      this.showPanels();
    } finally {
      this.loading = false;
    }
  }

  private selectLook(id: string): void {
    const preset = Object.hasOwn(LOOK_PRESETS, id) ? LOOK_PRESETS[id] : undefined;
    if (!preset || !this.viewer) return;
    this.look = applyLook(preset, [this.viewer, this.renderSession.existingTracer()]);
    this.lookPanel.show(this.look.id);
    this.scheduleSave();
  }

  private nextLook(): void {
    const ids = this.lookPanel.ids;
    const next = ids[(ids.indexOf(this.look.id) + 1) % ids.length];
    if (next) this.selectLook(next);
  }

  private cameraChanged(): void {
    this.invalidateRender();
    this.cameraPanel.sync();
    this.scheduleSave();
  }

  private snapshot(): Snapshot {
    return {
      camera: this.requireViewer().orbit.state(),
      look: this.look.id,
      hiddenNodes: hiddenIndices(this.nodeVisible),
      hiddenMeshes: hiddenIndices(this.meshVisible),
      ...(this.open?.loaded.kind === 'skin' ? { arms: this.arms } : {}),
      render: this.renderValues,
      ...(this.exportValues ? { export: this.exportValues } : {}),
    };
  }

  private scheduleSave(): void {
    const open = this.open;
    if (!open || !this.viewer || this.committing) return;
    this.persistence.scheduleModel(open.loaded.key, () => this.snapshot());
  }

  private async openHandoff(): Promise<void> {
    try {
      const read = await takeHandoffFiles();
      if (read.kind === 'files') await this.openFiles(read.files);
      else this.notices.status(describeHandoff(read));
    } catch (error) {
      this.notices.alert(error instanceof Error ? error.message : String(error));
    }
  }

  private async restoreSession(): Promise<void> {
    try {
      const session = await this.store.loadSession();
      if (session) await this.openFiles(session.files);
    } catch {
      // No stored session, or the database is unavailable: the app starts empty.
    }
  }

  private render(): void {
    if (!this.open || this.exporting || this.renderSession.busy) return;
    this.notices.clearAlert();
    this.resultCanvas.hidden = false;
    this.progressBox.hidden = false;
    this.progress.value = 0;
    this.setActionsEnabled();
    void this.renderSession.render().finally(() => this.setActionsEnabled());
    this.setActionsEnabled();
  }

  private renderProgress(done: number, target: number): void {
    this.progress.value = target > 0 ? done / target : 0;
    this.notices.status(`Rendering: ${done} of ${target} samples.`);
  }

  private renderDone(warnings: readonly string[]): void {
    // A count of finished renders for the tests to wait on; a page has no use for it.
    this.resultCanvas.dataset['renders'] = String(Number(this.resultCanvas.dataset['renders'] ?? 0) + 1);
    this.progressBox.hidden = true;
    this.notices.status(warnings.length > 0 ? `Render done. ${warnings.join(' ')}` : 'Render done.');
    this.setActionsEnabled();
  }

  private renderStopped(message: string): void {
    this.progressBox.hidden = true;
    this.resultCanvas.hidden = true;
    this.notices.status(message);
    this.setActionsEnabled();
  }

  private renderFailed(error: unknown): void {
    this.progressBox.hidden = true;
    this.resultCanvas.hidden = true;
    this.notices.alert(`The render failed: ${error instanceof Error ? error.message : String(error)}`);
    this.setActionsEnabled();
  }

  // The camera, scene, look or size changed: a render in progress stops, a finished one no longer matches the view.
  private invalidateRender(): void {
    if (this.renderSession.busy) {
      this.renderSession.cancel();
      return;
    }
    this.resultCanvas.hidden = true;
  }

  private beginExport(): boolean {
    if (this.renderSession.busy) {
      this.notices.status('Wait for the render to finish, or cancel it, before exporting.');
      return false;
    }
    this.exporting = true;
    this.setActionsEnabled();
    return true;
  }

  private endExport(): void {
    this.exporting = false;
    this.resultCanvas.hidden = true;
    this.setActionsEnabled();
  }

  private openExport(): void {
    if (!this.open) return;
    if (this.renderSession.busy) {
      this.notices.status('Wait for the render to finish, or cancel it, before exporting.');
      return;
    }
    void this.exportDialog.open().catch((error: unknown) => {
      this.notices.alert(`The export could not start: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async forget(): Promise<void> {
    try {
      await this.persistence.forget();
      this.notices.status('Local data deleted: the last model and your settings are gone from this browser.');
    } catch (error) {
      this.notices.alert(`Could not delete the local data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private bindControls(): void {
    const openButton = byId('open-button', HTMLButtonElement);
    openButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length > 0) void this.openFiles(files);
    });
    this.renderButton.addEventListener('click', () => this.render());
    this.exportButton.addEventListener('click', () => this.openExport());
    byId('cancel-button', HTMLButtonElement).addEventListener('click', () => this.renderSession.cancel());
    byId('help-button', HTMLButtonElement).addEventListener('click', () => this.helpDialog.open());
    byId('forget-button', HTMLButtonElement).addEventListener('click', () => void this.forget());
    bindDrop(window, byId('drop-overlay', HTMLElement), (files) => {
      if (this.exporting || document.querySelector('dialog[open]')) {
        this.notices.status('Close the dialog and wait for the export to finish before opening files.');
        return;
      }
      void this.openFiles(files);
    });
    bindShortcuts(document, {
      open: () => this.fileInput.click(),
      render: () => this.render(),
      export: () => this.openExport(),
      cancel: () => this.renderSession.cancel(),
      front: () => this.cameraPanel.applyPreset('front'),
      side: () => this.cameraPanel.applyPreset('side'),
      'three-quarter': () => this.cameraPanel.applyPreset('three-quarter'),
      isometric: () => this.cameraPanel.applyPreset('isometric'),
      nextLook: () => this.nextLook(),
      toggleSelected: () => this.scenePanel.toggleSelected(),
      help: () => this.helpDialog.open(),
    });
    const flush = (): void => void this.persistence.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
}
