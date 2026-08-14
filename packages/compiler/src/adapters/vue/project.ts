import type { PagePathInfo } from '#compiler/adapters/react/route-paths'
import { buildIndexCSS, buildMetadataTags } from '#compiler/project'
import type { CompilerMicrofrontendPackaging, CompilerOptions, HTMLMetadata } from '#compiler/types'

import { scopeMicrofrontendCSS } from '../microfrontend-css'
import type { VueLowcodeUsage } from './lowcode/usage'

const VUE_VERSION = '^3.5.29'
const VUE_ROUTER_VERSION = '^4.6.4'

export function buildVuePackageJSON(options: CompilerOptions, router: boolean): string {
  const dependencies: Record<string, string> = { vue: VUE_VERSION }
  if (router) dependencies['vue-router'] = VUE_ROUTER_VERSION
  return `${JSON.stringify(
    {
      name: options.packageName,
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vue-tsc --noEmit && vite build',
        preview: 'vite preview',
        typecheck: 'vue-tsc --noEmit'
      },
      dependencies,
      devDependencies: {
        '@tailwindcss/vite': '^4.2.1',
        '@vitejs/plugin-vue': '^6.0.5',
        tailwindcss: '^4.2.1',
        typescript: '~5.9.3',
        vite: '^7.0.0',
        'vue-tsc': '^3.0.8'
      }
    },
    null,
    2
  )}\n`
}

export function buildVueViteConfig(): string {
  return `import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: { assetsInlineLimit: 0 }
})
`
}

export function buildVueTsConfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        useDefineForClassFields: true,
        module: 'ESNext',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: false,
        resolveJsonModule: true,
        isolatedModules: true,
        esModuleInterop: true,
        strict: true,
        noEmit: true,
        baseUrl: '.'
      },
      include: ['src/**/*.ts', 'src/**/*.vue', 'src/**/*.d.ts']
    },
    null,
    2
  )}\n`
}

export function buildVueIndexHTML(
  packageName: string,
  metadata: HTMLMetadata | undefined,
  sourceLocale?: string
): string {
  const title = cleanText(metadata?.title) ?? packageName
  const locale = normalizeVueSourceLocale(sourceLocale)
  const direction = isRTLLocale(locale) ? ' dir="rtl"' : ''
  const extra = buildMetadataTags(metadata)
  return `<!doctype html>
<html lang="${escapeHTML(locale)}"${direction}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHTML(title)}</title>
${extra}  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`
}

export function buildVueMain(
  router: boolean,
  lowcode: VueLowcodeUsage = { toast: false, confirm: false, validation: false },
  devMode = false,
  microfrontend = false
): string {
  let routerImport = ''
  if (router) {
    routerImport = microfrontend
      ? `import { createMicrofrontendRouter } from './router'\n`
      : `import { router } from './router'\n`
  }
  const routerDeclaration =
    router && microfrontend
      ? `const { router } = createMicrofrontendRouter(import.meta.env.BASE_URL)\n`
      : ''
  const routerUse = router ? '.use(router)' : ''
  const validationCSS = lowcode.validation ? `import './lowcode-validation.css'\n` : ''
  const previewImports = devMode ? `import './lowcode-state'\nimport './__preview-bridge'\n` : ''
  return `import { createApp } from 'vue'
${routerImport}import App from './App.vue'
import './index.css'
${validationCSS}${previewImports}${routerDeclaration}
createApp(App)${routerUse}.mount('#app')
`
}

export function buildVueApp(
  router: boolean,
  firstPageComponent: string,
  lowcode: VueLowcodeUsage = { toast: false, confirm: false, validation: false }
): string {
  const imports = router
    ? [`import { RouterView } from 'vue-router'`]
    : [`import ${firstPageComponent} from './pages/index.vue'`]
  if (lowcode.toast) imports.push(`import LowcodeToastHost from './LowcodeToastHost.vue'`)
  if (lowcode.confirm) imports.push(`import LowcodeConfirmHost from './LowcodeConfirmHost.vue'`)
  const content = [
    router ? '  <RouterView />' : `  <${firstPageComponent} />`,
    ...(lowcode.toast ? ['  <LowcodeToastHost />'] : []),
    ...(lowcode.confirm ? ['  <LowcodeConfirmHost />'] : [])
  ].join('\n')
  return `<script setup lang="ts">
${imports.join('\n')}
</script>

<template>
${content}
</template>
`
}

export function buildVueRouter(infos: readonly PagePathInfo[], microfrontend = false): string {
  const imports = infos
    .map((info) => `import ${info.component} from './pages/${info.slug}.vue'`)
    .join('\n')
  const routes = infos
    .map(
      (info) =>
        `  { path: ${JSON.stringify(info.route)}, component: ${info.component}, name: ${JSON.stringify(info.slug)} }`
    )
    .join(',\n')
  if (microfrontend) {
    return `import { createRouter, createWebHistory } from 'vue-router'

${imports}

const routes = [
${routes}
]

export function createMicrofrontendRouter(basePath: string) {
  const history = createWebHistory(basePath)
  const router = createRouter({ history, routes })
  return { router, dispose: () => history.destroy() }
}
`
  }
  return `import { createRouter, createWebHistory } from 'vue-router'

${imports}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
${routes}
  ]
})
`
}

export function buildVueMicrofrontendContext(): string {
  return `import type { OpenPencilMicrofrontendHostContextV1 } from './__microfrontend-abi'

let currentContext: OpenPencilMicrofrontendHostContextV1 | null = null
let mountTarget: HTMLElement | null = null

export function setMicrofrontendContext(
  value: OpenPencilMicrofrontendHostContextV1 | null
): void {
  currentContext = value
}

export function setMicrofrontendMountTarget(value: HTMLElement | null): void {
  mountTarget = value
}

