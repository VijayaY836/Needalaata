import { defineConfig } from 'vitest/config';
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
  test: {
    include: [
      'src/**/*.test.ts',
      'tools/**/*.test.ts',
      'training/**/*.test.ts',
      'src/classifier/**/*.test.ts',
    ],
  },
});
