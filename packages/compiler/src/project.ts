import type { CompilerOptions } from './types'

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

export function buildViteConfig(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()]
})
`
}

export function buildIndexCss(safelistClasses: readonly string[] = []): string {
  // Tailwind v4's content auto-detection relies on Vite's module graph and a
  // filesystem glob under the project root. Our preview dev-server serves the
  // emitted project from an in-memory VFS, so the glob finds nothing on disk
  // and only base/preflight CSS is generated — utilities are missing and
  // every container collapses to 0×0 in the iframe. We already know every
  // class used (the compiler derived them from the SceneGraph), so declare
  // them via `@source inline(...)` to force Tailwind to emit those utilities
  // regardless of file discovery. Same mechanism is used by Plasmic / WeWeb
  // codegen output.
  const head = `@import "tailwindcss";\n`
  if (safelistClasses.length === 0) return head
  const joined = safelistClasses.join(' ').replace(/"/g, '\\"')
  return `${head}@source inline("${joined}");\n`
}

export function buildTsConfig(): string {
  const config = {
    compilerOptions: {
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
    },
    include: ['src']
  }
  return JSON.stringify(config, null, 2) + '\n'
}

export function buildIndexHtml(packageName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(packageName)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

/** Phase 3 §9: when `i18n` is true, wrap `<App/>` in the `<I18nProvider>` the
 *  react-intl runtime (`_lowcode_i18n.tsx`) exports so `<FormattedMessage>` has
 *  an IntlProvider in scope. Phase 3 §10 v2: when `toast` is true, auto-mount
 *  `<ToastHost/>` (from `_lowcode_toast.tsx`) as a sibling of `<App/>` so the
 *  `__opToast` runtime has somewhere to render. */
export function buildMainTsx(i18n = false, toast = false): string {
  const i18nImport = i18n ? `import { I18nProvider } from './_lowcode_i18n'\n` : ''
  const toastImport = toast ? `import { ToastHost } from './_lowcode_toast'\n` : ''
  const app = i18n ? `<I18nProvider>\n      <App />\n    </I18nProvider>` : '<App />'
  const toastChild = toast ? `\n    <ToastHost />` : ''
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
${i18nImport}${toastImport}import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    ${app}${toastChild}
  </StrictMode>
)
`
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
