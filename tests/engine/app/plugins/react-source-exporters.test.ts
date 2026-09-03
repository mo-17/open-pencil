import { describe, expect, test } from 'bun:test'

import { unzipSync } from 'fflate'

import { compile, type CompilerInput } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_ID,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'
import {
  exportCurrentDocumentAsCapacitorSource,
  type CapacitorExporterDependencies
} from '@/app/plugins/host/capacitor-exporter'
import {
  exportCurrentDocumentAsElectronSource,
  type ElectronExporterDependencies
} from '@/app/plugins/host/electron-exporter'
import {
  exportCurrentDocumentAsNextJsSource,
  type NextJsExporterDependencies
} from '@/app/plugins/host/nextjs-exporter'
import { archiveProjectFiles } from '@/app/plugins/host/project-archive'
import type { ReactSourceExporterDependencies } from '@/app/plugins/host/react-source-exporter-runtime'
import type { SourceExporterEditor } from '@/app/plugins/host/source-exporter-runtime'

type ExporterDependencies = ReactSourceExporterDependencies

type SourceExporter = (
  editor: SourceExporterEditor,
  dependencies?: ExporterDependencies,
  signal?: AbortSignal
) => Promise<{ fileName: string; fileCount: number; saved: boolean }>

const EXPORTERS = [
  {
    name: 'Next.js',
    suffix: 'nextjs',
    marker: 'next.config.mjs',
    run: exportCurrentDocumentAsNextJsSource as SourceExporter
  },
  {
    name: 'Capacitor',
    suffix: 'capacitor',
    marker: 'capacitor.config.ts',
    run: exportCurrentDocumentAsCapacitorSource as SourceExporter
  },
  {
    name: 'Electron',
    suffix: 'electron',
    marker: 'electron/main.cjs',
    run: exportCurrentDocumentAsElectronSource as SourceExporter
  }
] as const

function editor(documentName = 'Product Demo'): SourceExporterEditor {
  return { graph: new SceneGraph(), state: { documentName } }
}

async function backendProviderEditor(): Promise<{
  source: SourceExporterEditor
  store: ReturnType<typeof createAppPluginStore>
}> {
  const bundled = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (!bundled) throw new Error('Expected bundled Supabase Backend Provider')
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundled],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.13.2'
  })
  await store.load()
  if (!store.backendProvider(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, SUPABASE_BACKEND_PROVIDER_ID)) {
    throw new Error('Expected installed Supabase Backend Provider')
  }
  const [descriptor] = listAppBackendProviderDescriptors(store)
  if (!descriptor) throw new Error('Expected reviewed Supabase Backend Provider descriptor')
  const source = editor('React Backend Provider')
  source.graph.updateNode(source.graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'react-runtime-public-key',
      schema: 'public'
    },
    lowcodeDocumentState: [{ id: 'notes', name: 'notes', type: 'array', defaultValue: [] }],
    pluginData: [
      {
        pluginId: 'open-pencil',
        key: 'lowcode/backendProvider.v1',
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection: descriptor,
          application: {
            format: 'openpencil.backend-application',
            version: 1,
            applicationId: 'react-backend-provider-test',
            dataModel: {
              version: 1,
              entities: [
                {
                  id: 'notes',
                  name: 'notes',
                  management: 'managed',
                  fields: [{ id: 'id', name: 'id', type: 'uuid', nullable: false }],
                  primaryKey: { fields: ['id'] },
                  indexes: []
                }
              ],
              enums: [],
              relations: []
            },
            auth: {
              version: 1,
              identities: [{ id: 'user', kind: 'user' }],
              roles: [],
              ownership: [],
              tenants: [],
              rowAccess: []
            },
            workflows: {
              version: 1,
              workflows: [
                {
                  id: 'backend-health',
                  name: 'Backend health',
                  trigger: { kind: 'http', method: 'POST', access: 'authenticated' },
                  parameters: [],
                  steps: [{ id: 'respond', kind: 'respond', value: 'true', status: 200 }]
                }
              ]
            },
            capabilities: [
              { capability: 'auth.identity', required: true },
              { capability: 'data.read', required: true },
              { capability: 'data.write', required: true },
              { capability: 'migrations.schema', required: true },
              { capability: 'policy.row-level', required: true },
              { capability: 'server.functions', required: true },
              { capability: 'server.http', required: true }
            ],
            secrets: []
          }
        })
      }
    ]
  })
  source.graph.createNode('BUTTON', source.graph.getPages()[0].id, {
    name: 'Load notes',
    events: {
      onClick: [
        {
          id: 'load-notes',
          kind: 'supabaseQuery',
          table: 'notes',
          columns: 'id',
          resultTarget: 'notes'
        }
      ]
    }
  })
  source.graph.createNode('BUTTON', source.graph.getPages()[0].id, {
    name: 'Backend health',
    events: {
      onClick: [
        {
          id: 'backend-health-call',
          kind: 'invokeServerWorkflow',
          workflowId: 'backend-health',
          args: {}
        }
      ]
    }
  })
  return { source, store }
}

