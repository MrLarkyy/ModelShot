import '@modelshot/brand/tokens.css';
import './frame.css';
import { showEmbed, type EmbedPage } from './showEmbed';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the frame page has no #${id}`);
  return found;
}

const page: EmbedPage = { stage: element('stage'), status: element('status'), alert: element('alert') };
const environment = {
  fetch: globalThis.fetch.bind(globalThis),
  origin: location.origin,
  parent: window.parent,
  self: window,
};

const embed = showEmbed(page, location.hash, environment);
// The element changes only the fragment when an attribute changes; the frame shows the new parameters.
window.addEventListener('hashchange', () => embed.update(location.hash));
