import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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
      '  return <div className="p-4 text-red-500">hi</div>\n' +
      '}\n'
  ],
  ['src/index.css', '@import "tailwindcss";\n@source inline("p-4 text-red-500");\n']
])

const outDir = mkdtempSync(join(tmpdir(), 'op-build-'))

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('buildPreviewProject (Phase 3 §5)', () => {
  test(
    'compiles a VFS project into a static dist (index.html + hashed assets)',
    async () => {
      const result = await buildPreviewProject({ files: fixture, outDir })

      expect(result.outDir).toBe(outDir)
      expect(result.files).toContain('index.html')

      const js = result.files.filter((f) => f.startsWith('assets/') && f.endsWith('.js'))
      const css = result.files.filter((f) => f.startsWith('assets/') && f.endsWith('.css'))
      expect(js.length).toBeGreaterThan(0)
      expect(css.length).toBeGreaterThan(0)
      // Hashed filenames so the bundle is CDN cacheable.
      expect(js[0]).toMatch(/assets\/index-[\w-]+\.js$/)
    },
    30_000
  )
})
