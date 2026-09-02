import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  buildCapacitorReactProjectFiles,
  CAPACITOR_VERSION
} from '@open-pencil/compiler/adapters/react/capacitor-project'
import {
  buildElectronReactProjectFiles,
  ELECTRON_VERSION
} from '@open-pencil/compiler/adapters/react/electron-project'
import {
  buildNextJsReactProjectFiles,
  NEXT_JS_VERSION
} from '@open-pencil/compiler/adapters/react/next-project'
import { SceneGraph } from '@open-pencil/scene-graph'

interface GeneratedPackageJSON {
  name: string
  main?: string
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  customMetadata: { preserved: boolean }
}

type ElectronNavigationGuard = (value: string, entryURL: URL) => boolean

interface ElectronNavigationModule {
  exports: {
    isLocalEntryNavigation?: ElectronNavigationGuard
  }
}

function fixture(): Map<string, string | Uint8Array> {
  return new Map<string, string | Uint8Array>([
    [
      'package.json',
      `${JSON.stringify({
        name: 'compiled-app',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', inspect: 'keep' },
        dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0', 'react-router-dom': '^6.27.0' },
        devDependencies: {
          '@tailwindcss/vite': '^4.2.1',
          '@vitejs/plugin-react': '^4.3.4',
          tailwindcss: '^4.2.1',
          typescript: '~5.6.2',
          vite: '^7.0.0'
        },
        customMetadata: { preserved: true }
      })}\n`
    ],
    [
      'src/App.tsx',
      `import { BrowserRouter, Route, Routes } from 'react-router-dom'\n\nexport default function App() {\n  return <BrowserRouter><Routes><Route path="/" element={<main>Demo</main>} /></Routes></BrowserRouter>\n}\n`
    ],
    [
      'src/main.tsx',
      `import { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './__motion.css'\nimport './index.css'\n\nconst root = document.getElementById('root')\nif (root) createRoot(root).render(<App />)\n`
    ],
    ['src/index.css', '@import "tailwindcss";\n'],
    ['src/__motion.css', '.motion { opacity: 1; }\n'],
    ['src/vite-env.d.ts', '/// <reference types="vite/client" />\n'],
    [
      'src/_lowcode_supabase.ts',
      'const url = import.meta.env.VITE_SUPABASE_URL\nconst key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY\n'
    ],
    ['.env.example', 'VITE_SUPABASE_URL=https://example.test\nVITE_SUPABASE_PUBLISHABLE_KEY=key\n'],
    ['index.html', '<div id="root"></div>\n'],
    [
      'vite.config.ts',
      "import { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: []\n})\n"
    ],
    ['tsconfig.json', '{}\n'],
    ['.gitignore', 'node_modules\ndist\n'],
    ['public/original.bin', new Uint8Array([1, 2, 3])]
  ])
}

function packageJSON(files: ReadonlyMap<string, string | Uint8Array>): GeneratedPackageJSON {
  return JSON.parse(String(files.get('package.json'))) as GeneratedPackageJSON
}

function expectPortablePaths(files: ReadonlyMap<string, string | Uint8Array>): void {
  for (const path of files.keys()) {
    expect(path).not.toStartWith('/')
    expect(path).not.toContain('\\')
    expect(path.split('/')).not.toContain('..')
  }
}

