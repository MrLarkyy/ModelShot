import { DEFAULT_LOOK, LOOK_PRESETS, type LookPreset } from '@modelshot/looks';
import { OrbitController, type CanvasCssSize } from '@modelshot/renderer-rt';
import type { SceneDocument, SceneTextureFilter, Vec3 } from '@modelshot/scene';
import type { EditorTools } from './editor/EditorTools';
import { loadEditorTools } from './editor/loadEditorTools';
import { Selection } from './editor/Selection';
import { ExportDialog } from './export/ExportDialog';
import type { ExportSettings } from './export/ExportSettings';
import { describeHandoff } from './handoff/describeHandoff';
import { takeHandoffFiles } from './handoff/fileHandoff';
import { UndoStack } from './history/UndoStack';
import { bindDrop } from './intake/bindDrop';
import { checkIntake } from './intake/checkIntake';
import { groupFiles, type LoadRequest } from './intake/groupFiles';
import { IntakeError } from './intake/IntakeError';
import type { LoadedModel, PlayerArmsChoice } from './intake/LoadMessages';
import { LOAD_TIMEOUT_MS, loadModel } from './intake/loadModel';
import { Inspector } from './inspector/Inspector';
import type { InspectorModel } from './inspector/InspectorModel';
import { LayoutStore } from './layout/LayoutStore';
import { DEFAULT_LAYOUT, type PanelId } from './layout/layoutState';
import { PanelLayout } from './layout/PanelLayout';
import { CameraPanel } from './panels/CameraPanel';
import { LookPanel } from './panels/LookPanel';
import { RenderPanel } from './panels/RenderPanel';
import { ScenePanel } from './panels/ScenePanel';
import { RenderSession } from './render/RenderSession';
import { DEFAULT_RENDER_SETTINGS, type RenderSettingsValues } from './render/RenderSettings';
import { applyLook } from './session/applyLook';
import type { NodeEdit } from './session/NodeEdit';
import { hiddenIndices, visibilityFromHidden } from './session/visibility';
import { textureFilters, withTextureFilters } from './session/withTextureFilters';
import { bakeNodeEdits, setNodeEdit, withNodeEdits } from './session/withNodeEdits';
import { withVisibility } from './session/withVisibility';
import { bindShortcuts } from './shortcuts/bindShortcuts';
import { HelpDialog } from './shortcuts/HelpDialog';
import type { ModelState } from './state/AppState';
import type { AppStateStore } from './state/appStateDb';
import { StatePersistence } from './state/StatePersistence';
import { bindDisclosure } from './ui/bindDisclosure';
import { byId } from './ui/dom';
import { Notices } from './ui/Notices';
import { Viewer } from './viewer/Viewer';
import { ViewportChips } from './viewport/ViewportChips';

const MAX_WARNING_NOTES = 3;

type Snapshot = Omit<ModelState, 'v' | 'savedAt'>;

interface SetupState {
  readonly nodeVisible: boolean[];
  readonly meshVisible: boolean[];
  readonly textureFilter: SceneTextureFilter[];
  readonly lockedNodes: boolean[];
  readonly lockedMeshes: boolean[];
  readonly names: ReadonlyMap<string, string>;
  readonly nodeEdits: readonly NodeEdit[];
}

interface HistoryEntry {
  readonly setup: SetupState;
  readonly look: string;
}

interface OpenModel {
  readonly loaded: LoadedModel;
  readonly request: LoadRequest;
  readonly files: readonly File[];
  readonly arms: PlayerArmsChoice;
}

const lockedFromIndices = (count: number, locked: readonly number[]): boolean[] =>
  visibilityFromHidden(count, locked).map((flag) => !flag);
