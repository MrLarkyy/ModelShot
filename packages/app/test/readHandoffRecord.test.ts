import { describe, expect, it } from 'vitest';
import { describeHandoff } from '../src/handoff/describeHandoff';
import { HandoffLimits } from '../src/handoff/HandoffLimits';
import { readHandoffRecord, type HandoffRead } from '../src/handoff/readHandoffRecord';

const NOW = 1_800_000_000_000;

function model(name = 'cube.bbmodel'): File {
  return new File(['{}'], name);
}

function record(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, files: [model()], createdAt: NOW - 1000, ...fields };
}

describe('readHandoffRecord', () => {
  it('returns the files of a fresh record', () => {
    const files = [model(), model('skin.png')];
    expect(readHandoffRecord(record({ files }), NOW)).toEqual({ kind: 'files', files });
  });

  it('reports no record as none', () => {
    expect(readHandoffRecord(undefined, NOW)).toEqual({ kind: 'none' });
  });

  it('drops a record older than 10 minutes', () => {
    expect(readHandoffRecord(record({ createdAt: NOW - HandoffLimits.maxAgeMs - 1 }), NOW)).toEqual({
      kind: 'expired',
    });
    expect(readHandoffRecord(record({ createdAt: NOW - HandoffLimits.maxAgeMs }), NOW).kind).toBe('files');
  });

  it.each<[string, unknown, string]>([
    ['null', null, 'NOT_A_RECORD'],
    ['a string', 'files', 'NOT_A_RECORD'],
    ['an array', [model()], 'NOT_A_RECORD'],
    ['wrong version', record({ v: 2 }), 'VERSION'],
    ['version as text', record({ v: '1' }), 'VERSION'],
    ['no creation time', record({ createdAt: undefined }), 'CREATED_AT'],
    ['NaN creation time', record({ createdAt: Number.NaN }), 'CREATED_AT'],
    ['creation time in the future', record({ createdAt: NOW + 3_600_000 }), 'CREATED_AT'],
    ['files not a list', record({ files: model() }), 'NO_FILE_LIST'],
    ['a non-File entry', record({ files: [model(), { name: 'a.obj', size: 1 }] }), 'NOT_A_FILE'],
    ['a Blob entry', record({ files: [new Blob(['x'])] }), 'NOT_A_FILE'],
    // eslint-disable-next-line no-sparse-arrays
    ['a hole in the list', record({ files: [, model()] }), 'NOT_A_FILE'],
    ['33 entries', record({ files: Array.from({ length: 33 }, () => model()) }), 'TOO_MANY'],
    ['an empty list', record({ files: [] }), 'EMPTY'],
    ['an unsupported file', record({ files: [model('run.exe')] }), 'UNSUPPORTED_TYPE'],
  ])('rejects %s', (_name, value, reason) => {
    expect(readHandoffRecord(value, NOW)).toEqual({ kind: 'invalid', reason });
  });

  it('ignores fields that come only from the prototype or a __proto__ key', () => {
    expect(readHandoffRecord(Object.create(record()) as object, NOW)).toEqual({ kind: 'invalid', reason: 'VERSION' });
    const parsed = JSON.parse('{"__proto__": {"v": 1, "createdAt": 1}}') as unknown;
    expect(readHandoffRecord(parsed, NOW)).toEqual({ kind: 'invalid', reason: 'VERSION' });
  });

  it('never runs a getter on the record', () => {
    let ran = false;
    const hostile = Object.defineProperty(record(), 'files', {
      get() {
        ran = true;
        return [model()];
      },
    });
    expect(readHandoffRecord(hostile, NOW)).toEqual({ kind: 'invalid', reason: 'NO_FILE_LIST' });
    expect(ran).toBe(false);
  });

  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [0, true, Symbol('x'), () => 1, new Map(), new Proxy({}, {}), Object.create(null)];
    for (const value of odd) expect(() => readHandoffRecord(value, NOW)).not.toThrow();
  });
});

describe('describeHandoff', () => {
  it('lists names and sizes as plain text', () => {
    const files = [new File(['<img src=x onerror=alert(1)>'], '<b>x</b>.bbmodel')];
    const summary = describeHandoff({ kind: 'files', files });
    expect(summary.items).toEqual(['<b>x</b>.bbmodel · 28 bytes']);
    expect(summary.message).toContain('Opening models arrives with the editor');
  });

  it.each<[HandoffRead, RegExp]>([
    [{ kind: 'none' }, /^Nothing to open/],
    [{ kind: 'expired' }, new RegExp(`${HandoffLimits.maxAgeMs / 60_000} minutes`)],
    [{ kind: 'invalid', reason: 'VERSION' }, /\(VERSION\)/],
  ])('explains %o', (read, pattern) => {
    const summary = describeHandoff(read);
    expect(summary.message).toMatch(pattern);
    expect(summary.items).toEqual([]);
  });
});
