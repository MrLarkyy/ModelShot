import { MAX_ANIMATION_VALUE, type Vec3 } from '@modelshot/scene';
import { uniqueId } from './dom';

export interface XyzFieldOptions {
  /** Names the row for assistive tech: each input is "<label> X", "<label> Y", "<label> Z". */
  readonly label: string;
  readonly values: Vec3;
  /** Shown after each value: `px`, `°`. */
  readonly unit?: string;
  /** One arrow step and one pixel of scrubbing. */
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
  /** Shown but not editable (values that come from the file). */
  readonly readOnly?: boolean;
  /** Called once per edit (a typed value, one arrow press, one finished scrub) with the three values. */
  readonly commit?: (values: Vec3) => void;
}

export interface XyzField {
  readonly element: HTMLElement;
  readonly inputs: readonly HTMLInputElement[];
}

const AXES = ['X', 'Y', 'Z'] as const;

const show = (value: number): string => String(Math.round(value * 1e4) / 1e4);

function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** A row of three number inputs with coloured axis letters: type, step with the arrows, or scrub by dragging a letter. */
export function xyzField(options: XyzFieldOptions): XyzField {
  const { label, unit, step, disabled = false, readOnly = false } = options;
  const min = options.min ?? -MAX_ANIMATION_VALUE;
  const max = options.max ?? MAX_ANIMATION_VALUE;
  let current: [number, number, number] = [options.values[0], options.values[1], options.values[2]];
  const hintId = uniqueId('xyz-hint');

  const hint = document.createElement('span');
  hint.className = 'xyz-hint';
  hint.id = hintId;
  hint.setAttribute('role', 'status');
  hint.hidden = true;

  const inputs = AXES.map((axis, i) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'xyz-input';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', `${label} ${axis}`);
    input.setAttribute('data-focus', `xyz:${label}:${axis}`);
    input.value = show(current[i] ?? 0);
    input.disabled = disabled;
    input.readOnly = readOnly;
    return input;
  });

  const render = (): void => {
    inputs.forEach((input, i) => (input.value = show(current[i] ?? 0)));
  };
  const clear = (): void => {
    hint.hidden = true;
    hint.textContent = '';
    for (const input of inputs) input.removeAttribute('aria-invalid');
  };
  const reject = (input: HTMLInputElement | undefined): void => {
    render();
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', hintId);
    }
    hint.textContent = `Enter a number between ${show(min)} and ${show(max)}.`;
    hint.hidden = false;
  };
  const accept = (next: [number, number, number], source?: HTMLInputElement): boolean => {
    if (next.some((v) => !Number.isFinite(v) || v < min || v > max)) {
      reject(source);
      return false;
    }
    clear();
    current = next;
    render();
    options.commit?.([next[0], next[1], next[2]]);
    return true;
  };
  const withAxis = (axis: number, value: number): [number, number, number] => {
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axis] = value;
    return next;
  };

  let scrub: { readonly axis: number; readonly startX: number; readonly start: number; moved: boolean } | null = null;
  const endScrub = (letter: HTMLElement, pointerId: number | undefined): void => {
    if (pointerId !== undefined) {
      try {
        letter.releasePointerCapture(pointerId);
      } catch {
        // The pointer is already gone.
      }
    }
    scrub = null;
  };

  const axisBoxes = AXES.map((axis, i) => {
    const input = inputs[i] as HTMLInputElement;
    const letter = document.createElement('span');
    letter.className = `xyz-axis axis-${axis.toLowerCase()}`;
    letter.textContent = axis;
    letter.setAttribute('aria-hidden', 'true');
    if (!disabled && !readOnly) {
      letter.title = `Drag to change ${axis}`;
      letter.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        input.focus();
        letter.setPointerCapture(event.pointerId);
        scrub = { axis: i, startX: event.clientX, start: current[i] ?? 0, moved: false };
      });
      letter.addEventListener('pointermove', (event) => {
        if (!scrub) return;
        scrub.moved = true;
        const scale = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        const value = scrub.start + (event.clientX - scrub.startX) * step * scale;
        input.value = show(Math.min(max, Math.max(min, value)));
      });
      letter.addEventListener('pointerup', (event) => {
        const active = scrub;
        endScrub(letter, event.pointerId);
        if (!active?.moved) return;
        const typed = parseDecimal(input.value);
        if (typed === null || typed === (current[i] ?? 0)) return render();
        accept(withAxis(active.axis, typed), input);
      });
      letter.addEventListener('pointercancel', (event) => {
        if (!scrub) return;
        endScrub(letter, event.pointerId);
        render();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && scrub) {
          event.stopPropagation();
          endScrub(letter, undefined);
          render();
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const scale = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
        const base = parseDecimal(input.value) ?? current[i] ?? 0;
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        accept(withAxis(i, Math.round((base + direction * step * scale) * 1e6) / 1e6), input);
      });
      input.addEventListener('change', () => {
        const typed = parseDecimal(input.value);
        if (typed === null) return reject(input);
        if (typed === (current[i] ?? 0)) return clear();
        accept(withAxis(i, typed), input);
      });
    }
    const box = document.createElement('span');
    box.className = 'xyz-cell';
    box.append(letter, input);
    if (unit) {
      const suffix = document.createElement('span');
      suffix.className = 'xyz-unit';
      suffix.textContent = unit;
      suffix.setAttribute('aria-hidden', 'true');
      box.append(suffix);
    }
    return box;
  });

  const row = document.createElement('div');
  row.className = 'xyz';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', label);
  row.append(...axisBoxes);
  const element = document.createElement('div');
  element.className = 'xyz-field';
  const title = document.createElement('span');
  title.className = 'xyz-label';
  title.textContent = unit ? `${label} (${unit})` : label;
  title.setAttribute('aria-hidden', 'true');
  element.append(title, row, hint);
  return { element, inputs };
}
