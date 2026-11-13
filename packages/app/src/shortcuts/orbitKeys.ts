import type { ListedKeys } from './listedKeys';

export interface OrbitKeys extends ListedKeys {
  /** Presses `orbitKeyAction` must answer, so this list cannot name a key the view does not take. */
  readonly probes: readonly (readonly [key: string, shift: boolean])[];
}

/** The keys of the focused 3D view (the renderer's `orbitKeyAction`); a test pins each against it. */
export const ORBIT_KEYS: readonly OrbitKeys[] = [
  { keys: 'Arrows', label: 'Orbit (in the 3D view)', probes: [['ArrowLeft', false]] },
  { keys: 'Shift+Arrows', label: 'Pan', probes: [['ArrowLeft', true]] },
  {
    keys: '+ / -',
    label: 'Zoom',
    probes: [
      ['+', false],
      ['-', false],
    ],
  },
  {
    keys: '0 / Home',
    label: 'Reset the view',
    probes: [
      ['0', false],
      ['Home', false],
    ],
  },
  { keys: 'O', label: 'Perspective or orthographic', probes: [['o', false]] },
  { keys: 'I', label: 'Isometric view', probes: [['i', false]] },
];
