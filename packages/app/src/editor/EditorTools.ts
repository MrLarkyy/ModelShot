import type { LookPreset } from '@modelshot/looks';
import type { CanvasCssSize } from '@modelshot/renderer-rt';
import { animateScene, type SceneCamera, type SceneDocument, type Vec3 } from '@modelshot/scene';
import type { LayoutStore } from '../layout/LayoutStore';
import type { NodeEdit } from '../session/NodeEdit';
import { nodeTransform, setNodeEdit, withNodeEdits } from '../session/withNodeEdits';
import { Timeline } from '../timeline/Timeline';
import type { Viewer } from '../viewer/Viewer';
import { hitHandle, moveDelta, rotateDelta } from '../viewport/gizmoDrag';
import type { GizmoMode } from '../viewport/gizmoFrame';
import { OverlayRenderer } from '../viewport/OverlayRenderer';
import type { OverlayScene } from '../viewport/OverlayScene';
import { pickMesh } from '../viewport/pickMesh';
import { StatsOverlay } from '../viewport/StatsOverlay';
import { isMeshLocked, isNodeLocked, type LockState } from './isLocked';
import type { Selection } from './Selection';

/** A pointer that moves less than this between press and release is a click, not an orbit. */
export const CLICK_SLOP_PX = 4;
const HANDLE_TOLERANCE_PX = 10;
/** A pose that stays this long is lit again; frames of a playing clip or a drag never are. */
export const RELIGHT_DELAY_MS = 200;

export interface EditorState {
  /** The rest pose with visibility and filters, before the node edits. */
  readonly rest: SceneDocument;
  readonly edits: readonly NodeEdit[];
  readonly lock: LockState;
  readonly look: LookPreset;
}

export interface EditorToolsHost {
  readonly viewer: Viewer;
  readonly selection: Selection;
  readonly layout: LayoutStore;
  readonly viewport: HTMLElement;
  readonly overlay: HTMLCanvasElement;
  readonly timeline: HTMLElement;
  readonly stats: HTMLElement;
  /** The model on show, or null while there is none. */
  readonly state: () => EditorState | null;
  /**
   * Commits an edit of one node (an undoable step) and calls `documentChanged` once it is shown; resolves false when the
   * scene could not show it.
   */
  readonly commitEdit: (edit: NodeEdit) => Promise<boolean>;
  /** The user acted on the preview: a render in progress or a finished one no longer matches. */
  readonly interacted: () => void;
}

// The pieces of the editor that draw over or act on the viewport: the overlay layer, picking, the move and rotate
// gizmo, the stats readout and the timeline. They load after the first model is shown, so the empty app does not carry
// them.
export class EditorTools {
  readonly overlay: OverlayRenderer;
  readonly timeline: Timeline;
  private readonly stats: StatsOverlay;
  private mode: GizmoMode = 'move';
  private activeAxis: 0 | 1 | 2 | null = null;
  private drag: {
    readonly axis: 0 | 1 | 2;
    readonly from: { x: number; y: number };
    readonly node: number;
    readonly start: NodeEdit;
    live: NodeEdit;
  } | null = null;
  private press: { readonly x: number; readonly y: number; readonly id: number } | null = null;
  private readonly cleanups: (() => void)[] = [];
  private relightTimer: ReturnType<typeof setTimeout> | null = null;
  private relightOwed = false;

  constructor(private readonly host: EditorToolsHost) {
    this.overlay = new OverlayRenderer(host.overlay);
    this.stats = new StatsOverlay(host.stats);
    this.timeline = new Timeline(host.timeline, {
      frame: (clip, time, loop) => this.playFrame(clip, time, loop),
      interacted: () => host.interacted(),
      playingChanged: (playing) => {
        if (playing) this.cancelRelight();
        else if (this.timeline.posed) this.scheduleRelight();
      },
    });
    const { viewport } = host;
    viewport.addEventListener('pointerdown', this.onDown, true);
    viewport.addEventListener('pointermove', this.onMove);
    viewport.addEventListener('pointerup', this.onUp);
    viewport.addEventListener('pointercancel', this.onCancel);
    this.cleanups.push(
      () => viewport.removeEventListener('pointerdown', this.onDown, true),
      () => viewport.removeEventListener('pointermove', this.onMove),
      () => viewport.removeEventListener('pointerup', this.onUp),
      () => viewport.removeEventListener('pointercancel', this.onCancel),
      host.selection.onChange(() => this.refresh()),
      host.layout.onChange(() => this.refresh()),
    );
  }

