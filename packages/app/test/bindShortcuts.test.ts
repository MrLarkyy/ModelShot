import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindShortcuts } from '../src/shortcuts/bindShortcuts';
import type { ShortcutAction } from '../src/shortcuts/shortcutAction';

class FakeElement {
  isContentEditable = false;
  constructor(
    readonly tagName: string,
    private readonly role: string | null = null,
  ) {}

  getAttribute(name: string): string | null {
    return name === 'role' ? this.role : null;
  }
}

type KeyHandler = (event: Record<string, unknown>) => void;

function setup(dialogOpen = false) {
  let handler: KeyHandler | null = null;
  const removeListener = vi.fn();
  const target = {
    addEventListener: (_type: string, listener: KeyHandler) => (handler = listener),
    removeEventListener: removeListener,
    querySelector: () => (dialogOpen ? {} : null),
  } as unknown as Document;
  const calls: ShortcutAction[] = [];
  const actions = [
    'open',
    'render',
    'export',
    'cancel',
    'front',
    'side',
    'three-quarter',
    'isometric',
    'nextLook',
    'toggleSelected',
    'help',
    'undo',
    'redo',
    'playPause',
    'move',
    'rotate',
    'overlays',
    'rename',
    'outliner',
    'inspector',
    'timeline',
  ] as const;
  const handlers = Object.fromEntries(actions.map((a) => [a, () => calls.push(a)])) as unknown as Record<
    ShortcutAction,
    () => void
  >;
  const unbind = bindShortcuts(target, handlers);
  const press = (key: string, extra: Record<string, unknown> = {}, element: FakeElement | null = null) => {
    const event = {
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: element,
      preventDefault: vi.fn(),
      ...extra,
    };
    handler?.(event);
    return event;
  };
  return { calls, press, unbind, removeListener };
}

beforeEach(() => vi.stubGlobal('HTMLElement', FakeElement));
afterEach(() => vi.unstubAllGlobals());

describe('bindShortcuts', () => {
  it('runs the action of a key and keeps the browser from also handling it', () => {
    const { calls, press } = setup();
    const event = press('o', { ctrlKey: true });
    expect(calls).toEqual(['open']);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each(['INPUT', 'SELECT', 'TEXTAREA'])('ignores keys typed in a %s', (tag) => {
    const { calls, press } = setup();
    const event = press('r', {}, new FakeElement(tag));
    expect(calls).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores keys in an editable element', () => {
    const { calls, press } = setup();
    const editable = new FakeElement('DIV');
    editable.isContentEditable = true;
    press('r', {}, editable);
    expect(calls).toEqual([]);
  });

  it('ignores every key while a dialog is open', () => {
    const { calls, press } = setup(true);
    press('r');
    press('Escape');
    expect(calls).toEqual([]);
  });

  it('leaves the viewport keys, repeats and handled events alone', () => {
    const { calls, press } = setup();
    for (const key of ['ArrowLeft', 'o', 'i', '0', '+']) press(key);
    press('r', { repeat: true });
    press('r', { defaultPrevented: true });
    press('r', { isComposing: true });
    expect(calls).toEqual([]);
  });

  it('plays and pauses on Space, but leaves Space to a focused button, link, tab or separator', () => {
    const { calls, press } = setup();
    press(' ');
    expect(calls).toEqual(['playPause']);
    for (const element of [
      new FakeElement('BUTTON'),
      new FakeElement('A'),
      new FakeElement('DIV', 'separator'),
      new FakeElement('BUTTON', 'tab'),
    ]) {
      const event = press(' ', {}, element);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(calls).toEqual(['playPause']);
  });

  it('handles the editing keys', () => {
    const { calls, press } = setup();
    press('z', { ctrlKey: true });
    press('z', { ctrlKey: true, shiftKey: true });
    press('w');
    press('e');
    expect(calls).toEqual(['undo', 'redo', 'move', 'rotate']);
  });

  it('stops listening when unbound', () => {
    const { unbind, removeListener } = setup();
    unbind();
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
