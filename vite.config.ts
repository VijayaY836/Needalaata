import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-page build: the main vision preview and the separate collector page (Req 1.4).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        collect: resolve(import.meta.dirname, 'tools/collect/index.html'),
      },
    },
  },
});
