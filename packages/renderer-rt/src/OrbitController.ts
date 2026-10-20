import {
  fitClipPlanes,
  fitDistance,
  fitOrthoHeight,
  fitRadius,
  ISOMETRIC_PITCH_DEG,
  ISOMETRIC_YAW_DEG,
  orbitDirection,
  type SceneBounds,
  type SceneCamera,
  type Vec3,
} from '@modelshot/scene';

export interface OrbitControllerOptions {
  readonly yawDeg?: number;
  readonly pitchDeg?: number;
  readonly fovYDeg?: number;
  readonly projection?: 'perspective' | 'orthographic';
  /** Exponential smoothing of every change; `false` applies input at once. Default `true`. */
  readonly damping?: boolean;
  /** Time constant of the damping in milliseconds. Default 80. */
  readonly dampingMs?: number;
}

/** Everything that defines the view; the controller eases its current state towards a goal state. */
interface OrbitState {
  target: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  distance: number;
  orthoHeight: number;
}

export const MIN_PITCH_DEG = -89.5;
export const MAX_PITCH_DEG = 89.5;
export const MIN_FOV_DEG = 10;
export const MAX_FOV_DEG = 100;
/** Closest dolly, in bounding-sphere radii from the target. */
export const MIN_DISTANCE_RADII = 1.05;
/** Farthest dolly and largest ortho height, as multiples of the frame-to-fit value. */
export const MAX_ZOOM_OUT = 8;
/** Smallest ortho height, as a fraction of the frame-to-fit height. */
export const MAX_ORTHO_ZOOM_IN = 16;

const DEFAULT_YAW_DEG = 30;
const DEFAULT_PITCH_DEG = 20;
const DEFAULT_FOV_DEG = 35;
const DEFAULT_DAMPING_MS = 80;
/** Below this relative difference the eased state snaps to the goal and stays bit-identical from then on. */
const REST_EPSILON = 1e-6;
const UNIT_BOUNDS: SceneBounds = {
  min: [-8, 0, -8],
  max: [8, 16, 8],
  center: [0, 8, 0],
  radius: Math.hypot(16, 16, 16) / 2,
};

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
/** Input from events or callers may be NaN or infinite; it is ignored so the camera stays defined. */
const finite = (...values: number[]): boolean => values.every(Number.isFinite);
const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;
const copy = (s: OrbitState): OrbitState => ({ ...s, target: [...s.target] });

/**
 * Orbit, dolly and pan around a target, perspective or orthographic, producing the shared `SceneCamera`. Pure state:
 * no DOM, no clock. Input moves a goal state; `update(dtMs)` eases the current state towards it and snaps to it once
 * close, so with no input the camera never drifts. Near and far planes are fitted to the model bounds on every
 * `camera()` call, so zoom never clips the model.
 */
export class OrbitController {
  private bounds: SceneBounds = UNIT_BOUNDS;
  private aspect = 1;
  private fovYDeg: number;
  private orthographic: boolean;
  private readonly initialYaw: number;
  private readonly initialPitch: number;
  private readonly dampingMs: number;
  private goal: OrbitState;
  private current: OrbitState;
  damping: boolean;

  constructor(options: OrbitControllerOptions = {}) {
    this.initialYaw = finiteOr(options.yawDeg, DEFAULT_YAW_DEG);
    this.initialPitch = clamp(finiteOr(options.pitchDeg, DEFAULT_PITCH_DEG), MIN_PITCH_DEG, MAX_PITCH_DEG);
    this.fovYDeg = clamp(finiteOr(options.fovYDeg, DEFAULT_FOV_DEG), MIN_FOV_DEG, MAX_FOV_DEG);
    this.orthographic = options.projection === 'orthographic';
    this.damping = options.damping ?? true;
    this.dampingMs = options.dampingMs ?? DEFAULT_DAMPING_MS;
    this.goal = this.fittedState(this.initialYaw, this.initialPitch);
    this.current = copy(this.goal);
  }

  get projection(): 'perspective' | 'orthographic' {
    return this.orthographic ? 'orthographic' : 'perspective';
  }

  get fov(): number {
    return this.fovYDeg;
  }

  /** The goal angles in degrees (yaw normalised to 0..360). */
  get angles(): { readonly yawDeg: number; readonly pitchDeg: number } {
    return { yawDeg: ((this.goal.yawDeg % 360) + 360) % 360, pitchDeg: this.goal.pitchDeg };
  }

  get distance(): number {
    return this.goal.distance;
  }

  get orthoHeight(): number {
    return this.goal.orthoHeight;
  }

