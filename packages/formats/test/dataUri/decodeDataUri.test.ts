import { describe, expect, it } from 'vitest';
import { decodeDataUri } from '../../src/dataUri/decodeDataUri';

describe('decodeDataUri', () => {
  it('decodes a base64 data URI and lower-cases its type', () => {
    expect(decodeDataUri('data:IMAGE/PNG;base64,AAEC/w==', 100)).toEqual({
      ok: true,
      mimeType: 'image/png',
      bytes: new Uint8Array([0, 1, 2, 255]),
    });
  });

  it('decodes an empty payload to no bytes', () => {
    expect(decodeDataUri('data:image/png;base64,', 100)).toEqual({
      ok: true,
      mimeType: 'image/png',
      bytes: new Uint8Array(0),
    });
  });

  it('checks the length before decoding', () => {
    expect(decodeDataUri('data:image/png;base64,AAAA', 25)).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(decodeDataUri('data:image/png;base64,AAAA', 26)).toMatchObject({ ok: true });
  });

  it.each([
    ['no data: prefix', 'image/png;base64,AAAA', 'NOT_BASE64_DATA_URI'],
    ['not base64', 'data:image/png,AAAA', 'NOT_BASE64_DATA_URI'],
    ['https URL', 'https://example.invalid/a.png', 'NOT_BASE64_DATA_URI'],
    ['bad alphabet', 'data:image/png;base64,AA!A', 'BAD_BASE64'],
    ['whitespace', 'data:image/png;base64,AA AA', 'BAD_BASE64'],
    ['unpadded', 'data:image/png;base64,AAE', 'BAD_BASE64'],
    ['truncated', 'data:image/png;base64,AAECA', 'BAD_BASE64'],
    ['padding inside', 'data:image/png;base64,AA==AAAA', 'BAD_BASE64'],
  ])('rejects %s', (_name, uri, reason) => {
    expect(decodeDataUri(uri, 1000)).toEqual({ ok: false, reason });
  });
});