function compiledFixture(extraFiles: ReadonlyMap<string, string | Uint8Array> = new Map()) {
  return new Map<string, string | Uint8Array>([
    [
      'package.json',
      '{"name":"product-demo","private":true,"scripts":{"dev":"vite","build":"vite build"},"dependencies":{"react":"^19.2.0","react-dom":"^19.2.0"},"devDependencies":{"vite":"^7.0.0"}}\n'
    ],
    ['src/App.tsx', 'export default function App() { return <main>Demo</main> }\n'],
    ['src/main.tsx', "import App from './App'\nimport './index.css'\nvoid App\n"],
    ['src/index.css', '@import "tailwindcss";\n'],
    ['index.html', '<div id="root"></div>\n'],
    [
      'vite.config.ts',
      "import { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: []\n})\n"
    ],
    ['tsconfig.json', '{}\n'],
    ['.gitignore', 'node_modules\ndist\n'],
    ...extraFiles
  ])
}

function dependencies(capture: { bytes?: Uint8Array; targets: string[] }): ExporterDependencies {
  return {
    async chooseDestination() {
      return {
        async write(data) {
          capture.bytes = data
        }
      }
    },
    async resolveFontManifest() {
      return { faces: [] }
    },
    compile(input) {
      capture.targets.push(`${input.options.target}:${input.options.router}`)
      return {
        files: compiledFixture(),
        warnings: [{ code: 'review-required', message: 'Review authored behavior.' }]
      }
    },
    archive: archiveProjectFiles
  }
}