  /** Whether the eased state still differs from the goal (a caller keeps calling `update` and rendering). */
  get moving(): boolean {
    return !sameState(this.current, this.goal);
  }

  /** Viewport width / height; frame-to-fit and the pan scale depend on it. */
  setAspect(aspect: number): void {
    if (aspect > 0 && Number.isFinite(aspect)) this.aspect = aspect;
  }

  /** Frames `bounds` (null: an empty scene) from the initial angles and makes it the zoom reference. */
  reset(bounds: SceneBounds | null = this.bounds): void {
    this.bounds = bounds ?? UNIT_BOUNDS;
    this.goal = this.fittedState(this.initialYaw, this.initialPitch);
    this.current = copy(this.goal);
  }

  /** Re-frames from the current angles: the Blockbench isometric view keeps them, a reset restores them. */
  frame(yawDeg = this.goal.yawDeg, pitchDeg = this.goal.pitchDeg): void {
    if (!finite(yawDeg, pitchDeg)) return;
    this.goal = this.fittedState(yawDeg, clamp(pitchDeg, MIN_PITCH_DEG, MAX_PITCH_DEG));
    if (!this.damping) this.current = copy(this.goal);
  }

  /** Orthographic, 45° yaw and 35.264° pitch, framed to fit. */
  isometric(): void {
    this.orthographic = true;
    this.frame(ISOMETRIC_YAW_DEG, ISOMETRIC_PITCH_DEG);
  }

  rotate(deltaYawDeg: number, deltaPitchDeg: number): void {
    if (!finite(deltaYawDeg, deltaPitchDeg)) return;
    this.goal.yawDeg += deltaYawDeg;
    this.goal.pitchDeg = clamp(this.goal.pitchDeg + deltaPitchDeg, MIN_PITCH_DEG, MAX_PITCH_DEG);
    this.settle();
  }

  setAngles(yawDeg: number, pitchDeg: number): void {
    if (!finite(yawDeg, pitchDeg)) return;
    this.goal.yawDeg = yawDeg;
    this.goal.pitchDeg = clamp(pitchDeg, MIN_PITCH_DEG, MAX_PITCH_DEG);
    this.settle();
  }

  /** Multiplies the distance (perspective) or the visible height (orthographic); `factor` below 1 zooms in. */
  zoom(factor: number): void {
    if (!finite(factor) || !(factor > 0)) return;
    if (this.orthographic) this.goal.orthoHeight = this.clampOrthoHeight(this.goal.orthoHeight * factor);
    else this.goal.distance = this.clampDistance(this.goal.distance * factor);
    this.settle();
  }

  /** Moves the target in the view plane so the model follows a drag of (`dxPx`, `dyPx`) on a `viewportHeightPx` view. */
  pan(dxPx: number, dyPx: number, viewportHeightPx: number): void {
    if (!finite(dxPx, dyPx, viewportHeightPx) || !(viewportHeightPx > 0)) return;
    const worldPerPixel = this.visibleHeight(this.goal) / viewportHeightPx;
    const { right, up } = viewAxes(this.goal.yawDeg, this.goal.pitchDeg);
    for (let i = 0; i < 3; i++) {
      this.goal.target[i] =
        (this.goal.target[i] ?? 0) - dxPx * worldPerPixel * (right[i] ?? 0) + dyPx * worldPerPixel * (up[i] ?? 0);
    }
    this.settle();
  }

  /** Vertical field of view in 10..100°; the apparent size at the target stays (the distance follows). */
  setFov(fovYDeg: number): void {
    if (!Number.isFinite(fovYDeg)) return;
    const height = this.visibleHeight(this.goal);
    this.fovYDeg = clamp(fovYDeg, MIN_FOV_DEG, MAX_FOV_DEG);
    this.goal.distance = this.clampDistance(height / (2 * Math.tan((this.fovYDeg * Math.PI) / 360)));
    this.settle();
  }

  /** Switches projection keeping the apparent size of the model at the target. */
  setProjection(projection: 'perspective' | 'orthographic'): void {
    const orthographic = projection === 'orthographic';
    if (orthographic === this.orthographic) return;
    const tan = Math.tan((this.fovYDeg * Math.PI) / 360);
    for (const state of [this.goal, this.current]) {
      if (orthographic) state.orthoHeight = this.clampOrthoHeight(2 * state.distance * tan);
      else state.distance = this.clampDistance(state.orthoHeight / (2 * tan));
    }
    this.orthographic = orthographic;
  }

