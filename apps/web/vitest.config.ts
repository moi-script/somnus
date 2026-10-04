import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Pure functions only: no DOM, no React. Screens are checked by screenshots.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { include: ['src/**/*.test.ts'] },
});
