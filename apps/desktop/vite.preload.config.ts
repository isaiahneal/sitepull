import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node24',
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'preload.cjs',
        chunkFileNames: 'preload.cjs',
      },
    },
  },
});
