function sorted(values: readonly number[]): number[] {
  if (values.length === 0) throw new Error('no measurements to summarise');
  return [...values].sort((a, b) => a - b);
}

export function median(values: readonly number[]): number {
  const s = sorted(values);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function p90(values: readonly number[]): number {
  const s = sorted(values);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]!;
}
