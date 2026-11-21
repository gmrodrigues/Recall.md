import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [svelte()],
  build: {
    outDir: 'web/build',
    lib: {
      entry: 'web/flow/mount.js',
      formats: ['es'],
      fileName: 'schedule-flow',
      cssFileName: 'schedule-flow',
    },
  },
});
