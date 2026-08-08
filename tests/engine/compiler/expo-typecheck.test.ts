import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Expo generated project typecheck', () => {
  test('passes tsc in dev mode when identifiers need aliases and components receive test IDs', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://example.supabase.co',
        anonKey: 'public-anon-key'
      }
    })
    graph.updateNode(page.id, {
      state: [
        { id: 'card-state', name: 'Card', type: 'string', defaultValue: '' },
        { id: 'items-state', name: 'items', type: 'array', defaultValue: [] }
      ]
    })
    const card = graph.createNode('COMPONENT', page.id, { name: 'Card' })
    graph.createNode('TEXT', card.id, { text: 'Card' })
    graph.createInstance(card.id, page.id)
    const pageIndex = graph.createNode('COMPONENT', page.id, { name: 'Page Index' })
    graph.createNode('TEXT', pageIndex.id, { text: 'Page index' })
    graph.createInstance(pageIndex.id, page.id)
    const list = graph.createNode('LIST', page.id, {
      interactiveProps: {
        dataSourceRef: { kind: 'stateRef', stateId: 'items-state' },
        itemName: 'for',
        indexName: 'class'
      }
    })
    graph.createNode('TEXT', list.id, { text: 'Safe iterator fallback' })
    graph.createNode('SELECT', page.id, {
      interactiveProps: {
        optionsSource: {
          kind: 'ref',
          stateId: 'items-state',
          itemName: 'View',
          indexName: 'router'
        }
      }
    })
    const remoteList = graph.createNode('LIST', page.id, {
      name: 'Remote products',
      interactiveProps: {
        dataSourceRef: {
          kind: 'supabaseQuery',
          query: { table: 'products', columns: 'id,name' }
        }
      }
    })
    graph.createNode('TEXT', remoteList.id, {
      text: 'Remote product',
      bindings: { text: { kind: 'expr', expr: 'item.profile.name' } }
    })

    const output = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({
        packageName: 'expo-typecheck',
        target: 'expo',
        router: 'none',
        devMode: true
      })
    })
    expect(output.warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'list-invalid-item-name',
        'list-invalid-index-name',
        'options-source-invalid-item-name',
        'options-source-invalid-index-name',
        'expo-list-query-unsupported'
      ])
    )
    const pageSource = output.files.get('src/pages/index.tsx')
    if (typeof pageSource !== 'string') throw new Error('Missing generated Expo page')
    expect(pageSource).toContain(
      '{null /* OpenPencil: Supabase list query omitted in the static Expo target */}'
    )
    expect(pageSource).not.toContain('remoteProductsRows')
    const directory = mkdtempSync(join(tmpdir(), 'openpencil-expo-typecheck-'))
    temporaryDirectories.push(directory)
    for (const [path, value] of output.files) {
      if (typeof value !== 'string' || !/\.[cm]?tsx?$/.test(path)) continue
      const destination = join(directory, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, value)
    }
    writeFileSync(join(directory, 'native-stubs.d.ts'), NATIVE_TYPE_STUBS)
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          lib: ['ES2022'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
          types: [],
          jsx: 'react-jsx'
        },
        include: ['**/*.ts', '**/*.tsx', 'native-stubs.d.ts']
      })
    )

    const process = Bun.spawnSync({
      cmd: [resolve('node_modules/.bin/tsc'), '--project', join(directory, 'tsconfig.json')],
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const diagnostics = `${process.stdout.toString()}${process.stderr.toString()}`

    expect(process.exitCode, diagnostics).toBe(0)
  })
})

const NATIVE_TYPE_STUBS = `
declare namespace JSX {
  interface Element {}
  interface IntrinsicAttributes { key?: unknown }
  interface IntrinsicElements { [name: string]: Record<string, unknown> }
}

declare module 'react/jsx-runtime' {
  export const Fragment: unknown
  export function jsx(type: unknown, props: unknown): JSX.Element
  export function jsxs(type: unknown, props: unknown): JSX.Element
}

declare module 'react' {
  export type ReactNode = unknown
  export function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T
  export function useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void]
  export function useSyncExternalStore<T>(
    subscribe: (listener: () => void) => () => void,
    snapshot: () => T,
    serverSnapshot?: () => T
  ): T
}

declare module 'react-native' {
  export type ImageStyle = Record<string, unknown>
  export type TextStyle = Record<string, unknown>
  export type ViewStyle = Record<string, unknown>
  export type StyleProp<T> = T | readonly T[] | null | undefined
  type NativeComponent = (props: Record<string, unknown>) => JSX.Element
  export const Image: NativeComponent
  export const ImageBackground: NativeComponent
  export const KeyboardAvoidingView: NativeComponent
  export const Pressable: NativeComponent
  export const ScrollView: NativeComponent
  export const Switch: NativeComponent
  export const Text: NativeComponent
  export const TextInput: NativeComponent
  export const View: NativeComponent
  export const Platform: { OS: string }
  export const Linking: {
    canOpenURL(url: string): Promise<boolean>
    openURL(url: string): Promise<void>
  }
  export const StyleSheet: { create<T>(styles: T): T }
}

declare module 'react-native-safe-area-context' {
  export const SafeAreaProvider: (props: Record<string, unknown>) => JSX.Element
  export const SafeAreaView: (props: Record<string, unknown>) => JSX.Element
}

declare module 'expo-font' {
  export function useFonts(fonts: Record<string, unknown>): [boolean]
}

declare module 'expo-router' {
  export const Stack: (props: Record<string, unknown>) => JSX.Element
  export function useLocalSearchParams<T>(): T
  export function useRouter(): { push(target: unknown): void }
}
`
