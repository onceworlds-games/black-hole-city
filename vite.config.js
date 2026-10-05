import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: the game is served from its own folder on Onceworlds.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: 0,
  },
});
