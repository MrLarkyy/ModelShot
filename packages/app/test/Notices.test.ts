import { describe, expect, it } from 'vitest';
import { Notices, TOAST_MS, type NoticeElements } from '../src/ui/Notices';

class FakeElement {
  textContent = '';
  title = '';
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
    storageChip: new FakeElement(),
    storageClose: new FakeElement(),
    alertBox: new FakeElement(),
    alertText: new FakeElement(),
  };
  elements.alertBox.hidden = true;
  elements.storageClose.hidden = true;
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
    notices.lighting('busy');
    notices.lighting('lit');
    expect(elements.status.textContent).toBe('Opened a.bbmodel.');
    expect(elements.state.textContent).toBe('Preview lit.');
    expect(elements.state.dataset['state']).toBe('lit');
  });

  it('gives each lighting state its own text, title and state', () => {
    const { elements, notices } = setup();
    notices.lighting('busy');
    expect(elements.state.dataset['state']).toBe('busy');
    notices.lighting('warn');
    expect(elements.state.dataset['state']).toBe('warn');
    expect(elements.state.title).toBe(elements.state.textContent);
    expect(elements.state.textContent).toContain('unbaked');
  });

  it('names why the light is unbaked on the dot, its tooltip and the status line', () => {
    const { elements, notices } = setup();
    notices.status('Opened a.bbmodel.');
    notices.lighting('warn', 'EXT_color_buffer_float is missing');
    const text = 'The preview shows unbaked light: EXT_color_buffer_float is missing';
    expect(elements.state.textContent).toBe(text);
    expect(elements.state.title).toBe(text);
    expect(elements.state.dataset['state']).toBe('warn');
    expect(elements.status.textContent).toBe(text);
    expect(elements.status.classList.contains('toast-shown')).toBe(true);
  });

  it('toasts a failure reason once until the preview is lit, and again for a different reason', () => {
    const { elements, notices } = setup();
    notices.lighting('warn', 'the worker stopped');
    notices.status('Render done.');
    notices.lighting('warn', 'the worker stopped');
    expect(elements.status.textContent).toBe('Render done.');
    expect(elements.state.title).toBe('The preview shows unbaked light: the worker stopped');
    notices.lighting('warn', 'out of memory');
    expect(elements.status.textContent).toBe('The preview shows unbaked light: out of memory');
    notices.lighting('lit');
    notices.status('Opened a.bbmodel.');
    notices.lighting('warn', 'out of memory');
    expect(elements.status.textContent).toBe('The preview shows unbaked light: out of memory');
  });

  it('drops the failure reason with the next lighting state and says nothing for a bake that just did not apply', () => {
    const { elements, notices } = setup();
    notices.lighting('warn', 'the worker stopped');
    notices.status('Opened a.bbmodel.');
    notices.lighting('busy');
    expect(elements.state.title).toBe('Lighting the preview…');
    notices.lighting('warn');
    expect(elements.state.textContent).toBe('The preview shows unbaked light.');
    expect(elements.status.textContent).toBe('Opened a.bbmodel.');
  });

  it('clips a long failure reason on the dot', () => {
    const { elements, notices } = setup();
    notices.lighting('warn', 'x'.repeat(2000));
    expect(elements.state.textContent.length).toBe(600);
    expect(elements.state.textContent.endsWith('…')).toBe(true);
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

  it('puts a storage failure in its own chip and leaves the status line alone', () => {
    const { elements, notices } = setup();
    notices.status('Opened a.bbmodel.');
    notices.storage('Your settings are not being kept.');
    notices.status('Render done.');
    expect(elements.status.textContent).toBe('Render done.');
    expect(elements.storageChip.textContent).toBe('Your settings are not being kept.');
    expect(elements.storageClose.hidden).toBe(false);
    expect(elements.alertBox.hidden).toBe(true);
  });

  it('clears the storage chip when it is dismissed', () => {
    const { elements, notices } = setup();
    notices.storage('Your settings are not being kept.');
    notices.dismissStorage();
    expect(elements.storageChip.textContent).toBe('');
    expect(elements.storageClose.hidden).toBe(true);
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