  get gizmoMode(): GizmoMode {
    return this.mode;
  }

  setGizmoMode(mode: GizmoMode): void {
    this.mode = mode;
    this.refresh();
  }

  resize(size: CanvasCssSize): void {
    this.overlay.resize(size);
  }

  /** The renderer drew a frame with `camera`. */
  frame(camera: SceneCamera): void {
    this.overlay.draw(camera);
    this.stats.frame(performance.now(), this.host.viewer.document, this.overlay.medianDrawMs);
  }

  /** A model was shown (or none): the clips and the overlay follow it. */
  modelChanged(): void {
    this.timeline.show(this.host.state()?.rest.animations ?? []);
    this.refresh();
  }

  /**
   * `documentChanged` shows a clip pose instead of the committed document and relights it, so the commit's
   * `setDocument` leaves out its own bake; at rest that bake is the only one.
   */
  get reposes(): boolean {
    return this.timeline.posed && (this.host.state()?.rest.animations?.length ?? 0) > 0;
  }

  /**
   * The shown document changed (an edit, visibility, undo) and was set with a bake unless `reposes`: the overlay
   * follows and a paused clip pose is shown again and lit once for it.
   */
  documentChanged(): void {
    this.showCommitted(true);
  }

  togglePlay(): void {
    this.host.interacted();
    this.timeline.toggle();
  }

  pausePlayback(): void {
    this.timeline.pause();
  }

  /** The node the gizmo stands on: the selected node, or the node of the selected element; null when locked or none. */
  gizmoNode(): number | null {
    const state = this.host.state();
    const target = this.host.selection.current;
    const doc = this.host.viewer.document;
    if (!state || !target || !doc) return null;
    const node = target.kind === 'node' ? target.index : (doc.meshes[target.index]?.node ?? -1);
    if (node < 0 || node >= doc.nodes.length) return null;
    const locked =
      target.kind === 'node' ? isNodeLocked(doc, state.lock, node) : isMeshLocked(doc, state.lock, target.index);
    return locked ? null : node;
  }

  refresh(): void {
    const state = this.host.state();
    const doc = this.host.viewer.document;
    const node = this.gizmoNode();
    const key = state?.look.lights.key.direction;
    const scene: OverlayScene = {
      doc,
      selection: this.host.selection.current,
      overlays: this.host.layout.state.overlays,
      gizmo: node === null ? null : { node, mode: this.mode },
      keyDirection: key ? [key[0], key[1], key[2]] : null,
      activeAxis: this.activeAxis,
    };
    this.host.stats.hidden = !this.host.layout.state.overlays.stats;
    this.overlay.setScene(scene);
    this.host.viewer.requestRender();
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cancelRelight();
    this.timeline.pause();
  }

  // The committed document in the pose the timeline shows: the clip pose when one is shown (relit when `relight`), else
  // the rest pose, whose light the commit baked.
  private showCommitted(relight: boolean): void {
    const state = this.host.state();
    if (!state) return;
    if (this.reposes) {
      void this.playFrame(this.timeline.clipIndex, this.timeline.time, this.timeline.looping, relight);
    } else {
      void this.showPose(withNodeEdits(state.rest, state.rest, state.edits));
    }
  }

  // The pose of the clip at `time` with the node edits on top, handed to the renderer's pose-only path.
  private async playFrame(clip: number, time: number, loop: boolean, relight = true): Promise<void> {
    const state = this.host.state();
    if (!state) return;
    const posed = animateScene(state.rest, { animation: clip, time, loop: loop ? 'loop' : 'hold' }).document;
    await this.showPose(withNodeEdits(posed, state.rest, state.edits));
    if (this.timeline.playing) this.cancelRelight();
    else if (relight) this.scheduleRelight();
  }

  // The baked light belongs to the pose it was baked for: when a pose stays (a pause, the end of a scrub, an edit) the
  // preview is lit again for it, once. One due during a gizmo drag waits for its end.
  private scheduleRelight(): void {
    this.cancelRelight();
    this.relightTimer = setTimeout(() => {
      this.relightTimer = null;
      if (this.timeline.playing) return;
      if (this.drag === null) this.host.viewer.relight();
      else this.relightOwed = true;
    }, RELIGHT_DELAY_MS);
  }

  private cancelRelight(): void {
    this.relightOwed = false;
    if (this.relightTimer === null) return;
    clearTimeout(this.relightTimer);
    this.relightTimer = null;
  }

