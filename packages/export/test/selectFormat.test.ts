import { describe, expect, it } from 'vitest';
import type { ClipFormat } from '../src/ExportOptions';
import { selectFormat, type FormatAvailability } from '../src/selectFormat';

function availability(missing: readonly ClipFormat[]): FormatAvailability {
  const entry = (format: ClipFormat) =>
    missing.includes(format) ? { available: false, reason: `no ${format} encoder` } : { available: true };
  return { apng: entry('apng'), gif: entry('gif'), webp: entry('webp'), webm: entry('webm'), mp4: entry('mp4') };
}

describe('selectFormat', () => {
  it('uses the requested format when it is available, without a warning', () => {
    for (const format of ['apng', 'gif', 'webp', 'webm', 'mp4'] as const) {
      expect(selectFormat(format, availability([]))).toEqual({ format, warnings: [] });
    }
  });

  it.each([
    ['mp4', ['mp4'], 'webm', 'MP4', 'WebM'],
    ['mp4', ['mp4', 'webm'], 'apng', 'MP4', 'APNG'],
    ['webm', ['webm'], 'apng', 'WebM', 'APNG'],
    ['webp', ['webp'], 'apng', 'animated WebP', 'APNG'],
  ] as const)('falls back from %s without %j to %s, naming both and why', (requested, missing, used, from, to) => {
    const { format, warnings } = selectFormat(requested, availability(missing));
    expect(format).toBe(used);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'FORMAT_FALLBACK', requested, used });
    expect(warnings[0]?.message).toContain(from);
    expect(warnings[0]?.message).toContain(to);
    expect(warnings[0]?.message).toContain(`no ${requested} encoder`);
  });

  it('fails with UNSUPPORTED_FORMAT when nothing of the chain is available', () => {
    expect(() => selectFormat('gif', availability(['gif']))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_FORMAT', field: 'format' }),
    );
    expect(() => selectFormat('webm', availability(['webm', 'apng']))).toThrow(/WebM cannot be exported here/);
  });
});
