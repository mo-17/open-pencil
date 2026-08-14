/* eslint-disable max-lines -- The sidecar security matrix stays in one end-to-end runtime fixture. */
import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'

import { compile, withDefaults } from '@open-pencil/compiler'
import { serializeCodePenSidecarRequest } from '@open-pencil/compiler/codepen/sidecar-wire'
import { SceneGraph } from '@open-pencil/scene-graph'

import { handleCodePenSidecarInput } from '../src/index'
import { parseCodePenSidecarRequest } from '../src/protocol'
import { createCodePenSidecarShowcase, CodePenSidecarRuntimeError } from '../src/runtime'

function packageName(files: Map<string, string | Uint8Array>): string {
  const source = files.get('package.json')
  if (typeof source !== 'string') throw new Error('Fixture package.json missing')
  return JSON.parse(source).name as string
}

function parsedRequest(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue',
  requestId = `${target}-runtime`
) {
  return parseCodePenSidecarRequest(
    serializeCodePenSidecarRequest({
      requestId,
      target,
      packageName: packageName(files),
      files,
      options: { title: `${target} sidecar` }
    })
  )
}

function generatedProject(target: 'react' | 'vue', uiKit?: 'shadcn') {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.createNode('TEXT', pageId, {
    name: 'Sidecar title',
    text: `Rendered sidecar ${target}`,
    width: 320,
    height: 48
  })
  if (uiKit) {
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Save', textColor: '#ffffff' }
    })
  }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      devMode: false,
      packageName: `sidecar-${target}${uiKit ? '-shadcn' : ''}`,
      ...(uiKit ? { uiKit } : {})
    })
  }).files
}

