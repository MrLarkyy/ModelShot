import { bindDisclosure } from './bindDisclosure';
import { byId } from './dom';
import { icon, type IconName } from './icon';

const ICON_BUTTONS: readonly (readonly [id: string, name: IconName])[] = [
  ['undo-button', 'undo'],
  ['redo-button', 'redo'],
  ['outliner-toggle', 'panel-left'],
  ['inspector-toggle', 'panel-right'],
  ['timeline-toggle', 'panel-bottom'],
  ['bar-more-button', 'more'],
  ['alert-close', 'close'],
];

/** Puts the icons on the static top-bar buttons and binds the More list that holds the groups below 900 px. */
export function bindTopBar(): void {
  for (const [id, name] of ICON_BUTTONS) byId(id, HTMLButtonElement).append(icon(name));
  const overflow = byId('bar-overflow', HTMLElement);
  // Closed at first; the stylesheet shows the group inline from 900 px up whatever this says.
  overflow.hidden = true;
  bindDisclosure(byId('bar-more-button', HTMLButtonElement), overflow);
}
