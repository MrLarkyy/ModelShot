/** The timeline panel shows its skeleton lanes and is busy (`aria-busy`) from the start of an open until its clips are shown. */
export function setTimelineLoading(panel: Element, loading: boolean): void {
  panel.toggleAttribute('data-loading', loading);
  if (loading) {
    panel.setAttribute('aria-busy', 'true');
    panel.removeAttribute('data-empty');
  } else {
    panel.removeAttribute('aria-busy');
  }
}
