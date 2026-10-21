/**
 * Whether a `.bbmodel` `format_version` (as `loadBbmodel` accepted it: dot-separated decimal numbers) is older than
 * `than`, comparing segment by segment as numbers (`4.10` is newer than `4.5`); a missing segment counts as 0. The
 * version gates of Blockbench's project import that the loader repeats.
 */
export function formatVersionBefore(version: string, than: string): boolean {
  const a = version.split('.').map(Number);
  const b = than.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
