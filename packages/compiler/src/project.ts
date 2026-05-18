import type { CompilerOptions } from './types'

const REACT_DEP_VERSIONS = {
  '18': { react: '^18.3.1', reactDom: '^18.3.1', reactTypes: '^18.3.12', reactDomTypes: '^18.3.5' },
  '19': { react: '^19.2.0', reactDom: '^19.2.0', reactTypes: '^19.2.0', reactDomTypes: '^19.2.0' }
} as const

export function buildPackageJson(options: CompilerOptions): string {
  const v = REACT_DEP_VERSIONS[options.reactVersion]
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
    dependencies: {
      react: v.react,
      'react-dom': v.reactDom
    },
    devDependencies: {
      '@types/react': v.reactTypes,
      '@types/react-dom': v.reactDomTypes,
      '@vitejs/plugin-react': '^4.3.4',
      typescript: '~5.6.2',
      vite: '^7.0.0'
    }
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

export function buildViteConfig(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()]
})
`
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

export function buildMainTsx(): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
`
}

/**
 * Phase 0 hello-world: a single page that proves the toolchain — no scene
 * graph translation yet. Page → JSX wiring lands in week 3 (engineer B).
 */
export function buildHelloAppTsx(): string {
  return `export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>OpenPencil compiled output</h1>
      <p>Phase 0 placeholder. Scene graph translation lands in week 3.</p>
    </div>
  )
}
`
}

export function buildGitignore(): string {
  return `node_modules
dist
.vite
*.log
.DS_Store
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
