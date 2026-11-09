export interface SelectionTarget {
  readonly kind: 'node' | 'mesh';
  readonly index: number;
}

// The one selected node or element, shared by the outliner, the inspector and the viewport.
export class Selection {
  private target: SelectionTarget | null = null;
  private readonly listeners = new Set<(target: SelectionTarget | null) => void>();

  get current(): SelectionTarget | null {
    return this.target;
  }

  onChange(listener: (target: SelectionTarget | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(target: SelectionTarget | null): void {
    const same = this.target?.kind === target?.kind && this.target?.index === target?.index;
    if (same) return;
    this.target = target;
    for (const listener of this.listeners) listener(target);
  }

  is(kind: SelectionTarget['kind'], index: number): boolean {
    return this.target?.kind === kind && this.target.index === index;
  }
}
