import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @dbml/core only exposes its full entry, which bundles every SQL parser (~15 MB).
      // The live DBML parse only needs the model classes, so we import them directly.
      '@dbml-core-database': fileURLToPath(new URL('./node_modules/@dbml/core/lib/model_structure/database.mjs', import.meta.url)),
      '@dbml-core-exporter': fileURLToPath(new URL('./node_modules/@dbml/core/lib/export/ModelExporter.mjs', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-flow', test: /node_modules[\\/]@xyflow/ },
            { name: 'codemirror', test: /node_modules[\\/](@codemirror|@lezer|@uiw)/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
