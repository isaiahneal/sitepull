import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node24',
    rollupOptions: {
      external: ['electron', 'archiver', 'playwright', 'playwright-core'],
      output: {
        entryFileNames: 'main.cjs',
        chunkFileNames: 'main-[name]-[hash].cjs',
      },
    },
  },
});
