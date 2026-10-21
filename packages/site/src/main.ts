import '@modelshot/brand/tokens.css';
import '@modelshot/brand/illustration.css';
import '@modelshot/brand/fonts.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/motion.css';
import { wireDropZone } from './dropZone';

function required<T extends Element>(selector: string, type: new () => T): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`landing page markup is missing ${selector}`);
  return element;
}

wireDropZone({
  zone: required('#drop-zone', HTMLElement),
  input: required('#model-input', HTMLInputElement),
  alert: required('#drop-error', HTMLElement),
  openButtons: document.querySelectorAll<HTMLElement>('[data-open-picker]'),
});
