import { meshVisible, nodeVisibility, type SceneDocument } from '@modelshot/scene';

const REFRESH_MS = 500;

/** Triangles and shown meshes of a document. */
export function documentStats(doc: SceneDocument): { triangles: number; meshes: number } {
  const visibility = nodeVisibility(doc);
  let triangles = 0;
  let meshes = 0;
  doc.meshes.forEach((mesh, index) => {
    if (!meshVisible(doc, index, visibility)) return;
    meshes += 1;
    triangles += Math.floor(mesh.indices.length / 3);
  });
  return { triangles, meshes };
}

/** The chip's text: "60 fps · 1,234 triangles · 3 meshes · overlay 0.4 ms · bake 120 ms" (no bake yet: "bake -"). */
export function statsText(
  fps: number,
  counts: { triangles: number; meshes: number },
  overlayMs: number,
  bakeMs: number | null,
): string {
  const bake = bakeMs === null ? '-' : `${Math.round(bakeMs)} ms`;
  return `${fps} fps · ${counts.triangles.toLocaleString('en')} triangles · ${counts.meshes} meshes · overlay ${overlayMs.toFixed(1)} ms · bake ${bake}`;
}

// The readout under the view bar: frames per second, triangles, meshes, the overlay's own drawing time and how long the
// last light bake took. Plain text
// in a paragraph that is not a live region, refreshed twice a second.
export class StatsOverlay {
  private frames = 0;
  private since = 0;
  private fps = 0;
  private last = 0;
  private counts: { triangles: number; meshes: number } | null = null;
  private countsFor: SceneDocument | null = null;
  private bakeMs: number | null = null;

  constructor(private readonly root: HTMLElement) {}

  /** The last bake settled after `ms` milliseconds. */
  setBakeMs(ms: number): void {
    this.bakeMs = ms;
  }

  frame(now: number, doc: SceneDocument | null, overlayMs: number): void {
    if (this.root.hidden) return;
    this.frames += 1;
    if (this.since === 0) this.since = now;
    if (now - this.last < REFRESH_MS) return;
    this.last = now;
    this.fps = Math.round((this.frames * 1000) / Math.max(1, now - this.since));
    this.frames = 0;
    this.since = now;
    if (doc && this.countsFor !== doc) {
      this.countsFor = doc;
      this.counts = documentStats(doc);
    }
    this.root.textContent = this.counts ? statsText(this.fps, this.counts, overlayMs, this.bakeMs) : '';
  }
}
