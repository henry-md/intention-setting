import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './public/manifest.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    tailwindcss(),
  ],
  build: {
    outDir: 'build',
    emptyOutDir: false,   // Don't empty during watch builds
    minify: true,
    sourcemap: true,
  },
})
