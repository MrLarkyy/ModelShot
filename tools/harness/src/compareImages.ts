import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface CompareOptions {
  threshold?: number;
  maxDiffRatio?: number;
  maxMeanDelta?: number;
  includeAA?: boolean;
}

export interface CompareResult {
  pass: boolean;
  diffPixels: number;
  ratio: number;
  meanDelta: number;
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
  const { threshold = 0.1, maxDiffRatio = 0.001, maxMeanDelta = 1, includeAA = true } = options;
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
  let total = 0;
  for (let i = 0; i < actual.data.length; i++) total += Math.abs(actual.data[i]! - expected.data[i]!);
  // pixelmatch ignores a uniform shift of a few percent; the mean catches global changes such as exposure.
  const meanDelta = total / actual.data.length;
  return {
    pass: ratio <= maxDiffRatio && meanDelta <= maxMeanDelta,
    diffPixels,
    ratio,
    meanDelta,
    diffPng: PNG.sync.write(diff),
  };
}