const lockedIndices = (flags: readonly boolean[]): number[] => hiddenIndices(flags.map((flag) => !flag));

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
  private readonly inspector: Inspector;
  private readonly layoutStore: LayoutStore;
  private readonly panelLayout: PanelLayout;
  private readonly selection = new Selection();
  private readonly history = new UndoStack<HistoryEntry>();
  private readonly renderButton = byId('render-button', HTMLButtonElement);
  private readonly exportButton = byId('export-button', HTMLButtonElement);
  private readonly menuExportButton = byId('menu-export-button', HTMLButtonElement);
  private readonly undoButton = byId('undo-button', HTMLButtonElement);
  private readonly redoButton = byId('redo-button', HTMLButtonElement);
  private readonly shareButton = byId('share-button', HTMLButtonElement);
  private readonly modePreview = byId('mode-preview', HTMLInputElement);
  private readonly modeRender = byId('mode-render', HTMLInputElement);
  private readonly resultCanvas = byId('result', HTMLCanvasElement);
  private readonly progressBox = byId('render-progress', HTMLElement);
  private readonly progress = byId('progress', HTMLProgressElement);
  private readonly fileInput = byId('file-input', HTMLInputElement);
  private viewer: Viewer | null = null;
  private tools: EditorTools | null = null;
  private toolsLoading = false;
  private open: OpenModel | null = null;
  private base: SceneDocument | null = null;
  private nodeVisible: boolean[] = [];
  private meshVisible: boolean[] = [];
  private textureFilter: SceneTextureFilter[] = [];
  private lockedNodes: boolean[] = [];
  private lockedMeshes: boolean[] = [];
  private names: ReadonlyMap<string, string> = new Map();
  private nodeEdits: readonly NodeEdit[] = [];
  private filteredBase: SceneDocument | null = null;
  /** The document with the visibility and filters but not the node edits: what edits and animation are applied to. */
  private restDoc: SceneDocument | null = null;
  private setupQueue: Promise<unknown> = Promise.resolve();
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
    this.layoutStore = new LayoutStore(browserStorage(), (message) => this.notices.storage(message));
    this.persistence = new StatePersistence(
      store,
      (message) => this.notices.storage(message),
      undefined,
      () => this.layoutStore.reset(),
    );
    this.panelLayout = new PanelLayout(this.layoutStore);
    try {
      this.viewer = Viewer.create(byId('preview', HTMLCanvasElement), {
        onStatus: (message) => this.notices.lighting(message),
        onResize: (size) => {
          const previous = this.cssSize;
          this.cssSize = size;
          this.tools?.resize(size);
          const same =
            previous?.cssWidth === size.cssWidth &&
            previous.cssHeight === size.cssHeight &&
            previous.devicePixelRatio === size.devicePixelRatio;
          if (!same) this.invalidateRender();
        },
        onChange: () => this.cameraChanged(),
        onFrame: (camera) => this.tools?.frame(camera),
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
    this.scenePanel = new ScenePanel(
      byId('scene-panel', HTMLElement),
      {
        setNodeVisible: (index, visible) => this.setVisible(this.nodeVisible, index, visible),
        setMeshVisible: (index, visible) => this.setVisible(this.meshVisible, index, visible),
        selectRow: (kind, index) => this.selection.set({ kind, index }),
        setLocked: (kind, index, locked) => this.setLocked(kind, index, locked),
        rename: (kind, index, name) => this.rename(kind, index, name),
        selectLight: (light) => this.showLight(light),
        openFiles: () => this.fileInput.click(),
      },
      byId('add-menu', HTMLElement),
    );
    this.inspector = new Inspector(
      byId('inspector-tabs', HTMLElement),
      {
        rename: (kind, index, name) => this.rename(kind, index, name),
        setVisible: (kind, index, visible) =>
          this.setVisible(kind === 'node' ? this.nodeVisible : this.meshVisible, index, visible),
        setLocked: (kind, index, locked) => this.setLocked(kind, index, locked),
        setTransform: (node, translation, rotation) => this.setTransform(node, translation, rotation),
        setArms: (arms) => void this.changeArms(arms),
        setTextureFilter: (index, filter) => this.setTextureFilter(index, filter),
        tabChanged: (tab) => this.layoutStore.update({ tab }),
      },
      this.layoutStore.state.tab,
    );
    this.lookPanel = new LookPanel(this.inspector.look, this.look.id, (id) => this.selectLook(id));
    this.cameraPanel = new CameraPanel(this.inspector.camera, {
      orbit: this.viewer?.orbit ?? new OrbitController(),
      changed: () => this.viewer?.changed(),
      frameModel: () => this.viewer?.frameModel(),
      resetView: () => this.viewer?.resetView(),
    });
    this.renderPanel = new RenderPanel(this.inspector.render, this.renderValues, (values) => {
      this.renderValues = values;
      this.scheduleSave();
    });
    new ViewportChips(
      byId('camera-presets', HTMLElement),
      byId('overlay-menu-button', HTMLButtonElement),
      byId('overlay-menu', HTMLElement),
      this.layoutStore,
      (id) => this.cameraPanel.applyPreset(id),
    );
    this.exportDialog = new ExportDialog(byId('export-dialog', HTMLDialogElement), {
      document: () => this.viewer?.document ?? null,
      restDocument: () => (this.restDoc ? bakeNodeEdits(this.restDoc, this.nodeEdits) : null),
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
    this.selection.onChange((target) => {
      this.scenePanel.select(target);
      this.inspector.update(this.inspectorModel());
    });
    this.bindControls();
    this.setActionsEnabled();
    this.syncHistoryButtons();
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
    editorTools: () => EditorTools | null;
    setWatchdogMs: (ms: number) => void;
    hangNextLoad: () => void;
    failNextScene: () => void;
  } {
    return {
      viewer: this.viewer,
      renderSession: this.renderSession,
      editorTools: () => this.tools,
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

  /** The document the viewer shows for a setup: filters and visibility, then the node edits. */
  private shownDocument(filtered: SceneDocument, setup: SetupState): { rest: SceneDocument; shown: SceneDocument } {
    const rest = withVisibility(filtered, setup.nodeVisible, setup.meshVisible);
    return { rest, shown: withNodeEdits(rest, rest, setup.nodeEdits) };
  }

  private setupState(): SetupState {
    return {
      nodeVisible: this.nodeVisible,
      meshVisible: this.meshVisible,
      textureFilter: this.textureFilter,
      lockedNodes: this.lockedNodes,
      lockedMeshes: this.lockedMeshes,
      names: this.names,
      nodeEdits: this.nodeEdits,
    };
  }

  /** False when the scene was replaced while this one was loading: nothing of it is applied. */
  private async commit(open: OpenModel, saved: ModelState | null, reframe: boolean): Promise<boolean> {
    const viewer = this.requireViewer();
    // The previous model's setup is saved before the view changes under it.
    await this.persistence.flush();
    this.tools?.pausePlayback();
    const doc = open.loaded.doc;
    const nodes = doc.nodes.length;
    const meshes = doc.meshes.length;
    const sameShape = !reframe && this.nodeVisible.length === nodes && this.meshVisible.length === meshes;
    let nodeVisible = doc.nodes.map((node) => node.visible);
    let meshVisible = doc.meshes.map((mesh) => mesh.visible);
    let lockedNodes = Array.from({ length: nodes }, () => false);
    let lockedMeshes = Array.from({ length: meshes }, () => false);
    let names: ReadonlyMap<string, string> = new Map();
    let nodeEdits: readonly NodeEdit[] = [];
    if (saved) {
      nodeVisible = visibilityFromHidden(nodes, saved.hiddenNodes);
      meshVisible = visibilityFromHidden(meshes, saved.hiddenMeshes);
      lockedNodes = lockedFromIndices(nodes, saved.lockedNodes ?? []);
      lockedMeshes = lockedFromIndices(meshes, saved.lockedMeshes ?? []);
      names = new Map(
        Object.entries(saved.names ?? {}).filter(([key]) => {
          const index = Number(key.slice(2));
          return index < (key.startsWith('n') ? nodes : meshes);
        }),
      );
      nodeEdits = (saved.nodeEdits ?? []).filter((edit) => edit.node < nodes);
    } else if (sameShape) {
      nodeVisible = this.nodeVisible;
      meshVisible = this.meshVisible;
      lockedNodes = this.lockedNodes;
      lockedMeshes = this.lockedMeshes;
      names = this.names;
      nodeEdits = this.nodeEdits;
    }
    let filters = textureFilters(doc);
    const savedFilters = saved?.textureFilters;
    if (savedFilters) {
      filters = filters.map((own, i) => savedFilters[i] ?? own);
    } else if (!saved && !reframe && this.textureFilter.length === filters.length) {
      filters = this.textureFilter;
    }
    const look = (saved && Object.hasOwn(LOOK_PRESETS, saved.look) ? LOOK_PRESETS[saved.look] : undefined) ?? this.look;
    const filteredBase = withTextureFilters(doc, filters);
    const setup: SetupState = {
      nodeVisible,
      meshVisible,
      textureFilter: filters,
      lockedNodes,
      lockedMeshes,
      names,
      nodeEdits,
    };
    const { rest, shown } = this.shownDocument(filteredBase, setup);
    this.committing = true;
    let result;
    try {
      result = await this.setDocument(viewer, shown, reframe);
      if (!result.applied) return false;
      this.look = applyLook(look, [viewer, this.renderSession.existingTracer()]);
      if (this.open?.loaded.key !== open.loaded.key) this.selection.set(null);
      this.open = open;
      this.arms = open.arms;
      this.base = doc;
      this.filteredBase = filteredBase;
      this.restDoc = rest;
      this.nodeVisible = [...nodeVisible];
      this.meshVisible = [...meshVisible];
      this.textureFilter = [...filters];
      this.lockedNodes = [...lockedNodes];
      this.lockedMeshes = [...lockedMeshes];
      this.names = names;
      this.nodeEdits = nodeEdits;
      this.history.clear();
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
    void this.startTools();
    const notes = [...open.loaded.warnings, ...result.warnings.map((w) => w.message)];
    const shownNotes = notes.slice(0, MAX_WARNING_NOTES).join(' ');
    this.notices.status(
      notes.length > 0
        ? `Opened ${open.loaded.name} with ${notes.length} note(s): ${shownNotes}`
        : `Opened ${open.loaded.name}.`,
    );
    return true;
  }

  // The overlay, picking, gizmo and timeline load once, after the first model is shown.
  private async startTools(): Promise<void> {
    if (this.tools) {
      this.tools.modelChanged();
      return;
    }
    const viewer = this.viewer;
    if (this.toolsLoading || !viewer) return;
    this.toolsLoading = true;
    try {
      const { EditorTools } = await loadEditorTools();
      this.tools = new EditorTools({
        viewer,
        selection: this.selection,
        layout: this.layoutStore,
        viewport: byId('viewport', HTMLElement),
        overlay: byId('overlay', HTMLCanvasElement),
        timeline: byId('timeline', HTMLElement),
        stats: byId('stats', HTMLElement),
        state: () =>
          this.restDoc
            ? {
                rest: this.restDoc,
                edits: this.nodeEdits,
                lock: { lockedNodes: this.lockedNodes, lockedMeshes: this.lockedMeshes },
                look: this.look,
              }
            : null,
        commitEdit: (edit) => this.commitNodeEdit(edit),
        interacted: () => this.invalidateRender(),
      });
      if (this.cssSize) this.tools.resize(this.cssSize);
      this.tools.modelChanged();
      document.body.dataset['editor'] = 'ready';
    } catch (error) {
      this.notices.status(`The editor tools could not load: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.toolsLoading = false;
    }
  }

  private inspectorModel(): InspectorModel | null {
    const open = this.open;
    if (!open || !this.base) return null;
    return {
      doc: this.base,
      names: this.names,
      selection: this.selection.current,
      edits: this.nodeEdits,
      nodeVisible: this.nodeVisible,
      meshVisible: this.meshVisible,
      lockedNodes: this.lockedNodes,
      lockedMeshes: this.lockedMeshes,
      textureFilter: this.textureFilter,
      player: open.loaded.kind === 'skin' ? { arms: this.arms } : null,
      look: this.look,
    };
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
            lockedNodes: this.lockedNodes,
            lockedMeshes: this.lockedMeshes,
            names: this.names,
          }
        : null,
      this.selection.current,
    );
    this.inspector.update(this.inspectorModel());
    this.lookPanel.show(this.look.id);
    this.cameraPanel.sync();
    this.renderPanel.show(this.renderValues);
    this.syncHistoryButtons();
    this.setActionsEnabled();
  }

  private setActionsEnabled(): void {
    const ready = this.open !== null && this.viewer !== null;
    const idle = !this.renderSession.busy && !this.exporting;
    this.renderButton.disabled = !ready || !idle;
    this.exportButton.disabled = !ready || !idle;
    this.menuExportButton.disabled = !ready || !idle;
    this.modeRender.disabled = !ready || !idle;
    this.syncMode();
  }

  private syncHistoryButtons(): void {
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
  }

  private setVisible(flags: boolean[], index: number, visible: boolean): void {
    if (this.loading) {
      // The scene of the new files is being prepared; the panel goes back to what the shown model has.
      this.showPanels();
      return;
    }
    const isNode = flags === this.nodeVisible;
    void this.queueSetup((state) => {
      const list = [...(isNode ? state.nodeVisible : state.meshVisible)];
      list[index] = visible;
      return isNode ? { ...state, nodeVisible: list } : { ...state, meshVisible: list };
    });
  }

  private setLocked(kind: 'node' | 'mesh', index: number, locked: boolean): void {
    if (this.loading) {
      this.showPanels();
      return;
    }
    void this.queueSetup((state) => {
      const list = [...(kind === 'node' ? state.lockedNodes : state.lockedMeshes)];
      list[index] = locked;
      return kind === 'node' ? { ...state, lockedNodes: list } : { ...state, lockedMeshes: list };
    });
  }

  private rename(kind: 'node' | 'mesh', index: number, name: string): void {
    if (this.loading) {
      this.showPanels();
      return;
    }
    const key = `${kind === 'node' ? 'n' : 'm'}:${index}`;
    void this.queueSetup((state) => {
      if ((state.names.get(key) ?? '') === name) return state;
      const names = new Map(state.names);
      if (name === '') names.delete(key);
      else names.set(key, name);
      return { ...state, names };
    });
  }

  private setTransform(node: number, translation: Vec3, rotation: Vec3): void {
    if (this.loading) {
      this.showPanels();
      return;
    }
    void this.commitNodeEdit({ node, translation, rotation });
  }

  private commitNodeEdit(edit: NodeEdit): Promise<boolean> {
    return this.queueSetup((state) => {
      const rest = this.restDoc;
      if (!rest || edit.node >= rest.nodes.length) return state;
      return { ...state, nodeEdits: setNodeEdit(rest, state.nodeEdits, edit) };
    });
  }

  private setTextureFilter(index: number, filter: SceneTextureFilter): void {
    if (this.loading) {
      this.showPanels();
      return;
    }
    void this.queueSetup((state) => {
      if (index < 0 || index >= state.textureFilter.length) return state;
      const textureFilter = [...state.textureFilter];
      textureFilter[index] = filter;
      return { ...state, textureFilter };
    });
  }

  private showLight(light: 'key' | 'rim'): void {
    if (!this.panelLayout.visible('inspector')) this.panelLayout.toggle('inspector');
    this.inspector.showLight(light);
  }

  // Changes run one after the other, each from the state the one before left, and a change is kept only once the scene
  // shows it: when the scene cannot be built the old one stays, and so do the panel and the saved record.
  private queueSetup(change: (state: SetupState) => SetupState, record = true): Promise<boolean> {
    const run = this.setupQueue.then(() => this.applySetup(change, record));
    this.setupQueue = run;
    return run;
  }

  private async applySetup(change: (state: SetupState) => SetupState, record: boolean): Promise<boolean> {
    const base = this.base;
    const filteredBase = this.filteredBase;
    const viewer = this.viewer;
    if (!base || !filteredBase || !viewer) return false;
    const current = this.setupState();
    const next = change(current);
    if (next === current) return true;
    try {
      const sceneChanged =
        next.nodeVisible !== current.nodeVisible ||
        next.meshVisible !== current.meshVisible ||
        next.textureFilter !== current.textureFilter ||
        next.nodeEdits !== current.nodeEdits;
      let filtered = filteredBase;
      let rest = this.restDoc;
      if (sceneChanged) {
        // Rebuilt only when a filter changed, so a visibility change keeps the textures array the baker and tracer know.
        filtered =
          next.textureFilter === current.textureFilter ? filteredBase : withTextureFilters(base, next.textureFilter);
        const shown = this.shownDocument(filtered, next);
        const result = await this.setDocument(viewer, shown.shown, false);
        if (!result.applied || this.base !== base) {
          this.showPanels();
          return false;
        }
        rest = shown.rest;
      }
      if (record) this.history.record({ setup: current, look: this.look.id });
      this.filteredBase = filtered;
      this.restDoc = rest;
      this.nodeVisible = next.nodeVisible;
      this.meshVisible = next.meshVisible;
      this.textureFilter = next.textureFilter;
      this.lockedNodes = next.lockedNodes;
      this.lockedMeshes = next.lockedMeshes;
      this.names = next.names;
      this.nodeEdits = next.nodeEdits;
      this.syncHistoryButtons();
      this.showPanels();
      if (sceneChanged) this.tools?.documentChanged();
      else this.tools?.refresh();
      this.scheduleSave();
      return true;
    } catch (error) {
      this.showPanels();
      this.notices.alert(`Could not update the view: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private undo(): void {
    void this.stepHistory('undo');
  }

  private redo(): void {
    void this.stepHistory('redo');
  }

  private stepHistory(direction: 'undo' | 'redo'): Promise<unknown> {
    const run = this.setupQueue.then(async () => {
      if (!this.base || this.loading) return;
      const now: HistoryEntry = { setup: this.setupState(), look: this.look.id };
      const show = async (entry: HistoryEntry): Promise<boolean> => {
        const applied = await this.applySetup(() => entry.setup, false);
        if (applied && entry.look !== this.look.id) this.selectLook(entry.look, false);
        return applied;
      };
      await (direction === 'undo' ? this.history.undo(now, show) : this.history.redo(now, show));
      this.syncHistoryButtons();
    });
    this.setupQueue = run;
    return run;
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

  private selectLook(id: string, record = true): void {
    const preset = Object.hasOwn(LOOK_PRESETS, id) ? LOOK_PRESETS[id] : undefined;
    if (!preset || !this.viewer) return;
    if (record && preset.id !== this.look.id && this.base) {
      this.history.record({ setup: this.setupState(), look: this.look.id });
      this.syncHistoryButtons();
    }
    this.look = applyLook(preset, [this.viewer, this.renderSession.existingTracer()]);
    this.lookPanel.show(this.look.id);
    this.inspector.update(this.inspectorModel());
    this.tools?.refresh();
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
    const lockedNodes = lockedIndices(this.lockedNodes);
    const lockedMeshes = lockedIndices(this.lockedMeshes);
    return {
      camera: this.requireViewer().orbit.state(),
      look: this.look.id,
      hiddenNodes: hiddenIndices(this.nodeVisible),
      hiddenMeshes: hiddenIndices(this.meshVisible),
      textureFilters: [...this.textureFilter],
      ...(this.open?.loaded.kind === 'skin' ? { arms: this.arms } : {}),
      ...(this.names.size > 0 ? { names: Object.fromEntries(this.names) } : {}),
      ...(lockedNodes.length > 0 ? { lockedNodes } : {}),
      ...(lockedMeshes.length > 0 ? { lockedMeshes } : {}),
      ...(this.nodeEdits.length > 0 ? { nodeEdits: this.nodeEdits } : {}),
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
    this.tools?.pausePlayback();
    // The canvas keeps the previous render (preserveDrawingBuffer): shown again once this one has its first sample.
    this.resultCanvas.hidden = true;
    this.progressBox.hidden = false;
    this.progress.value = 0;
    this.notices.status('Rendering: preparing the scene…');
    this.setActionsEnabled();
    void this.renderSession.render().finally(() => this.setActionsEnabled());
    this.setActionsEnabled();
  }

  private renderProgress(done: number, target: number): void {
    if (done > 0) this.resultCanvas.hidden = false;
    this.progress.value = target > 0 ? done / target : 0;
    this.notices.status(`Rendering: ${done} of ${target} samples.`);
    this.syncMode();
  }

  private renderDone(warnings: readonly string[]): void {
    // A count of finished renders for the tests to wait on; a page has no use for it.
    this.resultCanvas.dataset['renders'] = String(Number(this.resultCanvas.dataset['renders'] ?? 0) + 1);
    this.resultCanvas.hidden = false;
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
    this.notices.status('Render failed.');
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
    this.syncMode();
  }

  // Preview or Render in the top bar follows whether the render canvas is shown; a click on Preview hides it.
  private syncMode(): void {
    const showing = !this.resultCanvas.hidden;
    this.modePreview.checked = !showing;
    this.modeRender.checked = showing;
    this.shareButton.hidden = !(showing && !this.renderSession.busy && canShareFiles());
  }

  private beginExport(): boolean {
    if (this.renderSession.busy) {
      this.notices.status('Wait for the render to finish, or cancel it, before exporting.');
      return false;
    }
    this.tools?.pausePlayback();
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
    this.tools?.pausePlayback();
    void this.exportDialog.open().catch((error: unknown) => {
      this.notices.alert(`The export could not start: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private share(): void {
    const name = this.open?.loaded.name ?? 'model';
    this.resultCanvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `${name.replace(/\.[^.]+$/, '')}-modelshot.png`, { type: 'image/png' });
      navigator.share({ files: [file] }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        this.notices.alert(`Could not share the image: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 'image/png');
  }

  private async forget(): Promise<void> {
    try {
      await this.persistence.forget();
      this.notices.status('Local data deleted: the last model and your settings are gone from this browser.');
    } catch (error) {
      this.notices.alert(`Could not delete the local data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // G: every overlay off, or back to the starting set when all are off.
  private toggleOverlays(): void {
    const any = Object.values(this.layoutStore.state.overlays).some(Boolean);
    this.layoutStore.update({
      overlays: any
        ? { grid: false, axis: false, stats: false, presets: false, gizmos: false }
        : DEFAULT_LAYOUT.overlays,
    });
  }

  private bindControls(): void {
    const openButton = byId('open-button', HTMLButtonElement);
    bindDisclosure(byId('file-menu-button', HTMLButtonElement), byId('file-menu', HTMLElement));
    bindDisclosure(byId('add-menu-button', HTMLButtonElement), byId('add-menu', HTMLElement));
    openButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      const files = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      if (files.length > 0) void this.openFiles(files);
    });
    this.renderButton.addEventListener('click', () => this.render());
    this.exportButton.addEventListener('click', () => this.openExport());
    this.menuExportButton.addEventListener('click', () => this.openExport());
    this.undoButton.addEventListener('click', () => this.undo());
    this.redoButton.addEventListener('click', () => this.redo());
    this.shareButton.addEventListener('click', () => this.share());
    this.modePreview.addEventListener('change', () => {
      if (!this.modePreview.checked) return;
      this.resultCanvas.hidden = true;
      this.syncMode();
    });
    this.modeRender.addEventListener('change', () => {
      if (!this.modeRender.checked) return;
      if (this.resultCanvas.dataset['renders'] && !this.renderSession.busy) {
        this.resultCanvas.hidden = false;
        this.syncMode();
      } else {
        this.render();
      }
    });
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
    const panel = (id: PanelId) => () => this.panelLayout.toggle(id);
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
      undo: () => this.undo(),
      redo: () => this.redo(),
      playPause: () => this.tools?.togglePlay(),
      move: () => this.tools?.setGizmoMode('move'),
      rotate: () => this.tools?.setGizmoMode('rotate'),
      overlays: () => this.toggleOverlays(),
      rename: () => this.scenePanel.renameSelected(),
      outliner: panel('outliner'),
      inspector: panel('inspector'),
      timeline: panel('timeline'),
    });
    const flush = (): void => void this.persistence.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [probe] }) === true;
  } catch {
    return false;
  }
}
