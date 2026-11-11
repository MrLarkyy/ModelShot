import { describe, expect, it } from 'vitest';
import { Notices } from '../src/ui/Notices';

const line = (): HTMLElement => ({ textContent: '', hidden: true }) as HTMLElement;

const notices = (): { notices: Notices; alert: HTMLElement } => {
  const alert = line();
  return { notices: new Notices(line(), line(), alert, line()), alert };
};

describe('Notices', () => {
  it('clearAlert wipes an ordinary alert', () => {
    const { notices: n, alert } = notices();
    n.alert('Could not open it.');
    n.clearAlert();
    expect(alert.hidden).toBe(true);
    expect(alert.textContent).toBe('');
  });

  it('a pinned driver failure survives clearAlert, such as opening a file', () => {
    const { notices: n, alert } = notices();
    n.pinAlert('The preview could not use the graphics driver: lost');
    n.alert('Could not open it.');
    n.clearAlert();
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe('The preview could not use the graphics driver: lost');
  });
});
