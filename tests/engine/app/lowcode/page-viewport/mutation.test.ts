import { describe, expect, test } from 'bun:test'

import { computed, effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import { markNewMobileTemplateViewport } from '@/app/lowcode/backend/responsive/page-viewport'
import { setPageViewportMode } from '@/app/lowcode/page-viewport/mutation'
import { usePageViewportSelection } from '@/app/lowcode/page-viewport/use'

function fixture() {
  const editor = createEditor()
  const page = editor.graph.getPages()[0]
  const frame = editor.graph.createNode('FRAME', page.id, {
    x: 24,
    y: 30,
    width: 360,
    height: 740,
    layoutMode: 'NONE'
  })
  const label = editor.graph.createNode('TEXT', frame.id, {
    x: 20,
    y: 36,
    width: 220,
    height: 48,
    text: 'Retained design'
  })
  return { editor, page, frame, label }
}

describe('page viewport editing', () => {
  test.each([...(['responsive', 'fit-width', 'fixed'] as const)])(
    '%s changes only page metadata and is one reversible edit',
    (mode) => {
      const { editor, page, frame, label } = fixture()
      const geometry = structuredClone([frame, label])
      expect(setPageViewportMode(editor, page, mode, 'Device adaptation')).toBe(true)
      expect(page.lowcodePageViewport).toEqual({ version: 1, mode })
      expect([frame, label]).toEqual(geometry)
      expect(setPageViewportMode(editor, page, mode, 'Device adaptation')).toBe(false)
      editor.undo.undo()
      expect(page.lowcodePageViewport).toBeUndefined()
      expect([frame, label]).toEqual(geometry)
      editor.undo.redo()
      expect(page.lowcodePageViewport).toEqual({ version: 1, mode })
    }
  )

  test('explicit replacement clears only the reserved inert entry in the same undo', () => {
    const { editor, page } = fixture()
    const opaque = { pluginId: 'other-plugin', key: 'keep', value: 'opaque value' }
    const raw = {
      pluginId: 'open-pencil',
      key: LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY,
      value: '{"version":2}'
    }
    editor.graph.updateNode(page.id, { pluginData: [opaque, raw] })
    expect(setPageViewportMode(editor, page, 'fit-width', 'Device adaptation')).toBe(true)
    expect(page.pluginData).toEqual([opaque])
    editor.undo.undo()
    expect(page.lowcodePageViewport).toBeUndefined()
    expect(page.pluginData).toEqual([opaque, raw])
    editor.undo.redo()
    expect(page.lowcodePageViewport).toEqual({ version: 1, mode: 'fit-width' })
    expect(page.pluginData).toEqual([opaque])
  })

  test.each([...(['locked', 'internalOnly', 'library'] as const)])(
    '%s page and document ancestors reject editing',
    (kind) => {
      for (const target of ['page', 'document']) {
        const { editor, page } = fixture()
        const id = target === 'page' ? page.id : editor.graph.rootId
        const patch =
          kind === 'library'
            ? {
                librarySource: {
                  identity: { libraryId: 'read-only', assetKey: 'page', revisionId: '1' },
                  sourceNodeId: null,
                  readOnly: true
                }
              }
            : { [kind]: true }
        editor.graph.updateNode(id, patch)
        expect(setPageViewportMode(editor, page, 'responsive', 'Device adaptation')).toBe(false)
        expect(page.lowcodePageViewport).toBeUndefined()
      }
    }
  )

  test('invalid modes, non-pages, stale active pages, and malformed ancestry do not mutate', () => {
    const { editor, page, frame } = fixture()
    expect(setPageViewportMode(editor, page, 'stretch', 'Device adaptation')).toBe(false)
    expect(setPageViewportMode(editor, frame, 'responsive', 'Device adaptation')).toBe(false)
    const second = editor.graph.createNode('CANVAS', editor.graph.rootId)
    editor.state.currentPageId = second.id
    expect(setPageViewportMode(editor, page, 'responsive', 'Device adaptation')).toBe(false)
    editor.state.currentPageId = page.id
    const document = editor.graph.getNode(editor.graph.rootId)
    if (!document) throw new Error('Missing document')
    try {
      document.parentId = page.id
      expect(setPageViewportMode(editor, page, 'responsive', 'Device adaptation')).toBe(false)
    } finally {
      document.parentId = null
    }
    expect(page.lowcodePageViewport).toBeUndefined()
  })

  test('a captured select cannot revive after deactivation or a page switch', () => {
    const { editor, page } = fixture()
    const owner = shallowRef<SceneNode | undefined>(page)
    const source = shallowRef<unknown>({ mode: undefined })
    const active = ref(true)
    const scope = effectScope()
    try {
      const selection = scope.run(() =>
        usePageViewportSelection(editor, owner, source, active, () => 'Device adaptation')
      )
      if (!selection) throw new Error('Missing viewport selection')
      const first = selection.value.select
      expect(selection.value.mode).toBe('fixed')
      active.value = false
      active.value = true
      first('responsive')
      expect(page.lowcodePageViewport).toBeUndefined()

      const beforeSwitch = selection.value.select
      const second = editor.graph.createNode('CANVAS', editor.graph.rootId)
      editor.state.currentPageId = second.id
      owner.value = second
      beforeSwitch('fit-width')
      expect(second.lowcodePageViewport).toBeUndefined()
      selection.value.select('responsive')
      expect(second.lowcodePageViewport?.mode).toBe('responsive')

      const afterSwitch = selection.value.select
      scope.stop()
      afterSwitch('fixed')
      expect(second.lowcodePageViewport?.mode).toBe('responsive')
    } finally {
      scope.stop()
    }
  })

  test('external configuration changes invalidate a previously rendered select', () => {
    const { editor, page } = fixture()
    const owner = shallowRef<SceneNode | undefined>(page)
    const source = shallowRef<unknown>(page.lowcodePageViewport)
    const scope = effectScope()
    try {
      const selection = scope.run(() =>
        usePageViewportSelection(
          editor,
          owner,
          computed(() => source.value),
          undefined,
          () => 'Device adaptation'
        )
      )
      if (!selection) throw new Error('Missing viewport selection')
      const previous = selection.value.select
      editor.graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode: 'fixed' } })
      source.value = page.lowcodePageViewport
      previous('responsive')
      expect(page.lowcodePageViewport?.mode).toBe('fixed')
    } finally {
      scope.stop()
    }
  })
})

