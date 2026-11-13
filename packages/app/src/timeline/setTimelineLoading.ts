/**
 * The timeline panel is busy (`aria-busy`) from the start of an open until its clips are shown, and shows its skeleton
 * lanes while it is open (`data-loading`). A collapsed panel stays collapsed: a resize of the view would drop a render.
 */
export function setTimelineLoading(panel: Element, loading: boolean): void {
  panel.toggleAttribute('data-loading', loading);
  if (loading) panel.setAttribute('aria-busy', 'true');
  else panel.removeAttribute('aria-busy');
}
