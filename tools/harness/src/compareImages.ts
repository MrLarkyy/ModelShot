import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface CompareOptions {
  threshold?: number;
  maxDiffRatio?: number;
  includeAA?: boolean;
}

export interface CompareResult {
  pass: boolean;
  diffPixels: number;
  ratio: number;
  diffPng: Buffer;
}

function decode(png: Buffer, label: string): PNG {
  try {
    return PNG.sync.read(png);
  } catch (error) {
    throw new Error(`${label} image is not a valid PNG: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

export function compareImages(actualPng: Buffer, expectedPng: Buffer, options: CompareOptions = {}): CompareResult {
  const { threshold = 0.1, maxDiffRatio = 0.001, includeAA = true } = options;
  const actual = decode(actualPng, 'actual');
  const expected = decode(expectedPng, 'expected');
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `image size mismatch: actual ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height}`,
    );
  }
  const { width, height } = actual;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(actual.data, expected.data, diff.data, width, height, { threshold, includeAA });
  const ratio = diffPixels / (width * height);
  return { pass: ratio <= maxDiffRatio, diffPixels, ratio, diffPng: PNG.sync.write(diff) };
}