function generatedAssetProject() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const imageBytes = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
  )
  const fontBytes = new Uint8Array([
    0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x6e, 0x61, 0x6d, 0x65, 0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0, 4,
    0, 0, 0, 0
  ])
  graph.images.set('sidecar-image', imageBytes)
  graph.createNode('RECTANGLE', pageId, {
    name: 'PhotoFill',
    width: 160,
    height: 120,
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'sidecar-image',
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
  graph.createNode('TEXT', pageId, {
    text: 'Asset text',
    fontFamily: 'Sidecar Font',
    fontWeight: 400,
    width: 160,
    height: 40
  })
  return compile({
    graph,
    pageIds: [pageId],
    fontManifest: {
      faces: [
        {
          family: 'Sidecar Font',
          weight: 400,
          style: 'normal',
          format: 'truetype',
          path: 'src/assets/fonts/sidecar-font-400-normal.ttf',
          content: fontBytes
        }
      ]
    },
    options: withDefaults({ target: 'react', devMode: false, packageName: 'sidecar-assets' })
  }).files
}

describe('CodePen sidecar pure runtime', () => {
  for (const target of ['react', 'vue'] as const) {
    test(`collapses a real generated ${target} VFS without Vite native addons`, async () => {
      const result = await createCodePenSidecarShowcase(
        parsedRequest(generatedProject(target), target)
      )
      expect(result.compatible).toBe(true)
      expect(result.data.html).toContain(target === 'vue' ? 'id="app"' : 'id="root"')
      expect(result.data.html).toContain('type="importmap"')
      expect(result.data.css).toContain('box-sizing')
      expect(result.data.js.length).toBeGreaterThan(100)
      expect(result.diagnostics.some((item) => item.code.includes('pinned-external'))).toBe(true)
    }, 30_000)
  }

  test('pins one React peer graph for every external URL', async () => {
    const files = generatedProject('react')
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    const match = result.data.html.match(/<script type="importmap">(.*?)<\/script>/s)
    const importMap = JSON.parse(match?.[1] ?? '{}') as { imports?: Record<string, string> }
    const urls = Object.entries(importMap.imports ?? {})
    expect(urls.some(([name]) => name === 'react')).toBe(true)
    for (const [name, url] of urls) {
      if (name === 'react' || name.startsWith('react/')) continue
      expect(decodeURIComponent(url)).toContain('react@19.2.0')
    }
  }, 30_000)

  test('resolves the generated shadcn @/ alias through the bounded VFS', async () => {
    const files = generatedProject('react', 'shadcn')
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    expect(result.data.js).toContain('Save')
    expect(result.diagnostics.some((item) => item.path === '@radix-ui/react-slot')).toBe(true)
    expect(result.data.css).toContain('.bg-primary')
    expect(result.data.css).toContain('.inline-flex')
    expect(result.data.css).toContain('.px-4')
    expect(result.data.css).toContain('.py-2')
  }, 30_000)

  test('inlines real generated image and font VFS assets into CSS data URLs', async () => {
    const result = await createCodePenSidecarShowcase(
      parsedRequest(generatedAssetProject(), 'react', 'generated-assets')
    )
    expect(result.data.css).toContain('data:image/png;base64,')
    expect(result.data.css).toContain('data:font/ttf;base64,')
    expect(result.data.css).not.toMatch(/url\(["']?\.\.?\//)
  }, 30_000)

  test('preserves Vue SFC style paths while inlining relative assets', async () => {
    const files = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-vue-style","dependencies":{"vue":"^3.5.29"}}'],
      [
        'src/main.ts',
        "import { createApp } from 'vue'\nimport App from './views/App.vue'\ncreateApp(App).mount('#app')"
      ],
      [
        'src/views/App.vue',
        '<template><main class="hero">Vue</main></template><style>.hero{background:url("../assets/hero.png")}</style>'
      ],
      [
        'src/assets/hero.png',
        new Uint8Array(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
          )
        )
      ]
    ])
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'vue'))
    expect(result.data.css).toContain('data:image/png;base64,')
    expect(result.data.css).not.toContain('../assets/hero.png')
  })

  test('extracts bounded Vue template utilities and diagnoses dynamic class expressions', async () => {
    const files = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-vue-utilities","dependencies":{"vue":"^3.5.29"}}'],
      [
        'src/main.ts',
        "import { createApp } from 'vue'\nimport App from './App.vue'\nimport './index.css'\ncreateApp(App).mount('#app')"
      ],
      [
        'src/App.vue',
        '<script setup lang="ts">const active = true</script><template><main class="rounded bg-blue-500 px-4" :class="active ? \'py-2\' : \'py-4\'">Vue</main></template>'
      ],
      ['src/index.css', '@import "tailwindcss";']
    ])
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'vue'))
    expect(result.data.css).toContain('.rounded')
    expect(result.data.css).toContain('.bg-blue-500')
    expect(result.data.css).toContain('.px-4')
    expect(result.data.css).toContain('.py-2')
    expect(
      result.diagnostics.some((item) => item.code === 'codepen-dynamic-tailwind-candidates-omitted')
    ).toBe(true)
  })

  test('defines Vue router BASE_URL for a real multi-page VFS', async () => {
    const graph = new SceneGraph()
    const first = graph.getPages()[0]
    const second = graph.addPage('Settings')
    graph.createNode('TEXT', first.id, { text: 'Home', width: 100, height: 30 })
    graph.createNode('TEXT', second.id, { text: 'Settings', width: 100, height: 30 })
    const files = compile({
      graph,
      pageIds: [first.id, second.id],
      options: withDefaults({ target: 'vue', devMode: false, packageName: 'sidecar-vue-router' })
    }).files
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'vue'))
    expect(result.data.js).not.toContain('import.meta.env')
    expect(result.data.html).toContain('vue-router@4.6.4')
    expect(decodeURIComponent(result.data.html)).toContain('vue@3.5.29')
  }, 30_000)

  test('pins Supabase env defines without reading the sidecar environment', async () => {
    const files = new Map<string, string | Uint8Array>([
      [
        'package.json',
        JSON.stringify({
          name: 'sidecar-supabase',
          dependencies: { '@supabase/supabase-js': '^2.100.0' }
        })
      ],
      [
        'src/main.tsx',
        `import { createClient } from '@supabase/supabase-js'
const client = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'https://example.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'public-anon',
  { db: { schema: import.meta.env.VITE_SUPABASE_SCHEMA ?? 'public' } }
)
document.body.dataset.client = typeof client
`
      ]
    ])
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    expect(result.data.js).not.toContain('import.meta.env')
    expect(result.data.html).toContain('@supabase/supabase-js@2.100.0')
  }, 30_000)

  test('replaces the exact MapLibre stylesheet with a pinned link', async () => {
    const files = new Map<string, string | Uint8Array>([
      [
        'package.json',
        JSON.stringify({
          name: 'sidecar-map',
          dependencies: { 'maplibre-gl': '6.0.0', react: '^19.2.0', 'react-dom': '^19.2.0' }
        })
      ],
      [
        'src/main.tsx',
        `import 'maplibre-gl/dist/maplibre-gl.css'\ndocument.body.dataset.map = 'ready'`
      ],
      ['src/index.css', '@import "tailwindcss";']
    ])
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    expect(result.data.html).toContain(
      'cdn.jsdelivr.net/npm/maplibre-gl@6.0.0/dist/maplibre-gl.css'
    )
    expect(result.data.js).not.toContain('maplibre-gl.css')
  })

  test('fails closed for unknown packages and unknown external CSS without echoing source', async () => {
    for (const [source, expectedCode] of [
      [`import 'unapproved-package'`, 'unsupported-dependency'],
      [`import 'unapproved/styles.css'`, 'unsupported-stylesheet']
    ] as const) {
      const marker = 'UNTRUSTED_IMPORT_MARKER'
      const files = new Map<string, string | Uint8Array>([
        [
          'package.json',
          JSON.stringify({ name: 'sidecar-unknown', dependencies: { unapproved: '1.0.0' } })
        ],
        ['src/main.tsx', `${source}\nconst hidden = '${marker}'`]
      ])
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: 'unknown-dependency',
          target: 'react',
          packageName: 'sidecar-unknown',
          files
        })
      )
      expect(response.ok).toBe(false)
      expect(!response.ok && response.error.code).toBe(expectedCode)
      expect(JSON.stringify(response)).not.toContain(marker)
    }
  })

  test('fails closed for URL, scheme, root, query, traversal, and variable imports', async () => {
    const hostileSources = [
      `import 'https://evil.invalid/module.js'`,
      `import('data:text/javascript,export default 1')`,
      `import '/outside.js'`,
      `import 'react?untrusted=1'`,
      `import 'react/../other'`,
      `const moduleName = 'react'; import(moduleName)`
    ]
    for (const [index, source] of hostileSources.entries()) {
      const files = new Map<string, string | Uint8Array>([
        [
          'package.json',
          JSON.stringify({
            name: `sidecar-hostile-${index}`,
            dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' }
          })
        ],
        ['src/main.tsx', source]
      ])
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: `hostile-${index}`,
          target: 'react',
          packageName: `sidecar-hostile-${index}`,
          files
        })
      )
      expect(response.ok, source).toBe(false)
      expect(!response.ok && response.error.code, source).toBe('unsafe-import')
      expect(JSON.stringify(response), source).not.toContain('evil.invalid')
    }
  })

  test('fails closed for hostile, missing, text, escaped, and ambiguous CSS URLs', async () => {
    const hostile = [
      'https://evil.invalid/a.png',
      'data:image/png;base64,AAAA',
      '//evil.invalid/a.png',
      '/root.png',
      './asset.png?cache=1',
      './asset.png#mixed',
      './%2e%2e/asset.png',
      '../../../asset.png',
      './missing.png',
      './text.png'
    ]
    for (const [index, url] of hostile.entries()) {
      const files = new Map<string, string | Uint8Array>([
        ['package.json', `{"name":"sidecar-css-${index}"}`],
        ['src/main.tsx', "import './index.css'"],
        ['src/index.css', `.hostile{background:url(${JSON.stringify(url)})}`],
        ['src/text.png', 'not binary']
      ])
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: `css-hostile-${index}`,
          target: 'react',
          packageName: `sidecar-css-${index}`,
          files
        })
      )
      expect(response.ok, url).toBe(false)
      expect(!response.ok && response.error.code, url).toMatch(/stylesheet/)
      expect(JSON.stringify(response), url).not.toContain('evil.invalid')
    }

    const escapedFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-css-escaped"}'],
      ['src/main.tsx', "import './index.css'"],
      ['src/index.css', '.hostile{background:u\\72l(https://evil.invalid/a.png)}']
    ])
    const escaped = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'css-escaped',
        target: 'react',
        packageName: 'sidecar-css-escaped',
        files: escapedFiles
      })
    )
    expect(escaped.ok).toBe(false)
    expect(!escaped.ok && escaped.error.code).toBe('unsafe-stylesheet-url')

    for (const [index, css] of [
      '.hostile{background-image:image-set("https://evil.invalid/a.png" 1x)}',
      '.hostile{background-image:-webkit-image-set(var(--remote) 1x)}',
      '.hostile{background-image:cross-fade("https://evil.invalid/a.png", red)}',
      '.hostile{content:"http\\73://evil.invalid/a.png"}',
      '@import "https://evil.invalid/a.css";'
    ].entries()) {
      const files = new Map<string, string | Uint8Array>([
        ['package.json', `{"name":"sidecar-css-function-${index}"}`],
        ['src/main.tsx', "import './index.css'"],
        ['src/index.css', css]
      ])
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: `css-function-${index}`,
          target: 'react',
          packageName: `sidecar-css-function-${index}`,
          files
        })
      )
      expect(response.ok, css).toBe(false)
      expect(!response.ok && response.error.code, css).toMatch(/stylesheet/)
      expect(JSON.stringify(response), css).not.toContain('evil.invalid')
    }

    const ambiguousFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-css-ambiguous"}'],
      ['src/main.tsx', "import './index.css'\nimport './theme/theme.css'"],
      ['src/index.css', '@import "tailwindcss";\n@source inline("bg-[url(./asset.png)]");'],
      ['src/theme/theme.css', '.theme{color:red}'],
      [
        'src/asset.png',
        new Uint8Array(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
          )
        )
      ],
      [
        'src/theme/asset.png',
        new Uint8Array(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
          )
        )
      ]
    ])
    const ambiguous = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'css-ambiguous',
        target: 'react',
        packageName: 'sidecar-css-ambiguous',
        files: ambiguousFiles
      })
    )
    expect(ambiguous.ok).toBe(false)
    expect(!ambiguous.ok && ambiguous.error.code).toBe('ambiguous-stylesheet-asset')
  })

  test('keeps pure CSS fragments and rejects oversized compiled CSS', async () => {
    const fragmentFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-css-fragment"}'],
      ['src/main.tsx', "import './index.css'"],
      ['src/index.css', '.icon{filter:url(#clip)}']
    ])
    const fragment = await createCodePenSidecarShowcase(parsedRequest(fragmentFiles, 'react'))
    expect(fragment.data.css).toContain('url("#clip")')

    const oversizedFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-css-oversized"}'],
      ['src/main.tsx', "import './index.css'"],
      ['src/index.css', `.oversized{--payload:${'a'.repeat(1_000_050)}}`]
    ])
    const oversized = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'css-oversized',
        target: 'react',
        packageName: 'sidecar-css-oversized',
        files: oversizedFiles
      })
    )
    expect(oversized.ok).toBe(false)
    expect(!oversized.ok && oversized.error.code).toBe('stylesheet-limit')
  }, 30_000)

  test('bounds hostile Tailwind candidates and CSS URL token counts', async () => {
    const candidateFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-candidate-limit"}'],
      [
        'src/main.tsx',
        `import './index.css'\ndocument.body.className = [${Array.from(
          { length: 20_001 },
          (_, index) => JSON.stringify(`candidate-${index}`)
        ).join(',')}].join(' ')`
      ],
      ['src/index.css', '@import "tailwindcss";']
    ])
    const candidates = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'candidate-limit',
        target: 'react',
        packageName: 'sidecar-candidate-limit',
        files: candidateFiles
      })
    )
    expect(candidates.ok).toBe(false)
    expect(!candidates.ok && candidates.error.code).toBe('tailwind-candidate-limit')

    const urlFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-css-url-limit"}'],
      ['src/main.tsx', "import './index.css'"],
      ['src/index.css', `.many{filter:${'url(#clip)'.repeat(4_097)}}`]
    ])
    const urls = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'css-url-limit',
        target: 'react',
        packageName: 'sidecar-css-url-limit',
        files: urlFiles
      })
    )
    expect(urls.ok).toBe(false)
    expect(!urls.ok && urls.error.code).toBe('stylesheet-limit')

    for (const [index, directive] of [
      '@source inline("{a,b,c}{1..100000}");',
      '@source "https://evil.invalid/classes";',
      '@plugin "untrusted-plugin";',
      '@config "./tailwind.config.js";'
    ].entries()) {
      const files = new Map<string, string | Uint8Array>([
        ['package.json', `{"name":"sidecar-directive-${index}"}`],
        ['src/main.tsx', "import './index.css'"],
        ['src/index.css', `@import "tailwindcss";\n${directive}`]
      ])
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: `directive-${index}`,
          target: 'react',
          packageName: `sidecar-directive-${index}`,
          files
        })
      )
      expect(response.ok, directive).toBe(false)
      expect(!response.ok && response.error.code, directive).toBe('unsafe-tailwind-directive')
      expect(JSON.stringify(response), directive).not.toContain('evil.invalid')
    }
  }, 30_000)

  test('rejects untrusted binary formats, corrupt assets, and encoded asset overflow', async () => {
    const validPNG = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    )
    const validJPEG = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0, 1, 0, 1, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
      0xff, 0xda, 0, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0, 0x12, 0xff, 0, 0x34, 0xff, 0xd0,
      0x56, 0xff, 0xd9
    ])
    const truncatedWoff2 = new Uint8Array(48)
    truncatedWoff2.set([0x77, 0x4f, 0x46, 0x32])
    truncatedWoff2.set([0, 0, 0, 48], 8)
    truncatedWoff2.set([0, 1], 12)
    truncatedWoff2.set([0, 0, 0, 16], 16)
    truncatedWoff2.set([0, 0, 0, 1], 20)
    const cases: Array<[string, Uint8Array, string]> = [
      [
        'src/assets/hostile.svg',
        new TextEncoder().encode('<svg></svg>'),
        'unsupported-stylesheet-asset'
      ],
      [
        'src/assets/corrupt.png',
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        'invalid-stylesheet-asset'
      ],
      ['src/assets/corrupt.ttf', new Uint8Array(32), 'invalid-stylesheet-asset'],
      ['src/assets/truncated.woff2', truncatedWoff2, 'invalid-stylesheet-asset'],
      [
        'src/assets/trailing.png',
        new Uint8Array([...validPNG, 0x3c, 0x73, 0x76, 0x67, 0x3e]),
        'invalid-stylesheet-asset'
      ],
      [
        'src/assets/second-eoi.jpg',
        new Uint8Array([...validJPEG, 0x3c, 0x73, 0x76, 0x67, 0x3e, 0xff, 0xd9]),
        'invalid-stylesheet-asset'
      ],
      ['src/assets/unknown.bin', new Uint8Array([1, 2, 3]), 'unsupported-stylesheet-asset']
    ]
    for (const [index, [path, bytes, expectedCode]] of cases.entries()) {
      const files = new Map<string, string | Uint8Array>([
        ['package.json', `{"name":"sidecar-binary-${index}"}`],
        ['src/main.tsx', "document.body.dataset.ready = 'yes'"],
        [path, bytes]
      ])
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: `binary-${index}`,
          target: 'react',
          packageName: `sidecar-binary-${index}`,
          files
        })
      )
      expect(response.ok, path).toBe(false)
      expect(!response.ok && response.error.code, path).toBe(expectedCode)
      expect(JSON.stringify(response), path).not.toContain('<svg>')
    }

    const validJpegFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-valid-jpeg"}'],
      ['src/main.tsx', "document.body.dataset.ready = 'yes'"],
      ['src/assets/exact.jpg', validJPEG]
    ])
    const validJpegResult = await createCodePenSidecarShowcase(
      parsedRequest(validJpegFiles, 'react')
    )
    expect(validJpegResult.compatible).toBe(true)

    const binarySecret = ['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_')
    const polyglot = new Uint8Array(validPNG.byteLength + binarySecret.length)
    polyglot.set(validPNG)
    polyglot.set(new TextEncoder().encode(binarySecret), validPNG.byteLength)
    const secretFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-binary-secret"}'],
      [
        'src/main.tsx',
        "import image from './assets/secret.png'; document.body.dataset.image = image"
      ],
      ['src/assets/secret.png', polyglot]
    ])
    const secretResponse = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'binary-secret',
        target: 'react',
        packageName: 'sidecar-binary-secret',
        files: secretFiles
      })
    )
    expect(secretResponse.ok).toBe(false)
    expect(!secretResponse.ok && secretResponse.error.code).toBe('secret-detected')
    expect(JSON.stringify(secretResponse)).not.toContain(binarySecret)

    const repeatedFont = new Uint8Array(400_100)
    repeatedFont.set([
      0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x6e, 0x61, 0x6d, 0x65, 0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0,
      4
    ])
    const repeatedFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-binary-repeat"}'],
      ['src/main.tsx', "import './index.css'"],
      [
        'src/index.css',
        '@font-face{font-family:a;src:url("./assets/fonts/repeated.ttf")}@font-face{font-family:b;src:url("./assets/fonts/repeated.ttf")}'
      ],
      ['src/assets/fonts/repeated.ttf', repeatedFont]
    ])
    const repeated = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'binary-repeat',
        target: 'react',
        packageName: 'sidecar-binary-repeat',
        files: repeatedFiles
      })
    )
    expect(repeated.ok).toBe(false)
    expect(!repeated.ok && repeated.error.code).toBe('asset-output-limit')

    const largeFont = new Uint8Array(750_100)
    largeFont.set([
      0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x6e, 0x61, 0x6d, 0x65, 0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0,
      4
    ])
    const overflowFiles = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-binary-overflow"}'],
      ['src/main.tsx', "document.body.dataset.ready = 'yes'"],
      ['src/assets/fonts/large.ttf', largeFont]
    ])
    const overflow = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'binary-overflow',
        target: 'react',
        packageName: 'sidecar-binary-overflow',
        files: overflowFiles
      })
    )
    expect(overflow.ok).toBe(false)
    expect(!overflow.ok && overflow.error.code).toBe('asset-output-limit')
  })

  test('secret-scans then omits server artifacts with a fixed diagnostic', async () => {
    const files = generatedProject('react')
    files.set(
      'supabase/functions/openpencil-runtime/index.ts',
      "const marker = 'SERVER_ONLY_MARKER'"
    )
    files.set('.env.server.example', 'SUPABASE_URL=')
    files.set('openpencil-server.manifest.json', '{}')
    files.set('SERVER_DEPLOYMENT.md', 'manual deployment')
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    expect(
      result.diagnostics.some((item) => item.code === 'codepen-server-artifacts-omitted')
    ).toBe(true)
    expect(result.data.js).not.toContain('SERVER_ONLY_MARKER')

    files.set('.env.server.example', ['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_'))
    const blocked = await handleCodePenSidecarInput(
      serializeCodePenSidecarRequest({
        requestId: 'server-secret',
        target: 'react',
        packageName: packageName(files),
        files
      })
    )
    expect(blocked.ok).toBe(false)
    expect(!blocked.ok && blocked.error.code).toBe('secret-detected')
  })

  test('secret-scans Prefill metadata and URL credentials without echoing values', async () => {
    const files = generatedProject('react')
    const secrets = [
      ['description', ['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_')],
      ['title', 'https://publisher:private-password@example.invalid/showcase'],
      ['tags', ['safe', 'ghp_abcdefghijklmnopqrstuvwxyz123456']]
    ] as const
    for (const [index, [field, secret]] of secrets.entries()) {
      const response = await handleCodePenSidecarInput(
        serializeCodePenSidecarRequest({
          requestId: `metadata-secret-${index}`,
          target: 'react',
          packageName: packageName(files),
          files,
          options: { [field]: secret }
        })
      )
      expect(response.ok, field).toBe(false)
      expect(!response.ok && response.error.code, field).toBe('secret-detected')
      expect(JSON.stringify(response), field).not.toContain(
        typeof secret === 'string' ? secret : secret[1]
      )
    }
  })

  test('diagnoses client network runtime and preserves router words in visible text', async () => {
    const graph = new SceneGraph()
    const first = graph.getPages()[0]
    const second = graph.addPage('Second')
    graph.createNode('TEXT', first.id, { text: 'BrowserRouter', width: 100, height: 30 })
    graph.createNode('TEXT', second.id, { text: 'createWebHistory', width: 100, height: 30 })
    const files = compile({
      graph,
      pageIds: [first.id, second.id],
      options: withDefaults({ target: 'react', devMode: false, packageName: 'sidecar-router-text' })
    }).files
    const main = files.get('src/main.tsx')
    if (typeof main !== 'string') throw new Error('Missing generated main source')
    files.set(
      'src/main.tsx',
      `${main}\nvoid new EventSource('https://example.invalid/status')\ndocument.body.dataset.remote = 'wss://example.invalid/socket'`
    )
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    expect(result.data.js).toContain('BrowserRouter')
    expect(result.data.js).toContain('createWebHistory')
    expect(result.data.js).toContain('HashRouter')
    expect(result.diagnostics.some((item) => item.code === 'codepen-router-hash-fallback')).toBe(
      true
    )
    expect(result.diagnostics.some((item) => item.code === 'codepen-client-network-runtime')).toBe(
      true
    )
  }, 30_000)

  test('allows design text that merely contains import(foo)', async () => {
    const files = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-import-text"}'],
      ['src/main.tsx', `document.body.textContent = 'Use import(foo) only in code examples'`]
    ])
    const result = await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
    expect(result.data.js).toContain('import(foo)')
  })

  test('rescans the final bundle and rejects a folded secret without echoing it', async () => {
    const secret = ['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_')
    const files = new Map<string, string | Uint8Array>([
      ['package.json', '{"name":"sidecar-output-secret"}'],
      [
        'src/main.tsx',
        `globalThis.name = ${JSON.stringify(secret.slice(0, 8))} + ${JSON.stringify(secret.slice(8))}`
      ]
    ])
    try {
      await createCodePenSidecarShowcase(parsedRequest(files, 'react'))
      throw new Error('Expected folded secret rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(CodePenSidecarRuntimeError)
      expect(JSON.stringify((error as CodePenSidecarRuntimeError).diagnostics)).not.toContain(
        secret
      )
    }
  })
})
