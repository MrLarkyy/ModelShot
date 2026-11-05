import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelightDebt } from '../src/editor/RelightDebt';

const DELAY = 200;

function debt() {
  const host = { passing: false, held: false, relights: 0 };
  const owner: RelightDebt = new RelightDebt(
    {
      relight: () => {
        host.relights++;
        owner.bakeStarted();
      },
      passing: () => host.passing,
      held: () => host.held,
    },
    DELAY,
  );
  return { host, owner };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RelightDebt', () => {
  it('relights a pose that stays once, however often it was shown', () => {
    const { host, owner } = debt();
    owner.posed();
    vi.advanceTimersByTime(DELAY / 2);
    owner.posed();
    vi.advanceTimersByTime(DELAY * 5);
    expect(host.relights).toBe(1);
    expect(owner.owed).toBe(false);
  });

  it('any bake pays the debt', () => {
    const { host, owner } = debt();
    owner.posed();
    owner.bakeStarted();
    vi.advanceTimersByTime(DELAY * 5);
    expect(host.relights).toBe(0);
  });

  it('a passing pose waits until it has settled, a bake of it does not pay', () => {
    const { host, owner } = debt();
    host.passing = true;
    owner.posed();
    owner.bakeStarted();
    vi.advanceTimersByTime(DELAY * 5);
    expect(host.relights).toBe(0);
    expect(owner.owed).toBe(true);
    host.passing = false;
    owner.settled();
    vi.advanceTimersByTime(DELAY);
    expect(host.relights).toBe(1);
  });

  it('a held relight waits for the document under way', () => {
    const { host, owner } = debt();
    host.held = true;
    owner.posed();
    vi.advanceTimersByTime(DELAY * 5);
    expect(host.relights).toBe(0);
    host.held = false;
    vi.advanceTimersByTime(DELAY);
    expect(host.relights).toBe(1);
  });

  it('relightNow lights a passing pose at once and keeps the next pose owed', () => {
    const { host, owner } = debt();
    host.passing = true;
    owner.relightNow();
    expect(host.relights).toBe(1);
    expect(owner.owed).toBe(true);
  });

  it('reset and dispose leave nothing owed or armed', () => {
    const { host, owner } = debt();
    owner.posed();
    owner.reset();
    owner.posed();
    owner.dispose();
    owner.posed();
    owner.settled();
    owner.relightNow();
    vi.advanceTimersByTime(DELAY * 5);
    expect(host.relights).toBe(0);
  });
});
