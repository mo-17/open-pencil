import { resolve } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

import packageJson from './package.json'
import { createOpenPencilAliases } from './vite/aliases'
import { localAutomationToken, openPencilAutomationPlugin } from './vite/automation'
import { copyCanvasKitAssetsPlugin } from './vite/canvaskit-assets'
import { openPencilPwaPlugin } from './vite/pwa'
import { rawMarkdownPlugin } from './vite/raw-markdown'
import { createDevServerOptions } from './vite/server'

const host = process.env.TAURI_DEV_HOST

export default defineConfig(async ({ command }) => ({
  resolve: {
    alias: createOpenPencilAliases(__dirname)
  },
  define: {
    __OPENPENCIL_APP_VERSION__: JSON.stringify(packageJson.version),
    __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: JSON.stringify(localAutomationToken(command)),
    // Project root injected at build time; the lowcode preview pane passes it as
    // a known cwd + `--root` to the dev-server sidecar so it resolves
    // react/tailwind from the workspace node_modules regardless of where Tauri
    // spawned the child process.
    __OPENPENCIL_PROJECT_ROOT__: JSON.stringify(__dirname)
  },
  plugins: [
    rawMarkdownPlugin(),
    copyCanvasKitAssetsPlugin(),
    tailwindcss(),
    Icons({ compiler: 'vue3' }),
    Components({ resolvers: [IconsResolver({ prefix: 'icon' })] }),
    openPencilAutomationPlugin(command, host),
    vue(),
    openPencilPwaPlugin()
  ],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        aiPopout: resolve(__dirname, 'ai-popout.html'),
        previewPopout: resolve(__dirname, 'preview-popout.html')
      }
    }
  },
  worker: {
    format: 'es'
  },
  server: createDevServerOptions(host)
}))
