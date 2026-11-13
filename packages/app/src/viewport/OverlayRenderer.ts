import type { CanvasCssSize } from '@modelshot/renderer-rt';
import {
  cameraBasis,
  sceneBounds,
  type SceneBounds,
  type SceneCamera,
  type SceneDocument,
  type Vec3,
} from '@modelshot/scene';
import { AXIS_BOX_PX, type AxisInsets } from './axisPlacement';
import { gizmoHandles, type GizmoHandle } from './gizmoDrag';
import { gizmoFrame, type GizmoFrame } from './gizmoFrame';
import { lightGlyph, type LightGlyph } from './lightGlyph';
import { BOX_EDGES, MAX_OUTLINE_BOXES, enclosingBox, placedBoxes, subtreeMeshes } from './meshBoxes';
import type { OverlayScene } from './OverlayScene';
import { Projector, type ScreenPoint } from './Projector';

const TIMING_WINDOW = 60;
const MAX_GRID_LINES = 40;
/** Longest arrow of the axis gizmo and where its letters stand, from the box centre: both inside the 56 px box. */
const AXIS_ARROW_PX = 19;
const AXIS_LABEL_PX = 22;
/** How near a pointer must be to the key light's helper to name it. */
const HELPER_HIT_PX = 12;

export interface HelperHit {
  readonly id: 'key-light';
  readonly label: string;
  readonly x: number;
  readonly y: number;
}
const AXIS_COLOURS = ['--ms-color-flash', '--ms-color-sun', '--ms-color-blue-mid'] as const;

const EMPTY: OverlayScene = {
  doc: null,
  selection: null,
  overlays: { grid: true, axis: true, stats: false, presets: true, gizmos: true },
  gizmo: null,
  keyDirection: null,
  activeAxis: null,
};