  // A drag that ends without a commit shows the pose from before it again; that pose keeps its light unless a relight
  // fell due during the drag.
  private endDragWithoutCommit(): void {
    const owed = this.relightOwed;
    this.relightOwed = false;
    this.showCommitted(false);
    if (owed) this.scheduleRelight();
  }

  private async showPose(doc: SceneDocument): Promise<void> {
    const viewer = this.host.viewer;
    await viewer.setPose(doc);
    this.refresh();
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.host.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.shiftKey || !event.isPrimary) return;
    // The buttons and menus over the view are not the view: a click on them selects nothing.
    if (event.target instanceof Element && event.target.closest('.chips')) return;
    const point = this.local(event);
    this.press = { x: point.x, y: point.y, id: event.pointerId };
    const node = this.gizmoNode();
    const state = this.host.state();
    const frame = this.overlay.frame;
    if (node === null || !state || !frame || !this.host.layout.state.overlays.gizmos) return;
    const handle = hitHandle(this.overlay.handles, point, HANDLE_TOLERANCE_PX);
    if (!handle) return;
    const start = nodeTransform(state.rest, state.edits, node);
    if (!start) return;
    event.stopPropagation();
    event.preventDefault();
    this.press = null;
    this.timeline.pause();
    this.host.interacted();
    this.activeAxis = handle.axis;
    this.drag = { axis: handle.axis, from: point, node, start, live: start };
    this.host.viewport.setPointerCapture?.(event.pointerId);
    this.refresh();
  };

  private readonly onMove = (event: PointerEvent): void => {
    const drag = this.drag;
    const state = this.host.state();
    const projector = this.overlay.projector;
    const frame = this.overlay.frame;
    if (!drag || !state || !projector || !frame) return;
    const point = this.local(event);
    const change =
      this.mode === 'move'
        ? moveDelta(projector, frame, drag.axis, drag.from, point)
        : rotateDelta(projector, frame, drag.axis, drag.from, point);
    const set = (v: Vec3): Vec3 => {
      const out: [number, number, number] = [v[0], v[1], v[2]];
      out[drag.axis] = (this.mode === 'move' ? drag.start.translation : drag.start.rotation)[drag.axis] + change;
      return out;
    };
    drag.live =
      this.mode === 'move'
        ? { ...drag.start, translation: set(drag.start.translation) }
        : { ...drag.start, rotation: set(drag.start.rotation) };
    const live = setNodeEdit(state.rest, state.edits, drag.live);
    const posed = this.timeline.posed ? this.animated(state) : state.rest;
    void this.showPose(withNodeEdits(posed, state.rest, live));
  };

  private readonly onUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (drag) {
      this.drag = null;
      this.activeAxis = null;
      this.host.viewport.releasePointerCapture?.(event.pointerId);
      const changed =
        drag.live.translation.some((v, i) => v !== drag.start.translation[i]) ||
        drag.live.rotation.some((v, i) => v !== drag.start.rotation[i]);
      if (!changed) {
        this.endDragWithoutCommit();
        return;
      }
      // An applied commit calls documentChanged, which lights the pose it shows; showing the committed pose again
      // afterwards (no light) keeps a refused commit from leaving the drag's last pose on show.
      this.relightOwed = false;
      void this.host.commitEdit(drag.live).then(() => this.showCommitted(false));
      return;
    }
    const press = this.press;
    this.press = null;
    if (!press || press.id !== event.pointerId) return;
    const point = this.local(event);
    if (Math.hypot(point.x - press.x, point.y - press.y) > CLICK_SLOP_PX) return;
    this.pick(point);
  };

  private readonly onCancel = (): void => {
    this.press = null;
    if (this.drag) {
      this.drag = null;
      this.activeAxis = null;
      this.endDragWithoutCommit();
    }
  };

  private animated(state: EditorState): SceneDocument {
    return animateScene(state.rest, {
      animation: this.timeline.clipIndex,
      time: this.timeline.time,
      loop: this.timeline.looping ? 'loop' : 'hold',
    }).document;
  }

  private pick(point: { x: number; y: number }): void {
    const state = this.host.state();
    const doc = this.host.viewer.document;
    const camera = this.overlay.currentCamera;
    const projector = this.overlay.projector;
    if (!state || !doc || !camera || !projector) return;
    const ndcX = (point.x / projector.width) * 2 - 1;
    const ndcY = 1 - (point.y / projector.height) * 2;
    const mesh = pickMesh(doc, state.lock, camera, projector.width / projector.height, ndcX, ndcY);
    this.host.selection.set(mesh === null ? null : { kind: 'mesh', index: mesh });
  }
}
