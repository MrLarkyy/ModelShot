function hex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0').toUpperCase();
}

// The opaque colour an `rgb(r g b / a)` overlay produces over an opaque #RRGGBB ground (source-over in sRGB, as
// browsers composite), so text contrast can be checked under a translucent layer.
export function compositeOver(overlay: string, ground: string): string {
  const top = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(overlay);
  const base = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(ground);
  if (!top || !base) throw new Error(`expected rgb(r g b / a) over #RRGGBB, got "${overlay}" over "${ground}"`);
  const alpha = Number(top[4]);
  const channels = [1, 2, 3].map((i) => Number(top[i]) * alpha + parseInt(base[i]!, 16) * (1 - alpha));
  return `#${channels.map(hex).join('')}`;
}