  /** Eases towards the goal over `dtMs`; returns whether it is still moving. */
  update(dtMs: number): boolean {
    if (!(dtMs > 0) || !Number.isFinite(dtMs)) return this.moving;
    if (!this.damping) {
      this.current = copy(this.goal);
      return false;
    }
    const k = 1 - Math.exp(-dtMs / this.dampingMs);
    const ease = (from: number, to: number): number => from + (to - from) * k;
    const c = this.current;
    const g = this.goal;
    c.yawDeg = ease(c.yawDeg, g.yawDeg);
    c.pitchDeg = ease(c.pitchDeg, g.pitchDeg);
    c.distance = ease(c.distance, g.distance);
    c.orthoHeight = ease(c.orthoHeight, g.orthoHeight);
    c.target = [ease(c.target[0], g.target[0]), ease(c.target[1], g.target[1]), ease(c.target[2], g.target[2])];
    if (closeState(c, g, fitRadius(this.bounds))) this.current = copy(g);
    return this.moving;
  }

  /** The camera of the current (eased) state, with clip planes fitted to the bounds. */
  camera(): SceneCamera {
    const s = this.current;
    const toCamera = orbitDirection(s.yawDeg, s.pitchDeg);
    const r = fitRadius(this.bounds);
    const c = this.bounds.center;
    const offTarget = Math.hypot(s.target[0] - c[0], s.target[1] - c[1], s.target[2] - c[2]);
    // An orthographic camera stands outside the sphere wherever the target was panned to.
    const eyeDistance = this.orthographic ? offTarget + 2 * r : s.distance;
    const position: Vec3 = [
      s.target[0] + toCamera[0] * eyeDistance,
      s.target[1] + toCamera[1] * eyeDistance,
      s.target[2] + toCamera[2] * eyeDistance,
    ];
    const forward: Vec3 = [-toCamera[0], -toCamera[1], -toCamera[2]];
    return {
      position,
      target: [...s.target],
      up: [0, 1, 0],
      projection: this.orthographic
        ? { kind: 'orthographic', height: s.orthoHeight }
        : { kind: 'perspective', fovYDeg: this.fovYDeg },
      ...fitClipPlanes(position, forward, this.bounds),
    };
  }

  private fittedState(yawDeg: number, pitchDeg: number): OrbitState {
    const r = fitRadius(this.bounds);
    return {
      target: [...this.bounds.center],
      yawDeg,
      pitchDeg,
      distance: fitDistance(r, this.fovYDeg, this.aspect),
      orthoHeight: fitOrthoHeight(r, this.aspect),
    };
  }

  private settle(): void {
    if (!this.damping) this.current = copy(this.goal);
  }

  private visibleHeight(state: OrbitState): number {
    return this.orthographic ? state.orthoHeight : 2 * state.distance * Math.tan((this.fovYDeg * Math.PI) / 360);
  }

  private clampDistance(distance: number): number {
    const r = fitRadius(this.bounds);
    return clamp(distance, r * MIN_DISTANCE_RADII, fitDistance(r, this.fovYDeg, this.aspect) * MAX_ZOOM_OUT);
  }

  private clampOrthoHeight(height: number): number {
    const fit = fitOrthoHeight(fitRadius(this.bounds), this.aspect);
    return clamp(height, fit / MAX_ORTHO_ZOOM_IN, fit * MAX_ZOOM_OUT);
  }
}

function viewAxes(yawDeg: number, pitchDeg: number): { right: Vec3; up: Vec3 } {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up: Vec3 = [-Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), -Math.sin(pitch) * Math.cos(yaw)];
  return { right, up };
}

function sameState(a: OrbitState, b: OrbitState): boolean {
  return (
    a.yawDeg === b.yawDeg &&
    a.pitchDeg === b.pitchDeg &&
    a.distance === b.distance &&
    a.orthoHeight === b.orthoHeight &&
    a.target.every((v, i) => v === b.target[i])
  );
}

function closeState(a: OrbitState, b: OrbitState, scale: number): boolean {
  const near = (x: number, y: number, unit: number): boolean => Math.abs(x - y) <= REST_EPSILON * unit;
  return (
    near(a.yawDeg, b.yawDeg, 360) &&
    near(a.pitchDeg, b.pitchDeg, 180) &&
    near(a.distance, b.distance, Math.max(scale, b.distance)) &&
    near(a.orthoHeight, b.orthoHeight, Math.max(scale, b.orthoHeight)) &&
    a.target.every((v, i) => near(v, b.target[i] ?? 0, scale))
  );
}
