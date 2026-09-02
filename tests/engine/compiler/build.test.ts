import { afterAll, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import {
  buildPreviewProject,
  createSupabaseBuildDefines,
  assertSafeBuildOutputDirectory,
  assertSafeClientBuildEnvironment,
  OPENPENCIL_BUILD_OUTPUT_MANIFEST,
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

const vueFixture: PreviewFiles = new Map([
  [
    'index.html',
    '<!doctype html><html><body><div id="app"></div>' +
      '<script type="module" src="/src/main.ts"></script></body></html>'
  ],
  [
    'src/main.ts',
    "import { createApp } from 'vue'\n" +
      "import App from './App.vue'\n" +
      "import './index.css'\n" +
      "createApp(App).mount('#app')\n"
  ],
  [
    'src/App.vue',
    '<script setup lang="ts">\n' +
      "import imageUrl from './assets/vue-vfs.png'\n" +
      "const message: string = 'Vue VFS build'\n" +
      '</script>\n' +
      '<template><main class="p-4"><p>{{ message }}</p><img :src="imageUrl" /></main></template>\n'
  ],
  ['src/index.css', '@import "tailwindcss";\n@source inline("p-4");\n'],
  ['src/assets/vue-vfs.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])]
])

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

describe('buildPreviewProject (Phase 3 §5)', () => {
  test('refuses to empty unowned output directories or managed directories with extra files', () => {
    const unowned = mkdtempSync(join(tmpdir(), 'op-build-unowned-'))
    const managed = mkdtempSync(join(tmpdir(), 'op-build-managed-'))
    try {
      writeFileSync(join(unowned, 'DO-NOT-DELETE.txt'), 'user data')
      expect(() => assertSafeBuildOutputDirectory(unowned)).toThrow(
        'Refusing to empty non-OpenPencil build directory'
      )

      writeFileSync(join(managed, 'index.html'), '<!doctype html>')
      writeFileSync(
        join(managed, OPENPENCIL_BUILD_OUTPUT_MANIFEST),
        JSON.stringify({ version: 1, files: ['index.html'] })
      )
      expect(() => assertSafeBuildOutputDirectory(managed)).not.toThrow()
      writeFileSync(join(managed, 'DO-NOT-DELETE.txt'), 'user data')
      expect(() => assertSafeBuildOutputDirectory(managed)).toThrow('files not owned')
    } finally {
      rmSync(unowned, { recursive: true, force: true })
      rmSync(managed, { recursive: true, force: true })
    }
  })

  test('rejects output and marker symlinks or malformed ownership markers', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'op-build-symlink-'))
    const realOutput = join(sandbox, 'real-output')
    const outputLink = join(sandbox, 'output-link')
    const markerLinkOutput = join(sandbox, 'marker-link-output')
    const externalMarker = join(sandbox, 'external-marker.json')
    const malformedOutput = join(sandbox, 'malformed-output')
    try {
      mkdirSync(realOutput)
      symlinkSync(realOutput, outputLink, 'dir')
      expect(() => assertSafeBuildOutputDirectory(outputLink)).toThrow(
        'Build output must be a real directory'
      )

      mkdirSync(markerLinkOutput)
      writeFileSync(externalMarker, JSON.stringify({ version: 1, files: [] }))
      symlinkSync(externalMarker, join(markerLinkOutput, OPENPENCIL_BUILD_OUTPUT_MANIFEST))
      expect(() => assertSafeBuildOutputDirectory(markerLinkOutput)).toThrow(
        'Refusing untrusted OpenPencil build marker'
      )

      mkdirSync(malformedOutput)
      writeFileSync(
        join(malformedOutput, OPENPENCIL_BUILD_OUTPUT_MANIFEST),
        JSON.stringify({ version: 2, files: [] })
      )
      expect(() => assertSafeBuildOutputDirectory(malformedOutput)).toThrow(
        'Refusing invalid OpenPencil build marker'
      )
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test('pins all Supabase Vite defines instead of inheriting ambient build values', () => {
    expect(createSupabaseBuildDefines(undefined)).toEqual({
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_SCHEMA': 'undefined'
    })
    expect(
      createSupabaseBuildDefines({
        VITE_SUPABASE_URL: 'https://explicit.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_explicit',
        VITE_SUPABASE_SCHEMA: 'app'
      })
    ).toEqual({
      'import.meta.env.VITE_SUPABASE_URL': '"https://explicit.supabase.co"',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"sb_publishable_explicit"',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.VITE_SUPABASE_SCHEMA': '"app"'
    })
  })

  test('compiles a VFS project into a static dist (index.html + hashed assets)', async () => {
    const result = await buildPreviewProject({ files: fixture, outDir })

    expect(result.outDir).toBe(outDir)
    expect(result.files).toContain('index.html')
    expect(result.files).not.toContain(OPENPENCIL_BUILD_OUTPUT_MANIFEST)

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

    const repeated = await buildPreviewProject({ files: fixture, outDir })
    expect(repeated.files).toContain('index.html')
    expect(readFileSync(join(outDir, OPENPENCIL_BUILD_OUTPUT_MANIFEST), 'utf8')).toContain(
      '"version": 1'
    )
  }, 30_000)

  test('builds through a symlinked workspace root without a root-escaping HTML name', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'op-build-workspace-alias-'))
    const workspaceAlias = join(sandbox, 'workspace')
    const linkedOutDir = join(sandbox, 'dist')
    try {
      symlinkSync(process.cwd(), workspaceAlias, process.platform === 'win32' ? 'junction' : 'dir')
      const result = await buildPreviewProject({
        files: fixture,
        outDir: linkedOutDir,
        fsRoot: workspaceAlias
      })

      expect(result.files).toContain('index.html')
      expect(readFileSync(join(linkedOutDir, 'index.html'), 'utf8')).toContain('<div id="root">')
    } finally {
      rmSync(sandbox, { force: true, recursive: true })
    }
  }, 30_000)

  test('selects plugin-vue and preserves imported binary assets for a Vue VFS build', async () => {
    const vueOutDir = mkdtempSync(join(tmpdir(), 'op-build-vue-'))
    try {
      const result = await buildPreviewProject({
        files: vueFixture,
        outDir: vueOutDir,
        base: '/nested/',
        target: 'vue'
      })
      expect(result.files).toContain('index.html')
      expect(result.files).toContain('assets/vue-vfs.png')
      const javascript = result.files.find(
        (path) => path.startsWith('assets/') && path.endsWith('.js')
      )
      expect(javascript).toBeDefined()
      const bundle = javascript ? readFileSync(join(vueOutDir, javascript), 'utf8') : ''
      expect(bundle).toContain('Vue VFS build')
      expect(bundle).toContain('/nested/assets/vue-vfs.png')
      expect(readFileSync(join(vueOutDir, 'assets/vue-vfs.png'))).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
      )
    } finally {
      rmSync(vueOutDir, { recursive: true, force: true })
    }
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
          '  const k = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "FALLBACK_DESIGN_KEY"\n' +
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
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_override',
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
        publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        legacyAnonKey: process.env.VITE_SUPABASE_ANON_KEY,
        schema: process.env.VITE_SUPABASE_SCHEMA
      }
      process.env.VITE_SUPABASE_URL = 'https://ambient-must-not-leak.supabase.co'
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ambient_must_not_leak'
      process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_ambient_must_not_leak'
      process.env.VITE_SUPABASE_SCHEMA = 'ambient_must_not_leak'
      try {
        await buildPreviewProject({ files: envFixture, outDir: noOverride })
      } finally {
        if (ambient.url === undefined) delete process.env.VITE_SUPABASE_URL
        else process.env.VITE_SUPABASE_URL = ambient.url
        if (ambient.publishableKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY
        else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = ambient.publishableKey
        if (ambient.legacyAnonKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY
        else process.env.VITE_SUPABASE_ANON_KEY = ambient.legacyAnonKey
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
        env: { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_embed' }
      })
    ).rejects.toThrow('secret/service_role')
  })

  test('rejects a Supabase Management API PAT before it can enter the client bundle', () => {
    expect(() =>
      assertSafeClientBuildEnvironment({
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sbp_do_not_embed'
      })
    ).toThrow('secret/service_role/management')
  })

  test('rejects conflicting publishable and legacy anon build aliases', () => {
    expect(() =>
      assertSafeClientBuildEnvironment({
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_new',
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_stale'
      })
    ).toThrow('Conflicting Supabase')
  })
})
