import { afterEach, describe, expect, test } from 'bun:test'

import { createModalModuleInstance } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  clearInMemoryClipboardHTML,
  getInMemoryClipboardHTML,
  setInMemoryClipboardHTML
} from '@/app/editor/clipboard/memory'
import { pasteClipboardToReplace } from '@/app/editor/clipboard/paste-to-replace'
import { createBrowserSystemClipboard } from '@/app/editor/clipboard/system/browser'
import type { BrowserClipboardReadResult } from '@/app/editor/clipboard/system/types'
import { createEditorStore } from '@/app/editor/session/create'

const stores: ReturnType<typeof createEditorStore>[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
  clearInMemoryClipboardHTML()
})

async function fixture() {
  const store = createEditorStore()
  stores.push(store)
  store.onEditorEvent('render:requested', ({ sceneVersion }) => {
    store.preparationController.acknowledgePresentation(sceneVersion)
  })
  const source = store.createShape('RECTANGLE', 0, 0, 24, 24, undefined, 'Clipboard source')
  store.select([source])
  const html = (await store.prepareCopy()).html
  function body(name: string) {
    const host = store.createShape('FRAME', 100, 100, 200, 52, undefined, name, {
      interactiveProps: { module: createModalModuleInstance({ contentChildName: 'Body' }) }
    })
    return store.createShape('FRAME', 0, 0, 400, 300, host, 'Body')
  }
  const first = body('First dialog')
  const second = body('Second dialog')
  const otherPage = store.graph.addPage('Other page').id
  store.enterContentEdit(first)
  return { store, html, first, second, otherPage }
}

const changes = ['exit', 'other-content', 'other-page', 'reenter', 'replace-document'] as const
type ScopeChange = (typeof changes)[number]

async function changeScope(context: Awaited<ReturnType<typeof fixture>>, change: ScopeChange) {
  const { store, first, second, otherPage } = context
  if (change === 'other-content') store.enterContentEdit(second)
  else if (change === 'other-page') await store.switchPage(otherPage)
  else if (change === 'replace-document') store.replaceGraph(new SceneGraph())
  else {
    store.exitContentEdit()
    if (change === 'reenter') store.enterContentEdit(first)
  }
}

describe('system clipboard content editing boundary', () => {
  test.each(changes)('late browser clipboard read is cancelled after %s', async (change) => {
    const context = await fixture()
    const { store, html } = context
    setInMemoryClipboardHTML(html)
    const read = Promise.withResolvers<BrowserClipboardReadResult>()
    const clipboard = createBrowserSystemClipboard({
      write: async () => true,
      readHTML: () => read.promise
    })
    const pending = clipboard.paste(store)
    await changeScope(context, change)
    const before = store.snapshotDocument()
    const selection = new Set(store.state.selectedIds)
    read.resolve({ available: true, html })
    expect(await pending).toBe(false)
    expect(store.documentSnapshotChanged(before)).toBe(false)
    expect(store.state.selectedIds).toEqual(selection)
    expect(getInMemoryClipboardHTML()).toBe(html)
  })

  test.each(changes)(
    'late paste-to-replace read cannot delete content after %s',
    async (change) => {
      const context = await fixture()
      const { store, html, first } = context
      const original = store.createShape('RECTANGLE', 0, 0, 40, 40, first, 'Preserve this content')
      store.select([original])
      const read = Promise.withResolvers<string | null>()
      const pending = pasteClipboardToReplace(store, () => read.promise)
      await changeScope(context, change)
      const before = store.snapshotDocument()
      const selection = new Set(store.state.selectedIds)
      read.resolve(html)
      await pending
      expect(store.documentSnapshotChanged(before)).toBe(false)
      expect(store.state.selectedIds).toEqual(selection)
    }
  )

  test('an unchanged content view accepts the delayed read into its body', async () => {
    const { store, html, first } = await fixture()
    const read = Promise.withResolvers<BrowserClipboardReadResult>()
    const clipboard = createBrowserSystemClipboard({
      write: async () => true,
      readHTML: () => read.promise
    })
    const pending = clipboard.paste(store)
    read.resolve({ available: true, html })
    expect(await pending).toBe(true)
    const created = store.graph.getNode([...store.state.selectedIds][0])
    expect(created?.name).toBe('Clipboard source')
    expect(created?.parentId).toBe(first)
  })

  test('paste-to-replace still replaces and undoes within the original content view', async () => {
    const { store, html, first } = await fixture()
    const original = store.createShape('RECTANGLE', 0, 0, 40, 40, first, 'Replace this content')
    store.select([original])
    const read = Promise.withResolvers<string | null>()
    const pending = pasteClipboardToReplace(store, () => read.promise)
    read.resolve(html)
    await pending
    const created = store.graph.getNode([...store.state.selectedIds][0])
    expect(created?.parentId).toBe(first)
    expect(created?.name).toBe('Clipboard source')
    expect(store.graph.getNode(original)).toBeUndefined()
    store.undo.undo()
    expect(store.graph.getNode(original)?.name).toBe('Replace this content')
  })

  test('unavailable delayed reads cannot fall back to memory in a different view', async () => {
    const context = await fixture()
    const { store, html } = context
    setInMemoryClipboardHTML(html)
    const read = Promise.withResolvers<BrowserClipboardReadResult>()
    const clipboard = createBrowserSystemClipboard({
      write: async () => true,
      readHTML: () => read.promise
    })
    const pending = clipboard.paste(store)
    await changeScope(context, 'exit')
    const before = store.snapshotDocument()
    read.resolve({ available: false })
    expect(await pending).toBe(false)
    expect(store.documentSnapshotChanged(before)).toBe(false)
    expect(getInMemoryClipboardHTML()).toBe(html)
  })
})
