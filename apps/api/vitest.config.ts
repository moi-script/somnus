import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // Each file gets the same database; running them in parallel would let
    // one file's cleanup delete another file's fixtures.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