describe('React source project builders', () => {
  test('consumes actual multi-page React compiler output without running a build tool', () => {
    const graph = new SceneGraph()
    const firstPage = graph.getPages()[0]
    graph.createNode('TEXT', firstPage.id, { text: 'First page' })
    const secondPage = graph.createNode('CANVAS', graph.rootId, { name: 'Second' })
    graph.createNode('TEXT', secondPage.id, { text: 'Second page' })
    const compiled = compile({
      graph,
      pageIds: graph.getPages().map(({ id }) => id),
      options: withDefaults({
        packageName: 'real-react-output',
        target: 'react',
        router: 'react-router-v6',
        devMode: false
      })
    })

    expect(compiled.files.size).toBeGreaterThan(0)
    expect(String(compiled.files.get('src/App.tsx'))).toContain('BrowserRouter')
    expect(buildNextJsReactProjectFiles(compiled.files, 'Demo').has('next.config.mjs')).toBe(true)
    expect(
      String(
        buildCapacitorReactProjectFiles(compiled.files, 'real-react-output', 'Demo').get(
          'src/App.tsx'
        )
      )
    ).toContain('HashRouter')
    expect(
      String(buildElectronReactProjectFiles(compiled.files, 'Demo').get('src/App.tsx'))
    ).toContain('HashRouter')
    expect(String(compiled.files.get('src/App.tsx'))).toContain('BrowserRouter')
  })

  test('adapts React compiler output to a client-only Next.js App Router project', () => {
    const compiled = fixture()
    const originalPackageJSON = compiled.get('package.json')
    const files = buildNextJsReactProjectFiles(compiled, 'Product Demo')
    const generated = packageJSON(files)

    expect(compiled.get('package.json')).toBe(originalPackageJSON)
    expect(compiled.has('app/layout.tsx')).toBe(false)
    expect(generated).toMatchObject({
      name: 'compiled-app',
      scripts: { dev: 'next dev', build: 'next build', start: 'next start', inspect: 'keep' },
      dependencies: { next: NEXT_JS_VERSION, react: '^19.2.0', 'react-dom': '^19.2.0' },
      devDependencies: { '@tailwindcss/postcss': '^4.2.1', postcss: '^8.5.6' },
      customMetadata: { preserved: true }
    })
    expect(generated.scripts.preview).toBeUndefined()
    expect(generated.devDependencies.vite).toBeUndefined()
    expect(generated.devDependencies['@vitejs/plugin-react']).toBeUndefined()
    expect(files.has('index.html')).toBe(false)
    expect(files.has('vite.config.ts')).toBe(false)
    expect(String(files.get('src/main.tsx'))).not.toContain("import './index.css'")
    expect(String(files.get('app/layout.tsx'))).toContain("import '../src/index.css'")
    expect(String(files.get('app/layout.tsx'))).toContain("import '../src/__motion.css'")
    expect(String(files.get('app/OpenPencilClient.tsx'))).toContain("import('../src/main')")
    expect(String(files.get('src/_lowcode_supabase.ts'))).toContain(
      'process.env.NEXT_PUBLIC_SUPABASE_URL'
    )
    expect(String(files.get('.env.example'))).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    expect(files.has('app/[[...path]]/page.tsx')).toBe(true)
    expect(String(files.get('README.md'))).toContain('does not claim server-component or SSR')
    expect(files.get('public/original.bin')).toEqual(new Uint8Array([1, 2, 3]))
    expectPortablePaths(files)
  })

  test('adds a source-only Capacitor scaffold and file-origin-safe routing', () => {
    const files = buildCapacitorReactProjectFiles(fixture(), '7-demo-app', 'Mobile Demo')
    const generated = packageJSON(files)

    expect(generated.dependencies).toMatchObject({
      '@capacitor/android': CAPACITOR_VERSION,
      '@capacitor/core': CAPACITOR_VERSION,
      '@capacitor/ios': CAPACITOR_VERSION
    })
    expect(generated.devDependencies['@capacitor/cli']).toBe(CAPACITOR_VERSION)
    expect(generated.scripts['cap:sync']).toBe('npx cap sync')
    expect(String(files.get('capacitor.config.ts'))).toContain(
      'appId: "dev.openpencil.app7.demo.app"'
    )
    expect(String(files.get('src/App.tsx'))).toContain('HashRouter')
    expect(String(files.get('src/App.tsx'))).not.toContain('BrowserRouter')
    expect(String(files.get('vite.config.ts'))).toContain("base: './'")
    expect([...files.keys()].some((path) => path.startsWith('android/'))).toBe(false)
    expect([...files.keys()].some((path) => path.startsWith('ios/'))).toBe(false)
    expect(String(files.get('README.md'))).toContain('did not install dependencies')
    expectPortablePaths(files)
  })

  test('adds a sandboxed Electron main process without native binaries', () => {
    const files = buildElectronReactProjectFiles(fixture(), 'Desktop Demo')
    const generated = packageJSON(files)
    const main = String(files.get('electron/main.cjs'))
    const navigation = String(files.get('electron/navigation.cjs'))

    expect(generated.main).toBe('electron/main.cjs')
    expect(generated.devDependencies.electron).toBe(ELECTRON_VERSION)
    expect(generated.scripts['electron:dev']).toBe('npm run build && electron .')
    expect(String(files.get('src/App.tsx'))).toContain('HashRouter')
    expect(String(files.get('vite.config.ts'))).toContain("base: './'")
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('sandbox: true')
    expect(main).toContain("return { action: 'deny' }")
    expect(main).toContain("require('./navigation.cjs')")
    expect(navigation).toContain("url.host !== ''")

    const navigationModule: ElectronNavigationModule = { exports: {} }
    runInNewContext(navigation, {
      URL,
      module: navigationModule,
      exports: navigationModule.exports
    })
    const { isLocalEntryNavigation } = navigationModule.exports
    expect(isLocalEntryNavigation).toBeFunction()
    if (!isLocalEntryNavigation) throw new TypeError('Generated navigation guard was not exported')
    const entryURL = new URL('file:///Applications/OpenPencil/dist/index.html')
    expect(isLocalEntryNavigation(`${entryURL.href}#/page`, entryURL)).toBe(true)
    expect(
      isLocalEntryNavigation('file://evil-host/Applications/OpenPencil/dist/index.html', entryURL)
    ).toBe(false)
    expect(isLocalEntryNavigation('https://example.com/', entryURL)).toBe(false)
    expect(
      [...files.values()].some((value) => value instanceof Uint8Array && value.length > 3)
    ).toBe(false)
    expect(String(files.get('README.md'))).toContain('did not install dependencies')
    expectPortablePaths(files)
  })

  test('fails closed on malformed compiler package metadata', () => {
    expect(() => buildNextJsReactProjectFiles(new Map([['package.json', '[]\n']]), 'Demo')).toThrow(
      'package.json must be an object'
    )
    expect(() =>
      buildCapacitorReactProjectFiles(
        new Map([['package.json', '{"scripts":{"__proto__":"blocked"}}\n']]),
        'demo',
        'Demo'
      )
    ).toThrow('unsafe key')
    expect(() =>
      buildElectronReactProjectFiles(
        new Map([['package.json', new Uint8Array([123, 125])]]),
        'Demo'
      )
    ).toThrow('missing a text package.json')
  })
})
