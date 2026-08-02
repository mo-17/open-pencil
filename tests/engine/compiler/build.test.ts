import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildPreviewProject, type PreviewFiles } from '@open-pencil/compiler/build'

/**
 * Phase 3 §5 step 2: end-to-end smoke for the static build. Runs a real Vite
 * build against the in-memory VFS (a few hundred ms — single test, not a suite)
 * to prove a compiled `Map<path, content>` becomes a deployable static SPA:
 * an `index.html` entry plus hashed JS/CSS under `assets/`, with zero
 * `npm install` (deps resolve from the workspace's hoisted node_modules).
 *
 * The exact resolution rules are pinned cheaply in vfs.test.ts; this guards
 * the Vite-build wiring (input/plugins/outDir) that those pure functions feed.
 */
const fixture: PreviewFiles = new Map([
  [
    'index.html',
    '<!doctype html><html><head><title>t</title></head><body>' +
      '<div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
  ],
  [
    'src/main.tsx',
    "import { createRoot } from 'react-dom/client'\n" +
      "import App from './App'\n" +
      "import './index.css'\n" +
      "const el = document.getElementById('root')\n" +
      'if (el) createRoot(el).render(<App />)\n'
  ],
  [
    'src/App.tsx',
    'export default function App() {\n' +
      '  return <div className="p-4 text-red-500 bg-[url(./assets/openpencil-image-test.png)]">hi</div>\n' +
      '}\n'
  ],
  [
    'src/index.css',
    '@import "tailwindcss";\n' +
      '@source inline("p-4 text-red-500 bg-[url(./assets/openpencil-image-test.png)]");\n' +
      '@font-face{font-family:"Test";src:url("./assets/fonts/test.woff2") format("woff2");font-weight:400}\n'
  ],
  [
    'src/assets/openpencil-image-test.png',
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ],
  ['src/assets/fonts/test.woff2', new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3])]
])

const outDir = mkdtempSync(join(tmpdir(), 'op-build-'))

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('buildPreviewProject (Phase 3 §5)', () => {
  test('compiles a VFS project into a static dist (index.html + hashed assets)', async () => {
    const result = await buildPreviewProject({ files: fixture, outDir })

    expect(result.outDir).toBe(outDir)
    expect(result.files).toContain('index.html')

    const js = result.files.filter((f) => f.startsWith('assets/') && f.endsWith('.js'))
    const css = result.files.filter((f) => f.startsWith('assets/') && f.endsWith('.css'))
    expect(js.length).toBeGreaterThan(0)
    expect(css.length).toBeGreaterThan(0)
    expect(result.files).toContain('assets/openpencil-image-test.png')
    expect(result.files).toContain('assets/fonts/test.woff2')
    expect(readFileSync(join(outDir, css[0]), 'utf8')).toContain('url(./openpencil-image-test.png)')
    expect(readFileSync(join(outDir, css[0]), 'utf8')).toContain('url(./fonts/test.woff2)')
    expect(readFileSync(join(outDir, 'assets/openpencil-image-test.png'))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    expect(readFileSync(join(outDir, 'assets/fonts/test.woff2'))).toEqual(
      Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3])
    )
    // Hashed filenames so the bundle is CDN cacheable.
    expect(js[0]).toMatch(/assets\/index-[\w-]+\.js$/)
  }, 30_000)

  test('env override is baked via Vite define; absent → import.meta.env fallback survives (§5)', async () => {
    const envFixture: PreviewFiles = new Map([
      [
        'index.html',
        '<!doctype html><html><head><title>t</title></head><body>' +
          '<div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
      ],
      [
        'src/main.tsx',
        "import { createRoot } from 'react-dom/client'\n" +
          "import App from './App'\n" +
          "const el = document.getElementById('root')\n" +
          'if (el) createRoot(el).render(<App />)\n'
      ],
      [
        'src/App.tsx',
        'export default function App() {\n' +
          '  const u = import.meta.env.VITE_SUPABASE_URL ?? "FALLBACK_DESIGN_URL"\n' +
          '  return <div>{u}</div>\n' +
          '}\n'
      ]
    ])

    const readBundle = (dir: string): string => {
      const js = readdirSync(join(dir, 'assets')).find((f) => f.endsWith('.js'))
      return js ? readFileSync(join(dir, 'assets', js), 'utf8') : ''
    }

    const withOverride = mkdtempSync(join(tmpdir(), 'op-build-env-'))
    const noOverride = mkdtempSync(join(tmpdir(), 'op-build-noenv-'))
    try {
      await buildPreviewProject({
        files: envFixture,
        outDir: withOverride,
        env: { VITE_SUPABASE_URL: 'https://prod.override.co' }
      })
      const overridden = readBundle(withOverride)
      expect(overridden).toContain('https://prod.override.co')
      expect(overridden).not.toContain('FALLBACK_DESIGN_URL')

      await buildPreviewProject({ files: envFixture, outDir: noOverride })
      expect(readBundle(noOverride)).toContain('FALLBACK_DESIGN_URL')
    } finally {
      rmSync(withOverride, { recursive: true, force: true })
      rmSync(noOverride, { recursive: true, force: true })
    }
  }, 30_000)
})
