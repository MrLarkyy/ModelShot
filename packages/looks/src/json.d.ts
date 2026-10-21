// Look presets ship as JSON text and go through parseLookPreset like any file a user picks (@modelshot/looks).
declare module '*.json?raw' {
  const text: string;
  export default text;
}
