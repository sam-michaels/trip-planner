import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // maplibre-gl loads its vector-tile parser as a separate worker
    // bundle via a `new Worker(new URL(...))` call. Vite's esbuild
    // pre-bundling doesn't resolve that URL correctly, which 404s the
    // worker and leaves the map with no tile data (just background
    // color, no roads/coastlines). Excluding it here makes Vite serve
    // the package as-published instead of pre-bundling it.
    exclude: ['maplibre-gl'],
  },
})
