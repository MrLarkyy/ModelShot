const clampCount = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Minutes and seconds, "m:ss"; the minutes grow past 59 rather than wrapping into hours. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(clampCount(ms) / 1000);
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${String(seconds).padStart(2, '0')}`;
}

/** "128 / 256 samples · 50 % · 0:12". */
export function progressText(done: number, target: number, ms: number): string {
  const total = clampCount(target);
  const finished = Math.min(clampCount(done), total);
  const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
  return `${finished} / ${total} samples · ${percent} % · ${formatElapsed(ms)}`;
}

/** "1920 × 1080 px · 256 samples · 0:24". */
export function resultText(width: number, height: number, samples: number, ms: number): string {
  return `${clampCount(width)} × ${clampCount(height)} px · ${clampCount(samples)} samples · ${formatElapsed(ms)}`;
}
