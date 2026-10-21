// The one source of the Block Party brand. css/tokens.css and css/illustration.css are generated from it
// (renderTokensCss, checked by test/tokens.test.ts); docs/brand.md describes the roles.
export const tokens = {
  color: {
    cloud: '#EEF0F4',
    paper: '#FFFFFF',
    ink: '#121318',
    slate: '#4E5361',
    shotBlue: '#2F4BFF',
    flash: '#FF6A3D',
    sun: '#FFD23F',
    blueHover: '#1A33D6',
    blueTint: '#C9D1FF',
    blueMid: '#8C9BFF',
    blueDeep: '#1A2CB8',
    dropGround: '#F5F6FF',
    hairline: '#D5D9E2',
    border: '#C7CBD6',
    mutedOnInk: '#C9CCD6',
  },
  shadow: {
    lift: '0 18px 40px -18px rgb(18 19 24 / 0.45)',
  },
  font: {
    display: "'Unbounded', system-ui, sans-serif",
    body: "'Manrope', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    heavy: 800,
  },
  size: {
    display: 96,
    h1: 52,
    h2: 24,
    body: 17,
    ui: 15,
    label: 13,
  },
  radius: {
    control: 14,
    button: 18,
    tile: 24,
    card: 32,
    panel: 40,
  },
  space: [4, 8, 12, 16, 24, 32, 56, 112],
  motion: {
    fast: 150,
    ui: 200,
    slow: 250,
    glow: 2600,
    sweep: 5000,
    float: 6000,
    cycle: 8000,
    ease: 'ease',
    easeInOut: 'ease-in-out',
  },
  focus: {
    width: 3,
    offset: 3,
    ring: '#121318',
    onDark: '#FFD23F',
  },
  illustration: {
    grass: { top: '#9BE37F', left: '#55B04A', right: '#3C8A3A' },
    wood: { top: '#E0A464', left: '#A8703D', right: '#7C4F2A' },
    foliage: { top: '#FFE36E', left: '#FFB23F', right: '#FF6A3D' },
    lantern: { top: '#FFF6D6', left: '#FFE07A', right: '#FFC24A' },
    glow: { core: '#FFE07A', mid: '#FFB23F', edge: '#FF6A3D' },
    islandShadow: '#1A2CB8',
    ember: '#6A4527',
    // Peak of the render sweep over shot blue: 0.12 keeps paper text at 4.74:1 (test/contrast.test.ts).
    sweep: 'rgb(255 255 255 / 0.12)',
    marketplace: {
      ground: '#2A3A7C',
      groundDeep: '#0B1230',
      top: '#F3F5FC',
      left: '#5B6BA8',
      right: '#1F2A5C',
      rim: '#FFB547',
    },
    daylight: { ground: '#BFE3FF', top: '#FFFFFF', left: '#A9C4E0', right: '#7397BC' },
    sunset: { ground: '#FF6A3D', top: '#FFE3B0', left: '#FFB27A', right: '#A8452A' },
    noir: { ground: '#121318', top: '#D5D9E2', left: '#4E5361', right: '#23252D', rim: '#FFFFFF' },
  },
} as const;

export type Tokens = typeof tokens;
export type ColorRole = keyof Tokens['color'];
