import { defineConfig } from 'vite';

// Tests import glTF buffer fixtures (`*.bin`) with `?inline`; Vite only inlines file types it knows as assets.
export default defineConfig({ assetsInclude: ['**/*.bin'] });
