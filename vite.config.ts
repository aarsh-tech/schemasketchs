/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // ask before swapping in a new version: the app shows an "Update available" toast
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Schemasketch',
        short_name: 'Schemasketch',
        description: 'Draw database diagrams by writing DBML. Runs entirely in your browser, offline too.',
        theme_color: '#1f6b5c',
        background_color: '#f3f4f1',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // the app shell, fonts, the parse worker and the lazy chunks are precached
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // the SQL import worker is ~15 MB: it's cached the first time someone imports SQL instead
        globIgnores: ['**/sql.worker-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/sql\.worker-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'schemasketch-sql-worker', expiration: { maxEntries: 2 } },
          },
        ],
      },
    }),
  ],
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
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
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
