import { ModelShotViewer } from './element/ModelShotViewer';

// The frame page sits next to this script in the embed build. A variable, not a literal, so the bundler does not take
// the directory for an asset to resolve.
const scriptUrl = import.meta.url;
ModelShotViewer.frameBase = new URL('./', scriptUrl).href;

if (!customElements.get('modelshot-viewer')) customElements.define('modelshot-viewer', ModelShotViewer);
