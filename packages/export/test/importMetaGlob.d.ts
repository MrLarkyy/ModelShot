// Vite's import.meta.glob, as the local-first test reads the package's sources with it (no Node types here).
interface ImportMeta {
  glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
}
