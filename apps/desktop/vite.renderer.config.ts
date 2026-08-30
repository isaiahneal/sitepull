import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: false,
  },
  build: {
    emptyOutDir: true,
    outDir: path.resolve(import.meta.dirname, '.vite/renderer/main_window'),
  },
});