export function microfrontendHostContext(): OpenPencilMicrofrontendHostContextV1 | null {
  return currentContext
}

export function microfrontendPortalTarget(): HTMLElement | null {
  if (currentContext?.portalTarget) return currentContext.portalTarget
  const root = mountTarget?.getRootNode()
  return root instanceof Document || root instanceof ShadowRoot
    ? root.querySelector<HTMLElement>('[data-openpencil-portal]')
    : null
}
`
}

export function buildVueMicrofrontendEntry(
  packaging: CompilerMicrofrontendPackaging,
  router: boolean,
  lowcode: VueLowcodeUsage,
  devMode: boolean
): string {
  const routerImport = router ? `import { createMicrofrontendRouter } from './router'\n` : ''
  const validationCSS = lowcode.validation ? `import './lowcode-validation.css'\n` : ''
  const previewImports = devMode ? `import './lowcode-state'\nimport './__preview-bridge'\n` : ''
  const routingDeclaration = router
    ? `let routing: ReturnType<typeof createMicrofrontendRouter> | null = null\n`
    : ''
  const routingMount = router
    ? `  routing = createMicrofrontendRouter(context.basePath)\n  application.use(routing.router)\n`
    : ''
  const routingUpdate = router
    ? `  if (routing) await routing.router.replace(relativeLocation(context))\n`
    : `  const next = hostLocation(context)\n  const current = \`\${window.location.pathname}\${window.location.search}\${window.location.hash}\`\n  if (next !== current) window.history.replaceState(window.history.state, '', next)\n`
  const routingDispose = router ? `  routing?.dispose()\n  routing = null\n` : ''
  return `import { createApp, type App as VueApp } from 'vue'
import type { OpenPencilMicrofrontendHostContextV1 } from './__microfrontend-abi'
import App from './App.vue'
import {
  setMicrofrontendContext,
  setMicrofrontendMountTarget
} from './__microfrontend-context'
${routerImport}import './index.css'
${validationCSS}${previewImports}
const APP_ID = ${JSON.stringify(packaging.appId)}

let application: VueApp<Element> | null = null
let container: HTMLElement | null = null
${routingDeclaration}
function assertContext(context: OpenPencilMicrofrontendHostContextV1): void {
  if (context.appId !== APP_ID) {
    throw new Error(\`Microfrontend context appId must be "\${APP_ID}"\`)
  }
  if (!context.basePath.startsWith('/')) {
    throw new Error('Microfrontend basePath must start with /')
  }
}

function hostLocation(context: OpenPencilMicrofrontendHostContextV1): string {
  return \`\${context.location.pathname}\${context.location.search}\${context.location.hash}\`
}

function relativeLocation(context: OpenPencilMicrofrontendHostContextV1): string {
  const base = context.basePath === '/' ? '' : context.basePath.replace(/\\/$/, '')
  const pathname = context.location.pathname
  const relative = base && (pathname === base || pathname.startsWith(base + '/'))
    ? pathname.slice(base.length) || '/'
    : pathname
  return \`\${relative}\${context.location.search}\${context.location.hash}\`
}

async function applyContext(context: OpenPencilMicrofrontendHostContextV1): Promise<void> {
  assertContext(context)
  setMicrofrontendContext(context)
${routingUpdate}}

export async function bootstrap(): Promise<void> {}

export async function mount(
  target: HTMLElement,
  context: OpenPencilMicrofrontendHostContextV1
): Promise<void> {
  if (application) throw new Error('Microfrontend is already mounted')
  assertContext(context)
  application = createApp(App)
${routingMount}  await applyContext(context)
  container = target
  setMicrofrontendMountTarget(target)
  application.mount(target)
}

export async function update(context: OpenPencilMicrofrontendHostContextV1): Promise<void> {
  if (!application) return
  await applyContext(context)
}

export async function unmount(): Promise<void> {
  if (!application) return
  application.unmount()
${routingDispose}  if (container) container.replaceChildren()
  application = null
  container = null
  setMicrofrontendMountTarget(null)
  setMicrofrontendContext(null)
}
`
}

export function buildVueIndexCSSFile(
  classNames: readonly string[],
  options: CompilerOptions
): string {
  const custom = [options.themeCss?.trim(), options.metadata?.customCss?.trim()]
    .filter(Boolean)
    .join('\n\n')
  return buildIndexCSS(
    classNames,
    '',
    options.packaging?.kind === 'microfrontend' ? scopeMicrofrontendCSS(custom) : custom
  )
}

export function buildVueReadme(router: boolean): string {
  return `# OpenPencil Vue export

Generated as a Vite + Vue 3 + TypeScript + Tailwind project${router ? ' with vue-router v4' : ''}.

\`\`\`sh
bun install
bun run dev
bun run build
\`\`\`

This Vue v1 target preserves static design output, bundled image assets, reusable components,
basic state and form bindings, local validation, accessible toast/confirm actions, and supported
navigation/actions.

Font files are included only when the caller supplies redistribution-safe font assets. Otherwise,
check the export warnings and add the licensed files and notices yourself. Check all compiler
warnings before publishing: advanced React-only low-code modules and runtimes are deliberately
omitted.
`
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function normalizeVueSourceLocale(value: string | undefined): string {
  const locale = value?.trim()
  if (!locale) return 'en'
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale) ? locale : 'en'
}

function isRTLLocale(value: string): boolean {
  return RTL_LOCALES.has(value.split('-')[0].toLowerCase())
}

const RTL_LOCALES = new Set([
  'ar',
  'he',
  'iw',
  'fa',
  'ur',
  'ps',
  'sd',
  'ug',
  'yi',
  'ji',
  'dv',
  'ckb',
  'nqo',
  'syr'
])

function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