describe('React source project plugin exporters', () => {
  for (const exporter of EXPORTERS) {
    test(`exports a bounded source-only ${exporter.name} archive`, async () => {
      const capture: { bytes?: Uint8Array; targets: string[] } = { targets: [] }
      const result = await exporter.run(editor(), dependencies(capture))
      if (!capture.bytes) throw new Error(`Expected ${exporter.name} archive bytes`)
      const files = unzipSync(capture.bytes)
      const readme = files['README.md']
      if (!readme) throw new Error(`Expected ${exporter.name} README`)

      expect(result).toMatchObject({
        fileName: `product-demo-${exporter.suffix}.zip`,
        saved: true
      })
      expect(result.fileCount).toBeGreaterThan(0)
      expect(capture.targets).toEqual(['react:none'])
      expect(files[exporter.marker]).toBeDefined()
      expect(files['EXPORT_WARNINGS.md']).toBeDefined()
      expect(files['node_modules']).toBeUndefined()
      expect(new TextDecoder().decode(readme)).toStartWith('# Product Demo\n')
    })
  }

  test('resolves the document Backend Provider while preserving React client usage', async () => {
    const { source, store } = await backendProviderEditor()
    let bytes: Uint8Array | undefined
    let compilerInput: CompilerInput | undefined
    const dependencies: NextJsExporterDependencies = {
      resolveBackendProviderStore: () => store,
      async chooseDestination() {
        return {
          async write(data) {
            bytes = data
          }
        }
      },
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile(input) {
        compilerInput = input
        return compile(input)
      },
      archive: archiveProjectFiles
    }

    await exportCurrentDocumentAsNextJsSource(source, dependencies)
    expect(compilerInput?.options.backendProvider).toMatchObject({
      selection: {
        descriptor: { providerId: 'supabase', adapterId: 'open-pencil.backend.supabase' },
        enabled: true
      },
      application: { applicationId: 'react-backend-provider-test' }
    })
    if (!bytes) throw new Error('Expected React Backend Provider archive')
    const files = unzipSync(bytes)
    expect(files['openpencil-backend.manifest.json']).toBeDefined()
    expect(files['backend/supabase/database-schema.json']).toBeDefined()
    expect(new TextDecoder().decode(files['src/_lowcode_supabase.ts'])).toContain(
      'react-runtime-public-key'
    )
    expect(new TextDecoder().decode(files['src/App.tsx'])).toContain('.from("notes").select("id")')
    expect(new TextDecoder().decode(files['src/App.tsx'])).toContain(
      'invokeServerWorkflow("backend-health"'
    )
    expect(files['supabase/functions/openpencil-runtime/index.ts']).toEqual(
      files['backend/supabase/functions/openpencil-runtime/index.ts']
    )
  })

  test('selects a destination before resolving fonts or entering synchronous compile', async () => {
    const calls: string[] = []
    const dependencies: NextJsExporterDependencies = {
      async chooseDestination(fileName) {
        calls.push(`choose:${fileName}`)
        return null
      },
      async resolveFontManifest() {
        calls.push('fonts')
        return { faces: [] }
      },
      compile() {
        calls.push('compile')
        return { files: compiledFixture(), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array()
      }
    }

    await expect(exportCurrentDocumentAsNextJsSource(editor(), dependencies)).resolves.toEqual({
      fileName: 'product-demo-nextjs.zip',
      fileCount: 0,
      warnings: [],
      saved: false
    })
    expect(calls).toEqual(['choose:product-demo-nextjs.zip'])
  })

  test('honors cancellation before fonts, synchronous compile, archive, and write', async () => {
    const calls: string[] = []
    const controller = new AbortController()
    const dependencies: CapacitorExporterDependencies = {
      async chooseDestination(_fileName, signal) {
        calls.push(`choose:${signal === controller.signal}`)
        controller.abort()
        return {
          async write() {
            calls.push('write')
          }
        }
      },
      async resolveFontManifest() {
        calls.push('fonts')
        return { faces: [] }
      },
      compile() {
        calls.push('compile')
        return { files: compiledFixture(), warnings: [] }
      },
      async archive() {
        calls.push('archive')
        return new Uint8Array()
      }
    }

    await expect(
      exportCurrentDocumentAsCapacitorSource(editor(), dependencies, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toEqual(['choose:true'])
  })

  test('rejects unsafe compiler paths before a destination write', async () => {
    for (const exporter of EXPORTERS) {
      let wrote = false
      const dependencies: ExporterDependencies = {
        async chooseDestination() {
          return {
            async write() {
              wrote = true
            }
          }
        },
        async resolveFontManifest() {
          return { faces: [] }
        },
        compile() {
          return {
            files: compiledFixture(new Map([['../escape.txt', 'blocked']])),
            warnings: []
          }
        },
        archive: archiveProjectFiles
      }

      await expect(exporter.run(editor(), dependencies)).rejects.toThrow(
        'Unsafe project archive path'
      )
      expect(wrote).toBe(false)
    }
  })

  test('enforces the shared 64 MiB source budget before writing', async () => {
    let wrote = false
    const dependencies: ElectronExporterDependencies = {
      async chooseDestination() {
        return {
          async write() {
            wrote = true
          }
        }
      },
      async resolveFontManifest() {
        return { faces: [] }
      },
      compile() {
        return {
          files: compiledFixture(
            new Map([['public/oversize.bin', new Uint8Array(64 * 1024 * 1024 + 1)]])
          ),
          warnings: []
        }
      },
      archive: archiveProjectFiles
    }

    await expect(exportCurrentDocumentAsElectronSource(editor(), dependencies)).rejects.toThrow(
      'exceeds 67108864 bytes'
    )
    expect(wrote).toBe(false)
  })
})
