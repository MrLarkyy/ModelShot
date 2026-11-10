import { describe, expect, it } from 'vitest';
import { Notices, TOAST_MS, type NoticeElements } from '../src/ui/Notices';

class FakeElement {
  textContent = '';
  hidden = false;
  dataset: Record<string, string> = {};
  private readonly names = new Set<string>();
  classList = {
    add: (name: string): void => void this.names.add(name),
    remove: (name: string): void => void this.names.delete(name),
    contains: (name: string): boolean => this.names.has(name),
  };
}

function setup() {
  const elements = {
    status: new FakeElement(),
    state: new FakeElement(),
    alertBox: new FakeElement(),
    alertText: new FakeElement(),
  };
  elements.alertBox.hidden = true;
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  const notices = new Notices(
    elements as unknown as NoticeElements,
    (callback, ms) => {
      timers.set(next, { callback, ms });
      return next++;
    },
    (handle) => void timers.delete(handle as number),
  );
  return { elements, notices, timers };
}

describe('Notices', () => {
  it('holds exactly the latest status message', () => {
    const { elements, notices } = setup();
    notices.status('Opened a.bbmodel.');
    notices.status('Render done.');
    expect(elements.status.textContent).toBe('Render done.');
  });

  it('keeps the lighting state off the status line', () => {
    const { elements, notices } = setup();
    notices.status('Opened a.bbmodel.');
    notices.lighting('Lighting the preview…');
    notices.lighting('Preview lit.');
    expect(elements.status.textContent).toBe('Opened a.bbmodel.');
    expect(elements.state.textContent).toBe('Preview lit.');
    expect(elements.state.dataset['state']).toBe('lit');
  });

  it('marks a failed bake apart from a bake in progress', () => {
    const { elements, notices } = setup();
    notices.lighting('Lighting the preview…');
    expect(elements.state.dataset['state']).toBe('busy');
    notices.lighting('The preview shows unbaked light: no GPU');
    expect(elements.state.dataset['state']).toBe('warn');
  });

  it('shows the toast, then fades it and keeps the text', () => {
    const { elements, notices, timers } = setup();
    notices.status('Render done.');
    expect(elements.status.classList.contains('toast-shown')).toBe(true);
    [...timers.values()].forEach((timer) => timer.callback());
    expect(elements.status.classList.contains('toast-shown')).toBe(false);
    expect(elements.status.textContent).toBe('Render done.');
  });

  it('restarts the fade timer per message', () => {
    const { notices, timers } = setup();
    notices.status('one');
    notices.status('two');
    expect(timers.size).toBe(1);
    expect([...timers.values()][0]?.ms).toBe(TOAST_MS);
  });

  it('shows a storage failure as a status, not as an error', () => {
    const { elements, notices } = setup();
    notices.storage('Your settings are not being kept on this device.');
    expect(elements.status.textContent).toBe('Your settings are not being kept on this device.');
    expect(elements.alertBox.hidden).toBe(true);
  });

  it('keeps an alert through later statuses until it is cleared', () => {
    const { elements, notices } = setup();
    notices.alert('The render failed.');
    notices.status('Opened a.bbmodel.');
    expect(elements.alertText.textContent).toBe('The render failed.');
    expect(elements.alertBox.hidden).toBe(false);
    notices.clearAlert();
    expect(elements.alertBox.hidden).toBe(true);
    expect(elements.alertText.textContent).toBe('');
  });
});
