import type { CanvasCssSize } from '@modelshot/renderer-rt';
import {
  cameraBasis,
  sceneBounds,
  type SceneBounds,
  type SceneCamera,
  type SceneDocument,
  type Vec3,
} from '@modelshot/scene';
import { gizmoHandles, type GizmoHandle } from './gizmoDrag';
import { gizmoFrame, type GizmoFrame } from './gizmoFrame';
import { BOX_EDGES, MAX_OUTLINE_BOXES, enclosingBox, placedBoxes, subtreeMeshes } from './meshBoxes';
import type { OverlayScene } from './OverlayScene';
import { Projector, type ScreenPoint } from './projectPoints';

const TIMING_WINDOW = 60;
const MAX_GRID_LINES = 40;
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
      if (this.scene.keyDirection) this.keyLight(projector, bounds, this.scene.keyDirection);
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

  private keyLight(projector: Projector, bounds: SceneBounds, direction: Vec3): void {
    const { context: c } = this;
    const at = (distance: number): Vec3 => [
      bounds.center[0] + direction[0] * bounds.radius * distance,
      bounds.center[1] + direction[1] * bounds.radius * distance,
      bounds.center[2] + direction[2] * bounds.radius * distance,
    ];
    const a = projector.project(at(1.8));
    const b = projector.project(at(1.1));
    if (!a || !b) return;
    c.beginPath();
    this.line(a, b);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (const turn of [2.6, -2.6]) {
      c.moveTo(b.x, b.y);
      c.lineTo(b.x + Math.cos(angle + turn) * 8, b.y + Math.sin(angle + turn) * 8);
    }
    c.moveTo(a.x + 5, a.y);
    c.arc(a.x, a.y, 5, 0, Math.PI * 2);
    c.strokeStyle = this.colour('--ms-color-sun');
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
    const cx = 44;
    const cy = height - 44;
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
      const dx = (axis[0] * right[0] + axis[1] * right[1] + axis[2] * right[2]) * 26;
      const dy = -(axis[0] * up[0] + axis[1] * up[1] + axis[2] * up[2]) * 26;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + dx, cy + dy);
      c.strokeStyle = colour;
      c.lineWidth = 2 * this.hairline();
      c.stroke();
      c.fillStyle = colour;
      c.fillText(label, cx + dx * 1.3, cy + dy * 1.3);
    });
    c.lineWidth = this.hairline();
  }
}
