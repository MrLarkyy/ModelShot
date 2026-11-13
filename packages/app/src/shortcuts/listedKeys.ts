export interface ListedKeys {
  /** The keys as written: alternatives split by " / ", the keys of one press by "+". */
  readonly keys: string;
  readonly label: string;
}

/** Splits listed keys into alternatives of key names: "Shift+Arrows" is one press of two keys, "+ / -" two presses. */
export function parseKeys(keys: string): string[][] {
  return keys.split(' / ').map((alternative) => (alternative === '+' ? ['+'] : alternative.split('+')));
}
