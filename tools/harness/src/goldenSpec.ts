export interface GoldenTolerance {
  threshold?: number;
  maxDiffRatio?: number;
  maxMeanDelta?: number;
  reason: string;
}

export interface RasterGoldenSpec {
  kind: 'raster';
  fixture: string;
  name: string;
  variant?: string;
  tolerance?: GoldenTolerance;
}

export interface PathTracedGoldenSpec {
  kind: 'pathtraced';
  fixture: string;
  name: string;
  seed: number;
  samples: number;
  tolerance?: GoldenTolerance;
}

export type GoldenSpec = RasterGoldenSpec | PathTracedGoldenSpec;

export const MAX_SEED = 2 ** 32 - 1;
export const MAX_SAMPLES = 4096;

const NAME = /^[a-z0-9][a-z0-9-]*$/;

function checkInteger(label: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}, got ${String(value)}`);
  }
}

function checkRange(label: string, value: number | undefined, max: number): void {
  if (value !== undefined && !(Number.isFinite(value) && value >= 0 && value <= max)) {
    throw new Error(`${label} must be a number in 0..${max}, got ${String(value)}`);
  }
}

export function validateSpec(spec: GoldenSpec): void {
  if (!NAME.test(spec.name)) throw new Error(`golden name "${spec.name}" must match ${String(NAME)}`);
  if (!NAME.test(spec.fixture)) throw new Error(`fixture "${spec.fixture}" must match ${String(NAME)}`);
  if (spec.kind === 'pathtraced') {
    checkInteger('seed', spec.seed, 0, MAX_SEED);
    checkInteger('samples', spec.samples, 1, MAX_SAMPLES);
  }
  const tolerance = spec.tolerance;
  if (tolerance) {
    if (tolerance.reason.trim() === '') throw new Error('a golden tolerance override needs a non-empty reason');
    checkRange('tolerance.threshold', tolerance.threshold, 1);
    checkRange('tolerance.maxDiffRatio', tolerance.maxDiffRatio, 1);
    checkRange('tolerance.maxMeanDelta', tolerance.maxMeanDelta, 255);
  }
}

export function goldenFileName(spec: GoldenSpec): string {
  validateSpec(spec);
  return spec.kind === 'pathtraced' ? `${spec.name}.s${spec.seed}.n${spec.samples}.png` : `${spec.name}.png`;
}

export function fixtureUrl(spec: GoldenSpec): string {
  validateSpec(spec);
  const params = new URLSearchParams();
  if (spec.kind === 'raster') {
    if (spec.variant) params.set('variant', spec.variant);
  } else {
    params.set('seed', String(spec.seed));
    params.set('samples', String(spec.samples));
  }
  const query = params.toString();
  return `/${spec.fixture}.html${query ? `?${query}` : ''}`;
}
