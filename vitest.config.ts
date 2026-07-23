import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * R1 (docs/17 §1) — pure-logic unit tests, zero infra. Node environment (no
 * DOM needed); manual `@/*` alias mirrors tsconfig.json's `paths` since these
 * tests run outside Next's own bundler.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
