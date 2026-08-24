import { resolve } from 'node:path'
import process from 'node:process'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'

import packageJson from './package.json'
import { AUTOMATION_HTTP_PORT } from './packages/core/src/constants'
import { devAutomationRoute } from './src/app/automation/bridge/portless-route'
import { createOpenPencilAliases } from './vite/aliases'
import { localAutomationToken, openPencilAutomationPlugin } from './vite/automation'
import { copyCanvasKitAssetsPlugin } from './vite/canvaskit-assets'
import { openPencilProjectRootDefineValue } from './vite/project-root'
import { openPencilPwaPlugin } from './vite/pwa'
import { rawMarkdownPlugin } from './vite/raw-markdown'
import { createDevServerOptions } from './vite/server'

const host = process.env.TAURI_DEV_HOST
const automationRoute = devAutomationRoute(process.env.PORTLESS_URL, AUTOMATION_HTTP_PORT)

export default defineConfig(async ({ command }) => ({
  resolve: {
    alias: createOpenPencilAliases(__dirname)
  },
  define: {
    __OPENPENCIL_APP_VERSION__: JSON.stringify(packageJson.version),
    __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: JSON.stringify(localAutomationToken(command)),
    // Tauri injects the project root so the desktop sidecar can resolve
    // workspace dependencies. Web builds must not disclose the build machine's
    // absolute path.
    __OPENPENCIL_PROJECT_ROOT__: openPencilProjectRootDefineValue(
      __dirname,
      process.env.TAURI_ENV_PLATFORM
    ),
    __OPENPENCIL_LOCAL_AUTOMATION_URL__: JSON.stringify(automationRoute.browserURL),
    __OPENPENCIL_LOCAL_AUTOMATION_HTTP_URL__: JSON.stringify(
      automationRoute.browserURL.replace(/^ws/, 'http')
    )
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
