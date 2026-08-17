import { VitePWA } from 'vite-plugin-pwa'

export function openPencilPwaPlugin() {
  return VitePWA({
    registerType: 'autoUpdate',
    devOptions: { enabled: false },
    workbox: {
      maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      globPatterns: ['**/*.{js,css,html,wasm,png,ico,ttf,webmanifest}'],
      // esbuild-wasm is loaded on demand by the browser-preview Worker and is
      // larger than the app-shell precache budget. The preview also relies on
      // pinned esm.sh modules, so treating this runtime as an offline shell
      // asset would be misleading and makes Workbox reject production builds.
      globIgnores: ['**/esbuild-*.wasm'],
      navigateFallback: '/index.html'
    },
    manifest: {
      name: 'OpenPencil',
      short_name: 'OpenPencil',
      description: 'Open-source design editor',
      display: 'standalone',
      orientation: 'any',
      start_url: '/',
      scope: '/',
      theme_color: '#1e1e1e',
      background_color: '#1e1e1e',
      categories: ['design', 'productivity'],
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }
  })
}
