function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

// Dropping files anywhere on the page opens them, and a file dropped on the page never navigates the tab to it.
// `onActive` tells when files are dragged over the page and when they leave or drop.
export function bindDrop(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  onActive: (active: boolean) => void,
  onFiles: (files: File[]) => void,
): () => void {
  let depth = 0;
  const onEnter = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    onActive(true);
  };
  const onOver = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const onLeave = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) onActive(false);
  };
  const onDrop = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    onActive(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    onFiles(files);
  };
  target.addEventListener('dragenter', onEnter as EventListener);
  target.addEventListener('dragover', onOver as EventListener);
  target.addEventListener('dragleave', onLeave as EventListener);
  target.addEventListener('drop', onDrop as EventListener);
  return () => {
    target.removeEventListener('dragenter', onEnter as EventListener);
    target.removeEventListener('dragover', onOver as EventListener);
    target.removeEventListener('dragleave', onLeave as EventListener);
    target.removeEventListener('drop', onDrop as EventListener);
  };
}
