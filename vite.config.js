import { defineConfig } from 'vite';

// base './' makes every asset URL relative, which is required for the Electron build
// (the app is loaded from disk via file://) and also works on any static web host.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000, // ExcelJS is large; the desktop app loads it from disk
  },
});
