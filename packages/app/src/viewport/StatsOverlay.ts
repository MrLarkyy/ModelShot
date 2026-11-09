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

// The corner readout of the viewport: frames per second, triangles, meshes and the overlay's own drawing time. Plain text
// in a paragraph that is not a live region, refreshed twice a second.
export class StatsOverlay {
  private frames = 0;
  private since = 0;
  private fps = 0;
  private last = 0;
  private counts: { triangles: number; meshes: number } | null = null;
  private countsFor: SceneDocument | null = null;

  constructor(private readonly root: HTMLElement) {}

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
    const counts = this.counts;
    this.root.textContent = counts
      ? `${this.fps} fps · ${counts.triangles.toLocaleString('en')} triangles · ${counts.meshes} meshes · overlay ${overlayMs.toFixed(1)} ms`
      : '';
  }
}
