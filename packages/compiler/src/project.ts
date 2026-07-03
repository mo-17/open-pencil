import { validateLowcodeCustomCss } from '@open-pencil/core/lowcode-validation'

import type { CompilerOptions, HtmlMetadata, LowcodeThemeSwitchPosition } from './types'

const REACT_DEP_VERSIONS = {
  '18': { react: '^18.3.1', reactDom: '^18.3.1', reactTypes: '^18.3.12', reactDomTypes: '^18.3.5' },
  '19': { react: '^19.2.0', reactDom: '^19.2.0', reactTypes: '^19.2.0', reactDomTypes: '^19.2.0' }
} as const

/**
 * Build the emitted project's `package.json`. `extraDeps` lets adapters add
 * runtime deps (e.g. `react-router-dom` in multi-page mode); they merge into
 * `dependencies` after the React baseline so adapter-specific entries are
 * grouped together but sort-stable across emits.
 */
export function buildPackageJson(
  options: CompilerOptions,
  extraDeps: Readonly<Record<string, string>> = {}
): string {
  const v = REACT_DEP_VERSIONS[options.reactVersion]
  const dependencies: Record<string, string> = {
    react: v.react,
    'react-dom': v.reactDom,
    ...extraDeps
  }
  const pkg = {
    name: options.packageName,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview'
    },
    dependencies,
    devDependencies: {
      '@tailwindcss/vite': '^4.2.1',
      '@types/react': v.reactTypes,
      '@types/react-dom': v.reactDomTypes,
      '@vitejs/plugin-react': '^4.3.4',
      tailwindcss: '^4.2.1',
      typescript: '~5.6.2',
      vite: '^7.0.0'
    }
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

/** Phase 3 §15: when a UI kit is active, alias `@/` → `src/` so the inlined
 *  shadcn imports (`@/components/ui/button`, `@/lib/utils`) resolve. `withAlias`
 *  false → byte-identical to the pre-§15 config. */
export function buildViteConfig(withAlias = false): string {
  const aliasImport = withAlias ? `import { fileURLToPath } from 'node:url'\n` : ''
  const resolveBlock = withAlias
    ? `,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }`
    : ''
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
${aliasImport}
export default defineConfig({
  plugins: [react(), tailwindcss()]${resolveBlock}
})
`
}

/** Phase 3 §15: `themeCss` (the UI kit's Tailwind v4 theme block) is inserted
 *  right after the Tailwind import so the kit's semantic color utilities
 *  (`bg-primary`, …) resolve. Empty → byte-identical. */
export function buildIndexCss(
  safelistClasses: readonly string[] = [],
  themeCss = '',
  customCss = ''
): string {
  // Tailwind v4's content auto-detection relies on Vite's module graph and a
  // filesystem glob under the project root. Our preview dev-server serves the
  // emitted project from an in-memory VFS, so the glob finds nothing on disk
  // and only base/preflight CSS is generated — utilities are missing and
  // every container collapses to 0×0 in the iframe. We already know every
  // class used (the compiler derived them from the SceneGraph), so declare
  // them via `@source inline(...)` to force Tailwind to emit those utilities
  // regardless of file discovery. Same mechanism is used by Plasmic / WeWeb
  // codegen output.
  // Phase 3 §15: the theme block goes right after the import so its `@theme`
  // tokens register before any `@source inline` utility generation.
  const head = `@import "tailwindcss";\n` + (themeCss ? `\n${themeCss}` : '')
  const tail = customCss ? `\n${customCss}\n` : ''
  if (safelistClasses.length === 0) return `${head}${tail}`
  const joined = safelistClasses.join(' ').replace(/"/g, '\\"')
  return `${head}@source inline("${joined}");\n${tail}`
}

/** Phase 3 §15: `withAlias` adds the `@/* → ./src/*` path mapping so the inlined
 *  shadcn imports typecheck under the standalone `tsc --noEmit`. False →
 *  byte-identical. */
export function buildTsConfig(withAlias = false): string {
  const compilerOptions: Record<string, unknown> = {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    skipLibCheck: true,
    isolatedModules: true,
    noEmit: true,
    allowImportingTsExtensions: false,
    resolveJsonModule: true,
    useDefineForClassFields: true
  }
  if (withAlias) {
    compilerOptions.baseUrl = '.'
    compilerOptions.paths = { '@/*': ['./src/*'] }
  }
  return JSON.stringify({ compilerOptions, include: ['src'] }, null, 2) + '\n'
}

export function buildIndexHtml(
  packageName: string,
  lang = 'en',
  rtl = false,
  metadata?: HtmlMetadata
): string {
  // Phase 3 §9 v12: reflect the source locale on <html lang> (a11y / SEO) and
  // pre-set dir="rtl" for an RTL source so the page doesn't flash LTR before the
  // runtime's useEffect runs. Defaults ('en', false) keep the LTR output byte-identical.
  const title = cleanMetadataText(metadata?.title) ?? packageName
  const meta = buildMetadataTags(metadata)
  return `<!doctype html>
<html lang="${escapeHtml(lang)}"${rtl ? ' dir="rtl"' : ''}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
${meta}  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

function buildMetadataTags(metadata: HtmlMetadata | undefined): string {
  if (!metadata) return ''
  const title = cleanMetadataText(metadata.title)
  const description = cleanMetadataText(metadata.description)
  const image = cleanMetadataText(metadata.image)
  const rawCanonicalUrl = cleanMetadataText(metadata.canonicalUrl)
  const canonicalUrl =
    rawCanonicalUrl && isSafeCanonicalUrl(rawCanonicalUrl) ? rawCanonicalUrl : undefined
  const lines: string[] = []
  if (description) {
    lines.push(metaTag('name', 'description', description))
    lines.push(metaTag('property', 'og:description', description))
  }
  if (title) lines.push(metaTag('property', 'og:title', title))
  if (image) lines.push(metaTag('property', 'og:image', image))
  if (canonicalUrl) {
    lines.push(`    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`)
    lines.push(metaTag('property', 'og:url', canonicalUrl))
  }
  lines.push(...customHeadTags(metadata))
  if (lines.length === 0) return ''
  return `${lines.join('\n')}\n`
}

function metaTag(kind: 'name' | 'property', key: string, content: string): string {
  return `    <meta ${kind}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`
}

function customHeadTags(metadata: HtmlMetadata): string[] {
  const head = metadata.head
  if (!head) return []
  const lines: string[] = []
  for (const meta of head.meta ?? []) {
    const key = cleanMetadataText(meta.key)
    const content = cleanMetadataText(meta.content)
    if (!key || !content) continue
    const attr = meta.kind === 'httpEquiv' ? 'http-equiv' : meta.kind
    lines.push(`    <meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`)
  }
  for (const link of head.link ?? []) {
    const rel = cleanMetadataText(link.rel)
    const href = cleanMetadataText(link.href)
    if (!rel || !href || !isSafeHeadLinkHref(href)) continue
    const attrs = [
      ['rel', rel],
      ['href', href],
      ['as', cleanMetadataText(link.as)],
      ['type', cleanMetadataText(link.type)],
      ['media', cleanMetadataText(link.media)],
      ['crossorigin', link.crossorigin]
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    lines.push(`    <link ${attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')} />`)
  }
  for (const style of head.styles ?? []) {
    const css = style.trim()
    if (css && validateLowcodeCustomCss(css).ok) {
      lines.push(`    <style>${escapeStyleText(css)}</style>`)
    }
  }
  return lines
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

function cleanMetadataText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function isSafeHeadLinkHref(value: string): boolean {
  if (/^(?:https?|mailto|tel):/i.test(value)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  return true
}

function isSafeCanonicalUrl(value: string): boolean {
  if (/^https?:/i.test(value)) return true
  if (value.startsWith('/')) return !value.startsWith('//')
  return false
}

/** Phase 3 §9: when `i18n` is true, wrap `<App/>` in the `<I18nProvider>` the
 *  react-intl runtime (`_lowcode_i18n.tsx`) exports so `<FormattedMessage>` has
 *  an IntlProvider in scope. Phase 3 §10 v2: when `toast` is true, auto-mount
 *  `<ToastHost/>` (from `_lowcode_toast.tsx`) as a sibling of `<App/>` so the
 *  `__opToast` runtime has somewhere to render. Phase 3 §10 v3: when `confirm`
 *  is true, likewise auto-mount `<ConfirmHost/>` (from `_lowcode_confirm.tsx`)
 *  so `__opConfirm` can render its modal. Phase 5 §5: when `theme` is true,
 *  wrap the app in the generated theme provider and mount the visible theme
 *  switch inside that provider. */
export function buildMainTsx(
  i18n = false,
  toast = false,
  confirm = false,
  theme = false,
  themeSwitchPosition?: LowcodeThemeSwitchPosition | false,
  analytics = false,
  analyticsConsentBanner = false
): string {
  const i18nImport = i18n ? `import { I18nProvider } from './_lowcode_i18n'\n` : ''
  const toastImport = toast ? `import { ToastHost } from './_lowcode_toast'\n` : ''
  const confirmImport = confirm ? `import { ConfirmHost } from './_lowcode_confirm'\n` : ''
  const themeSwitchEnabled = theme && themeSwitchPosition !== false
  const themeImport = theme
    ? `import { LowcodeThemeProvider${
        themeSwitchEnabled ? ', LowcodeThemeSwitch' : ''
      } } from './_lowcode_theme'\n`
    : ''
  const analyticsImport = buildAnalyticsImport(analytics, analyticsConsentBanner)
  let app = '<App />'
  if (i18n) app = `<I18nProvider>\n      ${app}\n    </I18nProvider>`
  const themeSwitch =
    typeof themeSwitchPosition === 'string'
      ? `<LowcodeThemeSwitch position="${themeSwitchPosition}" />`
      : '<LowcodeThemeSwitch />'
  if (theme) {
    app = `<LowcodeThemeProvider>\n      ${app}${
      themeSwitchEnabled ? `\n      ${themeSwitch}` : ''
    }\n    </LowcodeThemeProvider>`
  }
  const runtimeChildren = buildMainRuntimeChildren(toast, confirm, analyticsConsentBanner)
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
${i18nImport}${toastImport}${confirmImport}${themeImport}${analyticsImport}import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    ${app}${runtimeChildren}
  </StrictMode>
)
`
}

function buildAnalyticsImport(analytics: boolean, consentBanner: boolean): string {
  if (consentBanner) {
    return `import { LowcodeAnalyticsConsentBanner } from './_lowcode_analytics'\n`
  }
  return analytics ? `import './_lowcode_analytics'\n` : ''
}

function buildMainRuntimeChildren(
  toast: boolean,
  confirm: boolean,
  analyticsConsent: boolean
): string {
  return [
    toast ? '<ToastHost />' : '',
    confirm ? '<ConfirmHost />' : '',
    analyticsConsent ? '<LowcodeAnalyticsConsentBanner />' : ''
  ]
    .filter(Boolean)
    .map((child) => `\n    ${child}`)
    .join('')
}

export function buildGitignore(): string {
  // `.env*.local` + `.env` keep per-environment Supabase overrides out of git;
  // `.env.example` (the committed template) is not matched by either pattern.
  return `node_modules
dist
.vite
*.log
.DS_Store
.env
.env.local
.env.*.local
`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}
