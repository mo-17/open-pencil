import { describe, expect, test } from 'bun:test'

import { buildExpoVRTourRuntime } from '#compiler/adapters/expo/vr-tour'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { BindingExpr } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

import { tourFixture } from './helpers'

function compileExpoTour(binding?: BindingExpr, router = false) {
  const { graph, pageId, node } = tourFixture(binding)
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target: 'expo',
      router: router ? 'expo-router' : 'none',
      packageName: 'expo-tour-proof',
      devMode: false
    })
  })
  return { ...output, node }
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing text file: ${path}`)
  return value
}

describe('Expo VR tour export', () => {
  test('the generated wrapper blocks authored navigation and releases its surface in background', () => {
    const runtime = wrapperHarness({ room: '<!doctype html><p>prepared room</p>' })
    const viewer = findElement(runtime.render('room'), 'WebView')
    expect(viewer?.props.source).toEqual({ html: '<!doctype html><p>prepared room</p>' })
    const navigation = viewer?.props.onShouldStartLoadWithRequest as (request: {
      url: string
    }) => boolean
    expect(navigation({ url: 'about:blank' })).toBe(true)
    for (const url of [
      'https://example.com',
      `java${'script'}:alert(1)`,
      'file:///tmp/x',
      'data:text/html,x'
    ])
      expect(navigation({ url })).toBe(false)
    runtime.changeState('background')
    expect(findElement(runtime.render('room'), 'WebView')).toBeUndefined()
    runtime.changeState('active')
    expect(findElement(runtime.render('room'), 'WebView')).toBeDefined()
    expect(findElement(runtime.render('missing'), 'WebView')).toBeUndefined()
    expect(JSON.stringify(runtime.render('missing'))).toContain('npm run prepare:vr-tour')
    runtime.dispose()
    expect(runtime.subscribed()).toBe(false)
  })

  test('emits a prepared HTML WebView inside the native page with pinned Expo dependencies', () => {
    const { files, warnings, node } = compileExpoTour()
    const page = textFile(files, 'src/pages/index.tsx')
    const manifest = JSON.parse(textFile(files, 'package.json'))
    expect(page).toContain("from '../vr-tour'")
    expect(page).toContain(`tourId=${JSON.stringify(node.id)}`)
    expect(page).toContain('<SafeAreaView')
    expect(files.has('src/vr-tour-html.ts')).toBe(true)
    expect(files.has('vr-tour-web/build.mjs')).toBe(true)
    expect(manifest.dependencies['react-native-webview']).toBe('13.16.1')
    expect(manifest.dependencies['@photo-sphere-viewer/core']).toBe('5.15.1')
    expect(manifest.devDependencies.esbuild).toBe('0.28.2')
    expect(manifest.scripts['prepare:vr-tour']).toBe('node vr-tour-web/build.mjs')
    expect(JSON.parse(textFile(files, 'tsconfig.json')).exclude).toEqual(['vr-tour-web'])
    for (const hook of ['prestart', 'preandroid', 'preios'])
      expect(manifest.scripts[hook]).toBe('npm run prepare:vr-tour')
    expect(warnings.map(({ code }) => code)).not.toContain('expo-module-unsupported')
    const wrapper = textFile(files, 'src/vr-tour.tsx')
    expect(wrapper).toContain('vrTourHtmlById[tourId]')
    expect(wrapper).toContain('npm run prepare:vr-tour')
    expect(wrapper).toContain('onShouldStartLoadWithRequest')
    expect(wrapper).toContain('javaScriptCanOpenWindowsAutomatically={false}')
    expect(wrapper).toContain('allowFileAccess={false}')
    expect(wrapper).toContain("AppState.addEventListener('change'")
    expect(wrapper).not.toContain('injectedJavaScript')
    expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(wrapper)).not.toThrow()
  })

  test('unmounts the WebView while an Expo Router page is unfocused', () => {
    const { files } = compileExpoTour(undefined, true)
    const wrapper = textFile(files, 'src/vr-tour.tsx')
    expect(wrapper).toContain("import { useFocusEffect } from 'expo-router'")
    expect(wrapper).toContain('setFocused(false)')
    expect(wrapper).toContain('!active || !focused')
  })

  test('aliases the viewer import when an authored state uses its preferred name', () => {
    const { graph, pageId } = tourFixture()
    graph.updateNode(pageId, {
      state: [
        { id: 'viewer-name', name: 'OpenPencilVRTour', type: 'string', defaultValue: 'authored' }
      ]
    })
    const { files } = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'expo', router: 'none', devMode: false })
    })
    const page = textFile(files, 'src/pages/index.tsx')
    expect(page).toContain("import OpenPencilVRTour2 from '../vr-tour'")
    expect(page).toContain('<OpenPencilVRTour2 tourId=')
    expect(page).toContain('const [OpenPencilVRTour, setOpenPencilVRTour]')
    expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(page)).not.toThrow()
  })

  test('keeps dynamic and invalid bindings explicitly unavailable without loading authored panoramas', () => {
    for (const expr of ['selectedProperty.panorama_url', 'unknown.panorama_url']) {
      const { files, warnings } = compileExpoTour({ kind: 'expr', expr })
      const page = textFile(files, 'src/pages/index.tsx')
      expect(warnings.map(({ code }) => code)).toContain('expo-vr-tour-binding-unsupported')
      expect(page).toContain('Dynamic panorama bindings are not supported in this Expo export.')
      expect(page).not.toContain('<OpenPencilVRTour')
      expect(files.has('src/vr-tour.tsx')).toBe(false)
      const manifest = JSON.parse(textFile(files, 'package.json'))
      expect(manifest.dependencies['react-native-webview']).toBeUndefined()
      expect(manifest.scripts['prepare:vr-tour']).toBeUndefined()
    }
  })

  test('leaves non-VR native exports without a WebView dependency or preparation step', () => {
    const graph = makeSceneGraph('Native page')
    const pageId = firstPageId(graph)
    graph.createNode('TEXT', pageId, { text: 'Native content' })
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'expo', router: 'none', devMode: false })
    })
    const manifest = JSON.parse(textFile(output.files, 'package.json'))
    expect(manifest.dependencies['react-native-webview']).toBeUndefined()
    expect(manifest.scripts['prepare:vr-tour']).toBeUndefined()
    expect(output.files.has('src/vr-tour.tsx')).toBe(false)
    expect(textFile(output.files, 'src/pages/index.tsx')).not.toContain('../vr-tour')
  })
})

interface RenderedElement {
  type: string
  props: Record<string, unknown>
  children: unknown[]
}

function findElement(value: unknown, type: string): RenderedElement | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findElement(child, type)
      if (found) return found
    }
    return undefined
  }
  if (!('type' in value) || !('children' in value) || !('props' in value)) return undefined
  const element = value as RenderedElement
  return element.type === type ? element : findElement(element.children, type)
}

/** Execute the generated wrapper with isolated host/hook doubles, without module mocks or a device. */
function wrapperHarness(html: Readonly<Record<string, string>>) {
  const states: unknown[] = []
  const effects: Array<{ dependencies: readonly unknown[]; cleanup?: () => void }> = []
  let stateIndex = 0
  let effectIndex = 0
  let listener: ((state: string) => void) | undefined
  const useState = <T>(initial: T): [T, (next: T | ((previous: T) => T)) => void] => {
    const index = stateIndex++
    if (!(index in states)) states[index] = initial
    return [
      states[index] as T,
      (next) => {
        states[index] =
          typeof next === 'function' ? (next as (previous: T) => T)(states[index] as T) : next
      }
    ]
  }
  const useEffect = (effect: () => (() => void) | undefined, dependencies: readonly unknown[]) => {
    const index = effectIndex++
    const previous = effects[index]
    if (
      previous &&
      dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))
    )
      return
    previous?.cleanup?.()
    effects[index] = { dependencies, cleanup: effect() ?? undefined }
  }
  const source = buildExpoVRTourRuntime(false)
    .replace(/^import .*$/gm, '')
    .replace('export default function ', 'function ')
  const executable = new Bun.Transpiler({
    loader: 'tsx',
    tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'renderElement' } })
  }).transformSync(source)
  const create = new Function(
    'useState',
    'useEffect',
    'useMemo',
    'AppState',
    'View',
    'Text',
    'Pressable',
    'WebView',
    'vrTourHtmlById',
    'renderElement',
    `${executable}\nreturn OpenPencilVRTour`
  )
  const renderWrapper = create(
    useState,
    useEffect,
    <T>(factory: () => T) => factory(),
    {
      currentState: 'active',
      addEventListener: (_event: string, callback: (state: string) => void) => {
        listener = callback
        return {
          remove: () => {
            listener = undefined
          }
        }
      }
    },
    'View',
    'Text',
    'Pressable',
    'WebView',
    html,
    (
      type: string,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): RenderedElement => ({ type, props: props ?? {}, children })
  ) as (props: { tourId: string; locale: string }) => RenderedElement
  return {
    render(tourId: string) {
      stateIndex = 0
      effectIndex = 0
      return renderWrapper({ tourId, locale: 'en' })
    },
    changeState(state: string) {
      listener?.(state)
    },
    subscribed() {
      return listener !== undefined
    },
    dispose() {
      for (const effect of effects) effect.cleanup?.()
    }
  }
}
