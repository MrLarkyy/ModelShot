export type OrbitKeyAction =
  | { readonly kind: 'rotate'; readonly yawDeg: number; readonly pitchDeg: number }
  | { readonly kind: 'pan'; readonly dxPx: number; readonly dyPx: number }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'reset' }
  | { readonly kind: 'toggleProjection' }
  | { readonly kind: 'isometric' };

export const KEY_ROTATE_DEG = 7.5;
export const KEY_PAN_PX = 24;
export const KEY_ZOOM_FACTOR = 1.15;

/**
 * Keyboard camera controls on the focused view: arrows orbit, Shift + arrows pan, + / − zoom, Home or 0 frames the
 * model again, O toggles orthographic, I sets the isometric view. `null` for any other key (left to the page).
 */
export function orbitKeyAction(key: string, shiftKey: boolean): OrbitKeyAction | null {
  const arrows: Record<string, readonly [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  const arrow = Object.hasOwn(arrows, key) ? arrows[key] : undefined;
  if (arrow) {
    const [x, y] = arrow;
    return shiftKey
      ? { kind: 'pan', dxPx: x * KEY_PAN_PX, dyPx: -y * KEY_PAN_PX }
      : { kind: 'rotate', yawDeg: x * KEY_ROTATE_DEG, pitchDeg: y * KEY_ROTATE_DEG };
  }
  switch (key) {
    case '+':
    case '=':
      return { kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR };
    case '-':
    case '_':
      return { kind: 'zoom', factor: KEY_ZOOM_FACTOR };
    case 'Home':
    case '0':
      return { kind: 'reset' };
    case 'o':
    case 'O':
      return { kind: 'toggleProjection' };
    case 'i':
    case 'I':
      return { kind: 'isometric' };
    default:
      return null;
  }
}
