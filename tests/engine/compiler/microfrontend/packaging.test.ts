import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/core'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

function compilerOptions(target: 'react' | 'vue') {
  return withDefaults({
    packageName: `${target}-microfrontend`,
    target,
    router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
    devMode: false,
    packaging: { kind: 'microfrontend', appId: `com.example.${target}`, version: '1.2.3' }
  })
}

describe('compiler microfrontend packaging', () => {
  test.each(['react', 'vue'] as const)(
    '%s leaves the standalone file map and bytes unchanged when packaging is unset',
    (target) => {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const options = compilerOptions(target)
      const { packaging: _packaging, ...standaloneOptions } = options
      const implicit = compile({ graph, pageIds: [pageId], options: standaloneOptions })
      const explicit = compile({
        graph,
        pageIds: [pageId],
        options: withDefaults(standaloneOptions)
      })

      expect([...implicit.files]).toEqual([...explicit.files])
      expect(implicit.microfrontend).toBeUndefined()
      expect(implicit.files.has('src/microfrontend.tsx')).toBe(false)
      expect(implicit.files.has('src/microfrontend.ts')).toBe(false)
    }
  )

  test('React emits an exact lifecycle-only entry, complete wrapper stack, and basename context', () => {
    const graph = new SceneGraph()
    const first = graph.getPages()[0]
    first.name = 'Home'
    const second = graph.addPage('Settings')
    const output = compile({
      graph,
      pageIds: [first.id, second.id],
      options: compilerOptions('react')
    })
    const entry = textFile(output.files, 'src/microfrontend.tsx')
    const context = textFile(output.files, 'src/__microfrontend-context.ts')
    const app = textFile(output.files, 'src/App.tsx')

    expect(output.files.has('src/__microfrontend-abi.ts')).toBe(true)
    expect(output.microfrontend).toEqual({
      app: {
        id: 'com.example.react',
        name: 'react-microfrontend',
        version: '1.2.3',
        framework: 'react'
      },
      routes: ['/', '/settings']
    })
    expect(entry.match(/^export async function (\w+)/gm)?.sort()).toEqual([
      'export async function bootstrap',
      'export async function mount',
      'export async function unmount',
      'export async function update'
    ])
    expect(entry).not.toMatch(/^export (?:const|type|interface)/m)
    expect(entry).toContain('const APP_ID = "com.example.react"')
    expect(entry).toContain("import './index.css'")
    expect(entry).toContain('setMicrofrontendMountTarget(target)')
    expect(entry).toContain('root.unmount()')
    expect(entry).toContain('setMicrofrontendContext(null)')
    expect(context).toContain('microfrontendHostContext')
    expect(context).toContain('microfrontendPortalTarget')
    expect(context).toContain('useSyncExternalStore')
    expect(app).toContain('<BrowserRouter basename={basePath}>')
    expect(app).toContain('<HostLocationSynchronizer hostLocation={location} />')
    expect(app).toContain('void navigate(hostLocation, { replace: true })')
    expect(entry).not.toContain('PopStateEvent')
  })

  test('Vue emits an exact lifecycle-only entry and a disposable basename router factory', () => {
    const graph = new SceneGraph()
    const first = graph.getPages()[0]
    first.name = 'Home'
    const second = graph.addPage('Settings')
    const output = compile({
      graph,
      pageIds: [first.id, second.id],
      options: compilerOptions('vue')
    })
    const entry = textFile(output.files, 'src/microfrontend.ts')
    const context = textFile(output.files, 'src/__microfrontend-context.ts')
    const router = textFile(output.files, 'src/router.ts')

    expect(output.files.has('src/__microfrontend-abi.ts')).toBe(true)
    expect(output.microfrontend).toEqual({
      app: {
        id: 'com.example.vue',
        name: 'vue-microfrontend',
        version: '1.2.3',
        framework: 'vue'
      },
      routes: ['/', '/settings']
    })
    expect(entry.match(/^export async function (\w+)/gm)?.sort()).toEqual([
      'export async function bootstrap',
      'export async function mount',
      'export async function unmount',
      'export async function update'
    ])
    expect(entry).not.toMatch(/^export (?:const|type|interface)/m)
    expect(entry).toContain('const APP_ID = "com.example.vue"')
    expect(entry).toContain('application.unmount()')
    expect(entry).toContain('setMicrofrontendMountTarget(null)')
    expect(context).toContain('microfrontendPortalTarget')
    expect(router).toContain('createMicrofrontendRouter(basePath: string)')
    expect(router).toContain('dispose: () => history.destroy()')
    expect(router).not.toContain('import.meta.env.BASE_URL')
    expect(textFile(output.files, 'src/main.ts')).toContain(
      'createMicrofrontendRouter(import.meta.env.BASE_URL)'
    )
  })

  test.each(['expo', 'flutter'] as const)(
    'rejects %s packaging before adapter emission',
    (target) => {
      const graph = makeSceneGraph()
      expect(() =>
        compile({
          graph,
          pageIds: [firstPageId(graph)],
          options: withDefaults({
            target,
            router: target === 'expo' ? 'expo-router' : 'flutter-router',
            packaging: { kind: 'microfrontend', appId: 'com.example.native' }
          })
        })
      ).toThrow('supports only React and Vue')
    }
  )

  test.each([
    [{ appId: 'Bad Id', version: '1.2.3' }, 'must use lowercase'],
    [{ appId: 'com.example.valid', version: '1.2.3-beta' }, 'stable semantic version']
  ] as const)('rejects invalid identity/version packaging %#', (packaging, message) => {
    const graph = makeSceneGraph()
    expect(() =>
      compile({
        graph,
        pageIds: [firstPageId(graph)],
        options: withDefaults({
          packaging: { kind: 'microfrontend', ...packaging }
        })
      })
    ).toThrow(message)
  })
})
