import { icon } from './icon';
import type { SectionId, SectionState } from './sectionState';

/** A collapsible group: a header button (`aria-expanded`, `aria-controls`) over a body that is `hidden` when closed. */
export function section(
  id: SectionId,
  title: string,
  body: readonly (Node | string)[],
  state: SectionState,
): HTMLElement {
  const open = state.isOpen(id);
  const bodyId = `section-${id}`;
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'section-head';
  head.setAttribute('aria-expanded', String(open));
  head.setAttribute('aria-controls', bodyId);
  head.setAttribute('data-focus', `section:${id}`);
  const chevron = document.createElement('span');
  chevron.className = 'section-chevron';
  chevron.append(icon(open ? 'chevron-down' : 'chevron-right', { size: 14 }));
  const label = document.createElement('span');
  label.textContent = title;
  head.append(chevron, label);
  const content = document.createElement('div');
  content.id = bodyId;
  content.className = 'section-body';
  content.hidden = !open;
  content.append(...body);
  head.addEventListener('click', () => {
    const next = head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(next));
    content.hidden = !next;
    chevron.replaceChildren(icon(next ? 'chevron-down' : 'chevron-right', { size: 14 }));
    state.set(id, next);
  });
  const root = document.createElement('section');
  root.className = 'section';
  root.append(head, content);
  return root;
}
