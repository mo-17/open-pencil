import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import {
  buildPreviewProject,
  createSupabaseBuildDefines,
  type PreviewFiles
} from '@open-pencil/compiler/build'

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
  test('pins all Supabase Vite defines instead of inheriting ambient build values', () => {
    expect(createSupabaseBuildDefines(undefined)).toEqual({
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_SCHEMA': 'undefined'
    })
    expect(
      createSupabaseBuildDefines({
        VITE_SUPABASE_URL: 'https://explicit.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_explicit',
        VITE_SUPABASE_SCHEMA: 'app'
      })
    ).toEqual({
      'import.meta.env.VITE_SUPABASE_URL': '"https://explicit.supabase.co"',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '"sb_publishable_explicit"',
      'import.meta.env.VITE_SUPABASE_SCHEMA': '"app"'
    })
  })

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

  test('delivers server artifacts separately and excludes them from static deploy files', async () => {
    const serverFixture: PreviewFiles = new Map(fixture)
    serverFixture.set(
      'supabase/functions/openpencil-runtime/index.ts',
      'Deno.serve(() => new Response("ok"))\n'
    )
    serverFixture.set('.env.server.example', 'PAYMENTS_API_KEY=\n')
    serverFixture.set('openpencil-server.manifest.json', '{"version":1}\n')
    serverFixture.set('SERVER_DEPLOYMENT.md', '# Deploy server workflows\n')

    const serverOutDir = mkdtempSync(join(tmpdir(), 'op-build-server-'))
    try {
      const result = await buildPreviewProject({ files: serverFixture, outDir: serverOutDir })
      expect(result.serverFiles).toEqual([
        'openpencil-server/.env.server.example',
        'openpencil-server/SERVER_DEPLOYMENT.md',
        'openpencil-server/openpencil-server.manifest.json',
        'openpencil-server/supabase/functions/openpencil-runtime/index.ts'
      ])
      expect(result.files).toEqual(expect.arrayContaining(result.serverFiles))
      expect(result.staticFiles.every((path) => !path.startsWith('openpencil-server/'))).toBe(true)
      expect(result.staticFiles).toContain('index.html')
      expect(
        result.staticFiles.some((path) =>
          readFileSync(join(serverOutDir, path)).includes('Deno.serve')
        )
      ).toBe(false)
      expect(
        readFileSync(
          join(serverOutDir, 'openpencil-server/supabase/functions/openpencil-runtime/index.ts'),
          'utf8'
        )
      ).toBe('Deno.serve(() => new Response("ok"))\n')
      expect(
        readFileSync(join(serverOutDir, 'openpencil-server/.env.server.example'), 'utf8')
      ).toBe('PAYMENTS_API_KEY=\n')
    } finally {
      rmSync(serverOutDir, { recursive: true, force: true })
    }
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
          '  const k = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "FALLBACK_DESIGN_KEY"\n' +
          '  const s = import.meta.env.VITE_SUPABASE_SCHEMA ?? "FALLBACK_DESIGN_SCHEMA"\n' +
          '  return <div>{u}:{k}:{s}</div>\n' +
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
        env: {
          VITE_SUPABASE_URL: 'https://prod.override.co',
          VITE_SUPABASE_ANON_KEY: 'sb_publishable_override',
          VITE_SUPABASE_SCHEMA: 'private'
        }
      })
      const overridden = readBundle(withOverride)
      expect(overridden).toContain('https://prod.override.co')
      expect(overridden).toContain('sb_publishable_override')
      expect(overridden).toContain('private')
      expect(overridden).not.toContain('FALLBACK_DESIGN_URL')
      expect(overridden).not.toContain('FALLBACK_DESIGN_KEY')
      expect(overridden).not.toContain('FALLBACK_DESIGN_SCHEMA')

      const ambient = {
        url: process.env.VITE_SUPABASE_URL,
        key: process.env.VITE_SUPABASE_ANON_KEY,
        schema: process.env.VITE_SUPABASE_SCHEMA
      }
      process.env.VITE_SUPABASE_URL = 'https://ambient-must-not-leak.supabase.co'
      process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_ambient_must_not_leak'
      process.env.VITE_SUPABASE_SCHEMA = 'ambient_must_not_leak'
      try {
        await buildPreviewProject({ files: envFixture, outDir: noOverride })
      } finally {
        if (ambient.url === undefined) delete process.env.VITE_SUPABASE_URL
        else process.env.VITE_SUPABASE_URL = ambient.url
        if (ambient.key === undefined) delete process.env.VITE_SUPABASE_ANON_KEY
        else process.env.VITE_SUPABASE_ANON_KEY = ambient.key
        if (ambient.schema === undefined) delete process.env.VITE_SUPABASE_SCHEMA
        else process.env.VITE_SUPABASE_SCHEMA = ambient.schema
      }
      const fallback = readBundle(noOverride)
      expect(fallback).toContain('FALLBACK_DESIGN_URL')
      expect(fallback).toContain('FALLBACK_DESIGN_KEY')
      expect(fallback).toContain('FALLBACK_DESIGN_SCHEMA')
      expect(fallback).not.toContain('ambient-must-not-leak')
      expect(fallback).not.toContain('ambient_must_not_leak')
    } finally {
      rmSync(withOverride, { recursive: true, force: true })
      rmSync(noOverride, { recursive: true, force: true })
    }
  }, 30_000)

  test('rejects a secret Supabase override before it can enter the client bundle', async () => {
    expect(
      buildPreviewProject({
        files: fixture,
        outDir,
        env: { VITE_SUPABASE_ANON_KEY: 'sb_secret_do_not_embed' }
      })
    ).rejects.toThrow('secret/service_role')
  })
})