// The 2D layer above the preview: grid floor, axis gizmo, selection outline, light and transform gizmos. It reads the
// camera the renderer just drew with and writes only its own canvas, so no pixel of the preview, the render or an
// export can carry it.
export class OverlayRenderer {
  private readonly context: CanvasRenderingContext2D;
  private scene: OverlayScene = EMPTY;
  private camera: SceneCamera | null = null;
  private size: CanvasCssSize = { cssWidth: 1, cssHeight: 1, devicePixelRatio: 1 };
  private lastProjector: Projector | null = null;
  private lastHandles: GizmoHandle[] = [];
  private lastFrame: GizmoFrame | null = null;
  private cachedBounds: { doc: SceneDocument; bounds: SceneBounds | null } | null = null;
  private readonly timings: number[] = [];
  private readonly colours = new Map<string, string>();
  private insets: AxisInsets = { left: 12, bottom: 12 };
  private lastAxisBounds: { x: number; y: number; width: number; height: number } | null = null;
  private lastGlyph: LightGlyph | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The overlay layer needs a 2D canvas.');
    this.context = context;
  }

  get projector(): Projector | null {
    return this.lastProjector;
  }

  get handles(): readonly GizmoHandle[] {
    return this.lastHandles;
  }

  get frame(): GizmoFrame | null {
    return this.lastFrame;
  }

  get currentCamera(): SceneCamera | null {
    return this.camera;
  }

  /** The axis gizmo's box in CSS px of the view, or null while it is not drawn. */
  get axisBounds(): { x: number; y: number; width: number; height: number } | null {
    return this.lastAxisBounds;
  }

  /** Where the key light's helper is drawn (CSS px of the view), or null while it is not. */
  get helperAnchor(): { x: number; y: number } | null {
    return this.lastGlyph ? { x: this.lastGlyph.anchor.x, y: this.lastGlyph.anchor.y } : null;
  }

  /** Where the axis gizmo stands: its box's distance from the view's left and bottom edges. */
  setInsets(insets: AxisInsets): void {
    this.insets = insets;
    this.redraw();
  }

  /** The light helper under a point of the view (CSS px), or null. */
  helperAt(x: number, y: number): HelperHit | null {
    const glyph = this.lastGlyph;
    if (!glyph) return null;
    const points = [glyph.marker, glyph.ring, glyph.head, glyph.anchor, ...(glyph.shaft ?? [])].filter(
      (p): p is NonNullable<typeof p> => p !== null,
    );
    const near = points.some((p) => Math.hypot(p.x - x, p.y - y) <= HELPER_HIT_PX) || this.nearShaft(glyph, x, y);
    return near ? { id: 'key-light', label: 'Key light', x: glyph.anchor.x, y: glyph.anchor.y } : null;
  }

  private nearShaft(glyph: LightGlyph, x: number, y: number): boolean {
    if (!glyph.shaft) return false;
    const [a, b] = glyph.shaft;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / length2));
    return Math.hypot(a.x + dx * t - x, a.y + dy * t - y) <= HELPER_HIT_PX;
  }

  /** Median of the last draws in milliseconds. */
  get medianDrawMs(): number {
    const sorted = [...this.timings].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }

  resize(size: CanvasCssSize): void {
    this.size = size;
    this.canvas.width = Math.max(1, Math.round(size.cssWidth * size.devicePixelRatio));
    this.canvas.height = Math.max(1, Math.round(size.cssHeight * size.devicePixelRatio));
    this.redraw();
  }

  setScene(scene: OverlayScene): void {
    this.scene = scene;
    this.redraw();
  }

  /** Draws with the camera of the frame the renderer just finished. */
  draw(camera: SceneCamera): void {
    this.camera = camera;
    const start = performance.now();
    this.paint(camera);
    this.timings.push(performance.now() - start);
    if (this.timings.length > TIMING_WINDOW) this.timings.shift();
  }

  redraw(): void {
    if (this.camera) this.draw(this.camera);
  }

  private colour(token: string): string {
    let value = this.colours.get(token);
    if (value === undefined) {
      value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      this.colours.set(token, value);
    }
    return value;
  }

  private bounds(doc: SceneDocument): SceneBounds | null {
    if (this.cachedBounds?.doc !== doc) this.cachedBounds = { doc, bounds: sceneBounds(doc) };
    return this.cachedBounds.bounds;
  }

  private hairline(): number {
    return 1 / this.size.devicePixelRatio;
  }

  private paint(camera: SceneCamera): void {
    const { context: c } = this;
    const { cssWidth, cssHeight, devicePixelRatio } = this.size;
    c.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    c.clearRect(0, 0, cssWidth, cssHeight);
    this.lastHandles = [];
    this.lastFrame = null;
    this.lastGlyph = null;
    this.lastAxisBounds = null;
    let projector: Projector;
    try {
      projector = new Projector(camera, cssWidth, cssHeight);
    } catch {
      this.lastProjector = null;
      return;
    }
    this.lastProjector = projector;
    c.lineWidth = this.hairline();
    c.lineJoin = 'round';
    const { doc, overlays } = this.scene;
    const bounds = doc ? this.bounds(doc) : null;
    if (doc && bounds && overlays.grid) this.grid(projector, bounds);
    if (doc && this.scene.selection) this.outline(projector, doc);
    if (doc && bounds && overlays.gizmos) {
      if (this.scene.keyDirection) this.keyLight(projector, bounds, this.scene.keyDirection, cssWidth, cssHeight);
      if (this.scene.gizmo) this.transformGizmo(projector, doc, this.scene.gizmo);
    }
    if (overlays.axis) this.axes(camera, cssHeight);
  }

  private line(a: ScreenPoint, b: ScreenPoint): void {
    this.context.moveTo(a.x, a.y);
    this.context.lineTo(b.x, b.y);
  }

  private grid(projector: Projector, bounds: SceneBounds): void {
    const { context: c } = this;
    const half = bounds.radius * 2;
    const step = 10 ** Math.floor(Math.log10(Math.max(half, 1e-6) / 8));
    const count = Math.min(MAX_GRID_LINES, Math.ceil(half / step));
    const y = bounds.min[1];
    const cx = Math.round(bounds.center[0] / step) * step;
    const cz = Math.round(bounds.center[2] / step) * step;
    const reach = count * step;
    c.beginPath();
    for (let i = -count; i <= count; i++) {
      const along = [
        projector.project([cx + i * step, y, cz - reach]),
        projector.project([cx + i * step, y, cz + reach]),
      ];
      const across = [
        projector.project([cx - reach, y, cz + i * step]),
        projector.project([cx + reach, y, cz + i * step]),
      ];
      for (const [a, b] of [along, across]) if (a && b) this.line(a, b);
    }
    c.strokeStyle = this.colour('--ms-color-muted-on-ink');
    c.globalAlpha = 0.28;
    c.stroke();
    c.globalAlpha = 1;
  }

  private outline(projector: Projector, doc: SceneDocument): void {
    const target = this.scene.selection;
    if (!target) return;
    const meshes = target.kind === 'mesh' ? new Set([target.index]) : subtreeMeshes(doc, target.index);
    const boxes = placedBoxes(doc, meshes);
    let sets: Vec3[][] = boxes.map((b) => b.corners);
    if (boxes.length > MAX_OUTLINE_BOXES) {
      const whole = enclosingBox(boxes);
      sets = whole ? [whole] : [];
    }
    const { context: c } = this;
    c.beginPath();
    for (const corners of sets) {
      const screen = corners.map((p) => projector.project(p));
      for (const [i, j] of BOX_EDGES) {
        const a = screen[i];
        const b = screen[j];
        if (a && b) this.line(a, b);
      }
    }
    c.strokeStyle = this.colour('--ms-color-sun');
    c.lineWidth = 2 * this.hairline();
    c.stroke();
    c.lineWidth = this.hairline();
  }

  private keyLight(projector: Projector, bounds: SceneBounds, direction: Vec3, width: number, height: number): void {
    const { context: c } = this;
    const at = (distance: number): Vec3 => [
      bounds.center[0] + direction[0] * bounds.radius * distance,
      bounds.center[1] + direction[1] * bounds.radius * distance,
      bounds.center[2] + direction[2] * bounds.radius * distance,
    ];
    const a = projector.project(at(1.8));
    const b = projector.project(at(1.1));
    if (!a || !b) return;
    const glyph = lightGlyph(a, b, width, height);
    if (!glyph) return;
    this.lastGlyph = glyph;
    c.strokeStyle = this.colour('--ms-color-sun');
    c.beginPath();
    if (glyph.shaft && glyph.head) {
      const [from, to] = glyph.shaft;
      this.line(from, to);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      for (const turn of [2.6, -2.6]) {
        c.moveTo(glyph.head.x, glyph.head.y);
        c.lineTo(glyph.head.x + Math.cos(angle + turn) * 8, glyph.head.y + Math.sin(angle + turn) * 8);
      }
    }
    if (glyph.ring) {
      c.moveTo(glyph.ring.x + 5, glyph.ring.y);
      c.arc(glyph.ring.x, glyph.ring.y, 5, 0, Math.PI * 2);
    }
    if (glyph.marker) {
      c.moveTo(glyph.marker.x + 5, glyph.marker.y);
      c.arc(glyph.marker.x, glyph.marker.y, 5, 0, Math.PI * 2);
    }
    c.stroke();
  }

  private transformGizmo(projector: Projector, doc: SceneDocument, gizmo: NonNullable<OverlayScene['gizmo']>): void {
    const frame = gizmoFrame(doc, gizmo.node, gizmo.mode);
    if (!frame) return;
    this.lastFrame = frame;
    this.lastHandles = gizmoHandles(projector, frame, gizmo.mode);
    const { context: c } = this;
    for (const handle of this.lastHandles) {
      const active = this.scene.activeAxis === handle.axis;
      c.beginPath();
      handle.polyline.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
      c.strokeStyle = this.colour(active ? '--ms-focus-on-dark' : (AXIS_COLOURS[handle.axis] ?? AXIS_COLOURS[0]));
      c.lineWidth = (active ? 3 : 2) * this.hairline();
      c.stroke();
    }
    c.lineWidth = this.hairline();
  }

  private axes(camera: SceneCamera, height: number): void {
    const { context: c } = this;
    const { right, up } = cameraBasis(camera);
    const half = AXIS_BOX_PX / 2;
    const cx = this.insets.left + half;
    const cy = height - this.insets.bottom - half;
    this.lastAxisBounds = { x: this.insets.left, y: cy - half, width: AXIS_BOX_PX, height: AXIS_BOX_PX };
    c.beginPath();
    c.arc(cx, cy, half, 0, Math.PI * 2);
    c.globalAlpha = 0.55;
    c.fillStyle = this.colour('--ms-color-ground');
    c.fill();
    c.globalAlpha = 1;
    c.font = `600 11px ${this.colour('--ms-font-mono')}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const axes: [Vec3, string][] = [
      [[1, 0, 0], 'X'],
      [[0, 1, 0], 'Y'],
      [[0, 0, 1], 'Z'],
    ];
    axes.forEach(([axis, label], index) => {
      const colour = this.colour(AXIS_COLOURS[index] ?? AXIS_COLOURS[0]);
      const ux = axis[0] * right[0] + axis[1] * right[1] + axis[2] * right[2];
      const uy = -(axis[0] * up[0] + axis[1] * up[1] + axis[2] * up[2]);
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + ux * AXIS_ARROW_PX, cy + uy * AXIS_ARROW_PX);
      c.strokeStyle = colour;
      c.lineWidth = 2 * this.hairline();
      c.stroke();
      c.fillStyle = colour;
      c.fillText(label, cx + ux * AXIS_LABEL_PX, cy + uy * AXIS_LABEL_PX);
    });
    c.lineWidth = this.hairline();
  }
}
