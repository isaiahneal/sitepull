import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@sitepull/contracts': fromRoot('./packages/contracts/src/index.ts'),
      '@sitepull/core': fromRoot('./packages/core/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.vite/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
