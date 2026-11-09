import { icon, ICON_NAMES } from './icon';
import { iconButton } from './iconButton';

type State = 'default' | 'on' | 'disabled';

const STATES: readonly State[] = ['default', 'on', 'disabled'];
const CAPTION: Record<State, string> = { default: 'default', on: 'on / checked', disabled: 'disabled' };

// Inline CSSOM styles only: the page policy forbids a style attribute, and the specimen adds no stylesheet to the app.
function styled<T extends HTMLElement>(element: T, rules: Record<string, string>): T {
  for (const [name, value] of Object.entries(rules)) element.style.setProperty(name, value);
  return element;
}

function text(tag: 'h2' | 'p' | 'span', content: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = content;
  if (className) element.className = className;
  return element;
}

let counter = 0;
const unique = (prefix: string): string => `${prefix}-${(counter += 1)}`;

function button(label: string, state: State, className = ''): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  const classes = [className, state === 'on' ? 'on' : ''].filter(Boolean).join(' ');
  if (classes) element.className = classes;
  element.disabled = state === 'disabled';
  return element;
}

function field(
  type: 'checkbox' | 'radio' | 'range' | 'number',
  label: string,
  state: State,
  extra: Record<string, string> = {},
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('aria-label', label);
  for (const [name, value] of Object.entries(extra)) input.setAttribute(name, value);
  input.disabled = state === 'disabled';
  if (type === 'checkbox' || type === 'radio') input.checked = state === 'on';
  return input;
}

function segmented(label: string, state: State): HTMLElement {
  const group = unique('specimen-seg');
  const set = document.createElement('fieldset');
  set.className = 'segmented';
  set.setAttribute('aria-label', label);
  ['Front', 'Side', 'Top'].forEach((name, index) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'segment';
    const input = field('radio', `${label}: ${name}`, state === 'disabled' ? 'disabled' : 'default', { name: group });
    input.checked = index === (state === 'on' ? 1 : 0);
    wrapper.append(input, text('span', name));
    set.append(wrapper);
  });
  return set;
}

function slider(label: string, state: State): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'slider';
  const range = field('range', label, state, { min: '0', max: '100', step: '1', value: state === 'on' ? '80' : '35' });
  const number = field('number', `${label} value`, state, {
    min: '0',
    max: '100',
    step: '1',
    value: range.value,
  });
  wrapper.append(range, number);
  return wrapper;
}

function axes(state: State): HTMLElement {
  const wrapper = styled(document.createElement('div'), {
    display: 'grid',
    'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
    gap: '6px',
    width: '15rem',
  });
  (['x', 'y', 'z'] as const).forEach((axis, index) => {
    const cell = document.createElement('label');
    cell.className = `axis-field ${axis}`;
    const letter = document.createElement('i');
    letter.textContent = axis.toUpperCase();
    letter.setAttribute('aria-hidden', 'true');
    const input = field('number', `Position ${axis.toUpperCase()}`, state, {
      step: '1',
      value: String((index + 1) * 2),
    });
    cell.append(letter, input);
    wrapper.append(cell);
  });
  return wrapper;
}

function select(state: State): HTMLElement {
  const element = document.createElement('select');
  element.setAttribute('aria-label', 'Clip');
  for (const name of ['Walk cycle', 'Idle', 'Jump']) element.append(new Option(name));
  element.selectedIndex = state === 'on' ? 1 : 0;
  element.disabled = state === 'disabled';
  return element;
}

function toggleRow(state: State): HTMLElement {
  const row = document.createElement('label');
  row.className = 'toggle-row';
  row.append(text('span', 'Denoise'), field('checkbox', 'Denoise', state));
  return row;
}

function cells(label: string, make: (state: State) => HTMLElement | null): HTMLElement {
  const row = styled(document.createElement('section'), {
    display: 'grid',
    gap: '8px',
    padding: '14px 0',
    'border-top': '1px solid var(--ed-line)',
  });
  row.append(text('h2', label, 'overline'));
  const line = styled(document.createElement('div'), { display: 'flex', 'flex-wrap': 'wrap', gap: '16px 28px' });
  for (const state of STATES) {
    const control = make(state);
    if (!control) continue;
    const cell = styled(document.createElement('div'), { display: 'grid', gap: '6px', 'align-content': 'start' });
    cell.append(control, text('span', CAPTION[state], 'hint'));
    line.append(cell);
  }
  row.append(line);
  return row;
}

function keycaps(): HTMLElement {
  const keys = document.createElement('span');
  const ctrl = document.createElement('kbd');
  ctrl.textContent = 'Ctrl';
  const z = document.createElement('kbd');
  z.textContent = 'Z';
  keys.append(ctrl, ' ', z);
  return keys;
}

/** Every control variant in default, on and disabled; the e2e drives hover and focus. Only the e2e build imports it. */
export function buildSpecimen(): HTMLElement {
  const root = styled(document.createElement('section'), {
    position: 'fixed',
    inset: '0',
    'z-index': '100',
    'overflow-y': 'auto',
    padding: '24px 20px 48px',
    background: 'var(--ed-panel)',
    color: 'var(--ed-text)',
  });
  root.id = 'specimen';
  root.setAttribute('aria-label', 'Control specimen');
  const inner = styled(document.createElement('div'), { 'max-width': '60rem', margin: '0 auto' });
  const icons = styled(document.createElement('div'), { display: 'flex', 'flex-wrap': 'wrap', gap: '4px' });
  for (const name of ICON_NAMES) icons.append(iconButton(name, `Icon ${name}`));
  const sizes = styled(document.createElement('div'), { display: 'flex', gap: '12px', 'align-items': 'center' });
  sizes.append(icon('cube'), icon('cube', { size: 14 }));
  const toggleIcon = (name: 'eye' | 'lock', label: string, small: boolean) => (state: State) => {
    const element = iconButton(name, label, { small, pressed: state === 'on' });
    element.disabled = state === 'disabled';
    return element;
  };
  inner.append(
    text('h2', 'Control specimen', 'overline'),
    cells('Primary', (state) => (state === 'on' ? null : button('Export…', state, 'primary'))),
    cells('Secondary', (state) => button('Open…', state)),
    cells('Ghost', (state) => button('Cancel', state, 'ghost')),
    cells('Destructive', (state) => (state === 'on' ? null : button('Forget local data', state, 'destructive'))),
    cells('Small', (state) => button('Reset', state, 'small')),
    cells('Icon 32', toggleIcon('eye', 'Visible', false)),
    cells('Icon 26', toggleIcon('lock', 'Locked', true)),
    cells('Toggle', toggleRow),
    cells('Radio', (state) => {
      const label = document.createElement('label');
      label.className = 'choice';
      label.append(field('radio', 'Studio look', state, { name: unique('specimen-radio') }), text('span', 'Studio'));
      return label;
    }),
    cells('Segmented', (state) => segmented('View', state)),
    cells('Slider and value', (state) => slider('Field of view', state)),
    cells('Number field with axis', axes),
    cells('Select', select),
    cells('Keycap', (state) => (state === 'default' ? keycaps() : null)),
    cells('Icon set', (state) => (state === 'default' ? icons : null)),
    cells('Icon sizes', (state) => (state === 'default' ? sizes : null)),
  );
  root.append(inner);
  return root;
}
