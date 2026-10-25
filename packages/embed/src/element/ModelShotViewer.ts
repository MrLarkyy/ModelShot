import { EmbedError } from '../EmbedError';
import { ELEMENT_ATTRIBUTE_NAMES, EMBED_PARAM_NAMES, MAX_LABEL_CHARS } from '../EmbedParams';
import { embedFrameUrl } from '../embedFrameUrl';
import { parseEmbedParams } from '../parseEmbedParams';

const DEFAULT_LABEL = '3D model viewer';
const LAZY_MARGIN = '200px';
const MAX_RELAYED_CODE_CHARS = 64;
const MAX_RELAYED_MESSAGE_CHARS = 1000;

// System colours only: the host page's palette is unknown and the brand tokens are not loaded here.
const STYLE = `
:host { display: inline-block; width: 300px; height: 300px; position: relative; }
:host([hidden]) { display: none; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
[role='alert'] { box-sizing: border-box; height: 100%; margin: 0; padding: 1em; overflow: auto;
  font: 14px/1.4 system-ui, sans-serif; background: Canvas; color: CanvasText; border: 1px solid GrayText; }
[role='alert']:empty { display: none; }
`;

interface ElementOptions {
  readonly src: string;
  readonly title: string;
  readonly eager: boolean;
}

interface FrameMessage {
  readonly type: 'load' | 'error';
  readonly code: string;
  readonly message: string;
}

function frameMessage(data: unknown): FrameMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { source, v, type, code, message } = data as Record<string, unknown>;
  if (source !== 'modelshot-embed' || v !== 1 || (type !== 'load' && type !== 'error')) return null;
  return {
    type,
    code: typeof code === 'string' ? code.slice(0, MAX_RELAYED_CODE_CHARS) : '',
    message: typeof message === 'string' ? message.slice(0, MAX_RELAYED_MESSAGE_CHARS) : '',
  };
}

/**
 * `<modelshot-viewer model="...">`: checks its attributes and, once within 200 px of the viewport (or at once with
 * `loading="eager"`), shows the embed frame page in a sandboxed iframe with the parameters in the URL fragment. The
 * model is fetched, parsed and drawn in that frame, never in the host page. Fires `load` and `error` (detail
 * `{ code, message }`). docs/embed.md is the contract.
 */
export class ModelShotViewer extends HTMLElement {
  static readonly observedAttributes = ELEMENT_ATTRIBUTE_NAMES;
  /** The directory of the embed build, which holds the frame page; set by the entry script before `define`. */
  static frameBase = '';

  private readonly alert: HTMLElement;
  private readonly shadow: ShadowRoot;
  private iframe: HTMLIFrameElement | null = null;
  // The URL the iframe was last sent to (its `src` stays the first one).
  private frameSrc = '';
  private observer: IntersectionObserver | null = null;
  private options: ElementOptions | null = null;
  private started = false;
  private shownError = '';

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.alert = document.createElement('p');
    this.alert.setAttribute('role', 'alert');
    this.shadow.append(style, this.alert);
  }

  connectedCallback(): void {
    window.addEventListener('message', this.onMessage);
    this.started = true;
    this.update();
  }

  disconnectedCallback(): void {
    this.started = false;
    this.shownError = '';
    this.alert.textContent = '';
    window.removeEventListener('message', this.onMessage);
    this.unobserve();
    this.iframe?.remove();
    this.iframe = null;
  }

  // An upgrade reports every attribute before connectedCallback: that one call reads them all, once.
  attributeChangedCallback(): void {
    if (this.started) this.update();
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;
    if (event.origin !== new URL(ModelShotViewer.frameBase).origin) return;
    const message = frameMessage(event.data);
    if (!message) return;
    const detail = message.type === 'load' ? {} : { code: message.code, message: message.message };
    this.dispatchEvent(new CustomEvent(message.type, { detail }));
  };

  private readOptions(): ElementOptions {
    const entries: [string, string][] = [];
    for (const name of EMBED_PARAM_NAMES) {
      const value = name === 'v' ? null : this.getAttribute(name);
      if (value !== null) entries.push([name, value]);
    }
    const { params } = parseEmbedParams(entries, document.baseURI);
    const loading = this.getAttribute('loading') ?? 'lazy';
    if (loading !== 'lazy' && loading !== 'eager') {
      throw new EmbedError('INVALID_PARAM', 'loading must be one of lazy, eager.', 'loading');
    }
    const label = this.getAttribute('label') || DEFAULT_LABEL;
    if (label.length > MAX_LABEL_CHARS) {
      throw new EmbedError('INVALID_PARAM', `label is longer than ${MAX_LABEL_CHARS} characters.`, 'label');
    }
    return { src: embedFrameUrl(ModelShotViewer.frameBase, params), title: label, eager: loading === 'eager' };
  }

  private update(): void {
    let options: ElementOptions;
    try {
      options = this.readOptions();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.options = options;
    this.shownError = '';
    this.alert.textContent = '';
    if (this.iframe) {
      this.iframe.title = options.title;
      if (this.frameSrc !== options.src) {
        this.frameSrc = options.src;
        // Replacing the frame's location (allowed across origins) changes the fragment without an entry in the host
        // page's history; a new `src` would add one per attribute change.
        const frame = this.iframe.contentWindow;
        if (frame) frame.location.replace(options.src);
        else this.iframe.src = options.src;
      }
    } else if (options.eager || typeof IntersectionObserver === 'undefined') {
      this.insertFrame();
    } else {
      this.observer ??= new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) this.insertFrame();
        },
        { rootMargin: LAZY_MARGIN },
      );
      this.observer.observe(this);
    }
  }

  private insertFrame(): void {
    this.unobserve();
    const options = this.options;
    if (this.iframe || !options) return;
    const iframe = document.createElement('iframe');
    // Scripts and its own origin (for its workers); no top navigation, popups, forms or downloads.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('allow', '');
    iframe.referrerPolicy = 'no-referrer';
    iframe.title = options.title;
    iframe.src = options.src;
    this.frameSrc = options.src;
    this.iframe = iframe;
    this.shadow.append(iframe);
  }

  private unobserve(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private fail(error: unknown): void {
    this.unobserve();
    this.iframe?.remove();
    this.iframe = null;
    this.options = null;
    const code = error instanceof EmbedError ? error.code : 'INVALID_PARAM';
    const message = error instanceof Error ? error.message : String(error);
    // The same error again (another invalid attribute change) is neither shown nor fired twice.
    const shown = `${code}: ${message}`;
    if (shown === this.shownError) return;
    this.shownError = shown;
    this.alert.textContent = shown;
    this.dispatchEvent(new CustomEvent('error', { detail: { code, message } }));
  }
}