describe('fresh mobile template viewport defaults', () => {
  test('fills only a missing page setting without changing the design', () => {
    const { editor, page, frame, label } = fixture()
    const geometry = structuredClone([frame, label])
    markNewMobileTemplateViewport(editor, frame.id)
    expect(page.lowcodePageViewport).toEqual({ version: 1, mode: 'responsive' })
    expect([frame, label]).toEqual(geometry)
    editor.undo.undo()
    expect(page.lowcodePageViewport).toBeUndefined()
  })

  test.each([...(['fixed', 'fit-width'] as const)])('preserves an explicit %s setting', (mode) => {
    const { editor, page, frame } = fixture()
    editor.graph.updateNode(page.id, { lowcodePageViewport: { version: 1, mode } })
    markNewMobileTemplateViewport(editor, frame.id)
    expect(page.lowcodePageViewport).toEqual({ version: 1, mode })
  })

  test('preserves future structured and inert values without automatic replacement', () => {
    const { editor, page, frame } = fixture()
    const future = { version: 2, mode: 'future' }
    Reflect.set(page, 'lowcodePageViewport', future)
    markNewMobileTemplateViewport(editor, frame.id)
    expect<unknown>(page.lowcodePageViewport).toBe(future)
    editor.graph.clearNodeFields(page.id, ['lowcodePageViewport'])
    const raw = { pluginId: 'open-pencil', key: LOWCODE_PAGE_VIEWPORT_PLUGIN_KEY, value: 'future' }
    editor.graph.updateNode(page.id, { pluginData: [raw] })
    markNewMobileTemplateViewport(editor, frame.id)
    expect(page.lowcodePageViewport).toBeUndefined()
    expect(page.pluginData).toEqual([raw])
  })
})
