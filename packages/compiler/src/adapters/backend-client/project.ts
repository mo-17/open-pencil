import {
  emitBrowserAuthentication,
  OPENID_CLIENT_VERSION
} from '#compiler/backend/nestjs/browser-auth'
import { emitNestJSClient } from '#compiler/backend/nestjs/client'
import type { IRTree } from '#compiler/ir/types'
import type { CompilerOptions } from '#compiler/types'

import { deriveLowcodePageRoutes, validateLowcodeNavigationTarget } from '@open-pencil/lowcode'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { COMMAND_JOURNAL_SOURCE } from './command-recovery/storage'
import { buildBackendClientGuide } from './guide'
import { buildBackendClientRuntime } from './runtime'

/** Bootstrap before evaluating the router module: callback URL cleanup must happen first. */
export function integrateBackendClientProject(
  files: Map<string, string | Uint8Array>,
  application: BackendApplicationSpecV1 | undefined,
  options: CompilerOptions,
  loginPath = '/login',
  pages: readonly IRTree[] = []
): void {
  const browserClient = application?.httpApi?.browserClient
  if (!application || !browserClient) return
  assertBackendLoginPath(loginPath, pages)
  const connectedPreview = options.devMode && options.backendPreview?.kind === 'nestjs-local'
  assertBackendProjectTarget(options, connectedPreview)
  const main = options.target === 'vue' ? 'src/main.ts' : 'src/main.tsx'
  const original = files.get(main)
  if (typeof original !== 'string')
    throw new Error('Backend browser client requires a Vite application entrypoint.')
  const mount =
    options.target === 'vue' ? 'src/lowcode-backend-mount.ts' : 'src/lowcode-backend-mount.tsx'
  const additions: Record<string, string> = {
    ...(application.commands?.commands.length
      ? { 'src/lowcode-backend-command-journal.ts': COMMAND_JOURNAL_SOURCE }
      : {}),
    ...(connectedPreview
      ? {}
      : {
          'BACKEND-CLIENT.md': buildBackendClientGuide(application, loginPath),
          'openpencil-local-app.json': JSON.stringify({ version: 1, loginPath }, null, 2) + '\n'
        }),
    [mount]: original,
    'src/lowcode-backend-auth.ts': emitBrowserAuthentication(application),
    'src/lowcode-backend-api.ts': String(emitNestJSClient(application).content),
    'src/lowcode-backend.ts': buildBackendClientRuntime(
      application,
      options.target === 'vue' ? './lowcode-state' : './_lowcode_state',
      loginPath
    )
  }
  for (const [path, content] of Object.entries(additions)) {
    if (files.has(path)) throw new Error('Backend client artifact collision.')
    files.set(path, content)
  }
  files.set(
    main,
    `import { initializeBackendClient } from './lowcode-backend'\nvoid initializeBackendClient().then(() => import('./lowcode-backend-mount'))\n`
  )
  integrateClientDependencies(files, browserClient.apiBasePath, connectedPreview)
}

function assertBackendProjectTarget(options: CompilerOptions, connectedPreview: boolean): void {
  if (
    !['react', 'vue'].includes(options.target) ||
    (options.devMode && !connectedPreview) ||
    options.packaging?.kind === 'microfrontend'
  )
    throw new Error(
      'Backend browser clients require a standalone React or Vue export or a connected desktop preview.'
    )
}

function integrateClientDependencies(
  files: Map<string, string | Uint8Array>,
  base: string,
  connectedPreview: boolean
): void {
  const manifest = files.get('package.json')
  if (typeof manifest !== 'string') throw new Error('Frontend package manifest is required.')
  const parsed = JSON.parse(manifest) as { dependencies?: Record<string, string> }
  parsed.dependencies = { ...parsed.dependencies, 'openid-client': OPENID_CLIENT_VERSION }
  files.set('package.json', JSON.stringify(parsed, null, 2) + '\n')
  // The trusted desktop sidecar owns its fixed loopback connection; a VFS config cannot proxy.
  if (connectedPreview) return
  const vite = files.get('vite.config.ts')
  if (typeof vite !== 'string' || !vite.includes('export default defineConfig({'))
    throw new Error('Backend client requires a known Vite configuration.')
  const prefix = JSON.stringify('^' + base.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '(?:/|$)')
  const proxy = `server: { proxy: { [${prefix}]: { target: 'http://127.0.0.1:3000', changeOrigin: false, rewrite: (path: string) => path.slice(${base.length}) || '/' } } },`
  files.set(
    'vite.config.ts',
    vite.replace('export default defineConfig({', `export default defineConfig({\n  ${proxy}`)
  )
}

function assertBackendLoginPath(path: string, pages: readonly IRTree[]): void {
  const routes = deriveLowcodePageRoutes(pages)
  const login = routes.find((route) => route.route === path)
  if (
    !validateLowcodeNavigationTarget(path).ok ||
    path.startsWith('/_openpencil') ||
    !login ||
    pages.find((page) => page.pageId === login.pageId)?.requiresAuth
  ) {
    throw new Error('Backend login requires an exported, unprotected application route.')
  }
}
