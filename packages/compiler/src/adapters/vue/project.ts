import type { PagePathInfo } from '#compiler/adapters/react/route-paths'
import { buildIndexCSS, buildMetadataTags } from '#compiler/project'
import type { CompilerOptions, HTMLMetadata } from '#compiler/types'

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
  devMode = false
): string {
  const routerImport = router ? `import { router } from './router'\n` : ''
  const routerUse = router ? '.use(router)' : ''
  const validationCSS = lowcode.validation ? `import './lowcode-validation.css'\n` : ''
  const previewImports = devMode ? `import './lowcode-state'\nimport './__preview-bridge'\n` : ''
  return `import { createApp } from 'vue'
${routerImport}import App from './App.vue'
import './index.css'
${validationCSS}${previewImports}
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

export function buildVueRouter(infos: readonly PagePathInfo[]): string {
  const imports = infos
    .map((info) => `import ${info.component} from './pages/${info.slug}.vue'`)
    .join('\n')
  const routes = infos
    .map(
      (info) =>
        `  { path: ${JSON.stringify(info.route)}, component: ${info.component}, name: ${JSON.stringify(info.slug)} }`
    )
    .join(',\n')
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

export function buildVueIndexCSSFile(
  classNames: readonly string[],
  options: CompilerOptions
): string {
  const custom = [options.themeCss?.trim(), options.metadata?.customCss?.trim()]
    .filter(Boolean)
    .join('\n\n')
  return buildIndexCSS(classNames, '', custom)
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
