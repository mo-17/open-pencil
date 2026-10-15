import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import { createEditor, type Editor } from '@open-pencil/core/editor'
import { exportFigFile, isFigPagePending, parseFigFile } from '@open-pencil/core/io/formats/fig'
import {
  LOWCODE_APPLICATION_PLUGIN_KEY,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import { SceneGraph } from '@open-pencil/scene-graph'

import { previewSidecarCommandArgs } from '@/app/lowcode/preview-pane/host/tauri-sidecar'
import { createPreviewSourcePreparation } from '@/app/lowcode/preview-pane/source-preparation'
import {
  parsePreviewSidecarReady,
  previewCompilerOverrides
} from '@/app/lowcode/preview-pane/use-compile-on-change'
import { createDeferred } from '@/app/runtime/deferred'

import { expectDefined } from '#tests/helpers/assert'
import { applicationModeFixture } from '#tests/helpers/compiler/application-mode/fixture'

function settings(target: 'react' | 'vue') {
  return {
    target: ref(target),
    uiKit: ref<'none' | 'shadcn'>('shadcn'),
    i18nEnabled: ref(true),
    localesInput: ref('ar, fr')
  }
}

describe('compiler preview target controller', () => {
  test('passes React-only preview features to the React compiler', () => {
    expect(previewCompilerOverrides(settings('react'), 2)).toEqual({
      target: 'react',
      router: 'react-router-v6',
      uiKit: 'shadcn',
      i18n: true,
      locales: ['ar', 'fr']
    })
  })

  test('fails closed by omitting incompatible features from Vue compiler input', () => {
    expect(previewCompilerOverrides(settings('vue'), 2)).toEqual({
      target: 'vue',
      router: 'vue-router-v4',
      i18n: false
    })
  })

  test('keeps the single-page preview router-free for both targets', () => {
    expect(previewCompilerOverrides(settings('react')).router).toBe('none')
    expect(previewCompilerOverrides(settings('vue')).router).toBe('none')
  })

  test('pins the immutable sidecar process to the selected framework', () => {
    expect(previewSidecarCommandArgs('/repo', 'react')).toEqual([
      'packages/compiler/src/dev-server.ts',
      '--root',
      '/repo',
      '--target',
      'react'
    ])
    expect(previewSidecarCommandArgs('/repo', 'vue')).toEqual([
      'packages/compiler/src/dev-server.ts',
      '--root',
      '/repo',
      '--target',
      'vue'
    ])
  })

  test('accepts only a canonical loopback ready origin with the declared port', () => {
    expect(
      parsePreviewSidecarReady({
        type: 'ready',
        url: 'http://127.0.0.1:60140/',
        port: 60140
      })
    ).toEqual({ url: 'http://127.0.0.1:60140/', port: 60140 })

    for (const value of [
      { type: 'ready', url: 'https://127.0.0.1:60140/', port: 60140 },
      { type: 'ready', url: 'http://example.com:60140/', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60141/', port: 60140 },
      { type: 'ready', url: 'http://user@127.0.0.1:60140/', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/?token=x', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/#preview', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/app', port: 60140 },
      { type: 'ready', url: 'http://127.0.0.1:60140/', port: 60140, extra: true }
    ]) {
      expect(() => parsePreviewSidecarReady(value)).toThrow()
    }
  })
})

function observedSourcePreparation(
  editor: Editor,
  isCurrent: () => boolean = () => true,
  beforeLoad: (pageId: string) => Promise<void> = async () => undefined
) {
  const loaded: string[] = []
  const source = createPreviewSourcePreparation(
    {
      get graph() {
        return editor.graph
      },
      async loadPageNodes(pageId) {
        loaded.push(pageId)
        await beforeLoad(pageId)
        await editor.loadPageNodes(pageId)
      }
    },
    isCurrent
  )
  return { source, loaded }
}

describe('compiler preview source preparation', () => {
  for (const rootState of ['editable', 'locked', 'library-readonly'] as const) {
    test(`populates saved lazy application pages in a ${rootState} document without switching the canvas page`, async () => {
      const { graph } = applicationModeFixture(true)
      const bytes = await exportFigFile(graph)
      const lazy = await parseFigFile(Uint8Array.from(bytes).buffer, { populate: 'first-page' })
      if (rootState === 'locked') lazy.updateNode(lazy.rootId, { locked: true })
      else if (rootState === 'library-readonly')
        lazy.updateNode(lazy.rootId, { libraryReadonly: true })
      const editor = createEditor({ graph: lazy })
      const applicationPages = lazy.getPages().filter((page) => page.name !== 'Reference')
      const currentPageId = editor.state.currentPageId
      const { source, loaded } = observedSourcePreparation(editor)
      try {
        expect(applicationPages.every((page) => isFigPagePending(lazy, page.id))).toBe(true)
        expect(await source.prepare()).toBe(true)
        expect(loaded).toEqual(applicationPages.map((page) => page.id))
        expect(applicationPages.every((page) => !isFigPagePending(lazy, page.id))).toBe(true)
        expect(resolveLowcodeApplicationPages(lazy)).toMatchObject({
          mode: 'application',
          pages: applicationPages.map((page) => ({ pageId: page.id })),
          warnings: []
        })
        expect(editor.state.currentPageId).toBe(currentPageId)
        expect(source.graph).toBe(lazy)
        expect(source.isCurrent()).toBe(true)
      } finally {
        source.dispose()
        editor.dispose()
      }
    })
  }

  test('loads only the configured shell source beside application pages, preserving other design pages lazily', async () => {
    const { graph, reference, home, products } = applicationModeFixture(true)
    const shell = graph.createNode('FRAME', reference.id, { layoutMode: 'VERTICAL' })
    const slot = graph.createNode('FRAME', shell.id, { layoutMode: 'VERTICAL' })
    const untouched = graph.addPage('Unrelated design')
    graph.createNode('RECTANGLE', untouched.id, { name: 'Unrelated shape' })
    const otherSource = graph.addPage('Other components')
    graph.createNode('RECTANGLE', otherSource.id, { name: 'Other component artwork' })
    graph.updateNode(otherSource.id, {
      lowcodeApplicationPage: { version: 1, role: 'components' }
    })
    graph.updateNode(graph.rootId, {
      lowcodeApplication: {
        version: 1,
        enabled: true,
        startPageId: home.id,
        shell: { frameNodeId: shell.id, slotNodeId: slot.id }
      }
    })
    const bytes = await exportFigFile(graph)
    const lazy = await parseFigFile(Uint8Array.from(bytes).buffer, { populate: 'first-page' })
    const editor = createEditor({ graph: lazy })
    const page = (name: string) =>
      expectDefined(lazy.getPages().find((entry) => entry.name === name))
    const { source, loaded } = observedSourcePreparation(editor)
    try {
      expect(await source.prepare()).toBe(true)
      expect(loaded).toEqual([page(home.name).id, page(products.name).id, page(reference.name).id])
      expect(isFigPagePending(lazy, page(untouched.name).id)).toBe(true)
      expect(isFigPagePending(lazy, page(otherSource.name).id)).toBe(true)
      expect(resolveLowcodeApplicationPages(lazy).warnings).toEqual([])
    } finally {
      source.dispose()
      editor.dispose()
    }
  })

  test('keeps ordinary design documents on their existing lazy loading policy', async () => {
    const { graph } = applicationModeFixture(false)
    const editor = createEditor({ graph })
    const { source, loaded } = observedSourcePreparation(editor)
    try {
      expect(await source.prepare()).toBe(true)
      expect(loaded).toEqual([])
    } finally {
      source.dispose()
      editor.dispose()
    }
  })

  for (const protection of ['locked', 'library-readonly'] as const) {
    test(`keeps compiler rejection of a ${protection} application page after preparing its lazy input`, async () => {
      const { graph } = applicationModeFixture(true)
      const bytes = await exportFigFile(graph)
      const lazy = await parseFigFile(Uint8Array.from(bytes).buffer, { populate: 'first-page' })
      const home = expectDefined(lazy.getPages().find((page) => page.name === 'Home'))
      const products = expectDefined(lazy.getPages().find((page) => page.name === 'Products'))
      if (protection === 'locked') lazy.updateNode(products.id, { locked: true })
      else lazy.updateNode(products.id, { libraryReadonly: true })
      const editor = createEditor({ graph: lazy })
      const { source } = observedSourcePreparation(editor)
      try {
        expect(isFigPagePending(lazy, products.id)).toBe(true)
        expect(await source.prepare()).toBe(true)
        expect(isFigPagePending(lazy, products.id)).toBe(false)
        const scope = resolveLowcodeApplicationPages(lazy)
        expect(scope.pages.map((page) => page.pageId)).toEqual([home.id])
        expect(scope.warnings).toMatchObject([
          { code: 'application-entry-invalid', nodeId: products.id }
        ])
      } finally {
        source.dispose()
        editor.dispose()
      }
    })
  }

  test('preserves inert application metadata and lets the compiler report it without loading pages', async () => {
    const { graph } = applicationModeFixture(true)
    graph.updateNode(graph.rootId, {
      pluginData: [
        {
          pluginId: 'open-pencil',
          key: LOWCODE_APPLICATION_PLUGIN_KEY,
          value: 'unsupported policy'
        }
      ]
    })
    const editor = createEditor({ graph })
    const { source, loaded } = observedSourcePreparation(editor)
    try {
      expect(await source.prepare()).toBe(true)
      expect(loaded).toEqual([])
      expect(resolveLowcodeApplicationPages(graph).mode).toBe('invalid')
    } finally {
      source.dispose()
      editor.dispose()
    }
  })

  for (const change of [
    'request',
    'graph',
    'mode',
    'page-policy',
    'page-create',
    'page-order'
  ] as const) {
    test(`withdraws a delayed application preparation after ${change} changes`, async () => {
      const { graph, home, products } = applicationModeFixture(true)
      const editor = createEditor({ graph })
      const entered = createDeferred<undefined>()
      const resume = createDeferred<undefined>()
      let current = true
      const { source, loaded } = observedSourcePreparation(
        editor,
        () => current,
        async () => {
          entered.resolve(undefined)
          await resume.promise
        }
      )
      const pending = source.prepare()
      try {
        await entered.promise
        if (change === 'request') current = false
        else if (change === 'graph') editor.replaceGraph(new SceneGraph())
        else if (change === 'mode')
          graph.updateNode(graph.rootId, { lowcodeApplication: { version: 1, enabled: false } })
        else if (change === 'page-policy')
          graph.updateNode(home.id, {
            lowcodeApplicationPage: { version: 1, role: 'reference' }
          })
        else if (change === 'page-create') {
          const added = graph.createNode('CANVAS', graph.rootId, {
            name: 'Added application page',
            lowcodeRoutePattern: '/added',
            lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: 'added-entry' }
          })
          graph.createNode('FRAME', added.id, { id: 'added-entry', width: 360, height: 640 })
          expect(resolveLowcodeApplicationPages(graph).pages).toHaveLength(3)
        } else {
          graph.reorderChild(products.id, graph.rootId, 0)
          expect(graph.getPages()[0].id).toBe(products.id)
        }
        resume.resolve(undefined)
        expect(await pending).toBe(false)
        expect(loaded).toEqual([home.id])
        expect(source.isCurrent()).toBe(false)
      } finally {
        resume.resolve(undefined)
        await pending
        source.dispose()
        editor.dispose()
      }
    })
  }

  test('accepts trusted hydration remaps but rejects an authored policy change after preparation', async () => {
    const { graph, home } = applicationModeFixture(true)
    const editor = createEditor({ graph })
    const { source } = observedSourcePreparation(
      editor,
      () => true,
      async () => {
        graph.applyImportedStateDuring(() =>
          graph.updateNode(graph.rootId, {
            lowcodeApplication: { version: 1, enabled: true, startPageId: home.id }
          })
        )
      }
    )
    try {
      expect(await source.prepare()).toBe(true)
      expect(source.isCurrent()).toBe(true)
      graph.updateNode(graph.rootId, {
        lowcodeApplication: { version: 1, enabled: false, startPageId: home.id }
      })
      expect(source.isCurrent()).toBe(false)
    } finally {
      source.dispose()
      editor.dispose()
    }
  })
})
