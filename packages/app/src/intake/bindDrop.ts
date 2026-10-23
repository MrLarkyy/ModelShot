function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

// Dropping files anywhere on the page opens them, and a file dropped on the page never navigates the tab to it.
// `overlay` is shown while files are dragged over the page.
export function bindDrop(target: Window, overlay: HTMLElement, onFiles: (files: File[]) => void): () => void {
  let depth = 0;
  const show = (visible: boolean): void => {
    overlay.hidden = !visible;
  };
  const onEnter = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    show(true);
  };
  const onOver = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const onLeave = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  };
  const onDrop = (event: DragEvent): void => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth = 0;
    show(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    onFiles(files);
  };
  target.addEventListener('dragenter', onEnter);
  target.addEventListener('dragover', onOver);
  target.addEventListener('dragleave', onLeave);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragenter', onEnter);
    target.removeEventListener('dragover', onOver);
    target.removeEventListener('dragleave', onLeave);
    target.removeEventListener('drop', onDrop);
  };
}
