import { describe, expect, mock, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createReloadActions } from '@/app/document/io/read'
import { captureReloadState, resolveReloadPageId } from '@/app/document/io/reload-state'

function graphWithPages(pages: Array<{ name: string; sourceId: string }>) {
  const graph = new SceneGraph()
  const firstPage = graph.getPages()[0]
  graph.updateNode(firstPage.id, {
    name: pages[0]?.name ?? 'Page 1',
    source: { ...firstPage.source, id: pages[0]?.sourceId ?? 'page-1' }
  })
  for (const page of pages.slice(1)) {
    const node = graph.addPage(page.name)
    graph.updateNode(node.id, { source: { ...node.source, id: page.sourceId } })
  }
  return graph
}

describe('document reload', () => {
  test('restores a regenerated page by stable source identity', () => {
    const original = graphWithPages([
      { name: 'Foundations', sourceId: 'source-1' },
      { name: 'Components', sourceId: 'source-2' }
    ])
    const editor = createEditor({ graph: original, skipInitialGraphSetup: true })
    editor.state.currentPageId = original.getPages()[1].id
    const snapshot = captureReloadState(editor, editor.state)

    const reimported = graphWithPages([
      { name: 'Foundations', sourceId: 'source-1' },
      { name: 'Components renamed', sourceId: 'source-2' }
    ])

    expect(resolveReloadPageId(reimported, snapshot)).toBe(reimported.getPages()[1].id)
  })

  test('coalesces overlapping watch reloads and applies only the latest read', async () => {
    const original = graphWithPages([{ name: 'Original', sourceId: 'source-1' }])
    const stale = graphWithPages([{ name: 'Stale', sourceId: 'source-1' }])
    const latest = graphWithPages([{ name: 'Latest', sourceId: 'source-1' }])
    const editor = createEditor({ graph: original, skipInitialGraphSetup: true })
    const reads = [
      Promise.withResolvers<SceneGraph | null>(),
      Promise.withResolvers<SceneGraph | null>()
    ]
    const firstStarted = Promise.withResolvers<undefined>()
    const secondStarted = Promise.withResolvers<undefined>()
    let activeReads = 0
    let maxActiveReads = 0
    let readIndex = 0
    const readSource = mock(async () => {
      const index = readIndex++
      activeReads++
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      ;(index === 0 ? firstStarted : secondStarted).resolve(undefined)
      try {
        return await reads[index].promise
      } finally {
        activeReads--
      }
    })
    const computeLayouts = mock(async () => undefined)
    const setSavedVersion = mock(() => undefined)
    const replaceGraph = mock(editor.replaceGraph)
    editor.replaceGraph = replaceGraph
    const { reloadFromDisk } = createReloadActions(
      {
        editor,
        state: editor.state,
        getFilePath: () => '/tmp/design.fig',
        getFileHandle: () => null,
        setSavedVersion
      },
      { readSource, computeLayouts }
    )

    const first = reloadFromDisk()
    await firstStarted.promise
    const second = reloadFromDisk()

    reads[0].resolve(stale)
    await secondStarted.promise
    expect(replaceGraph).not.toHaveBeenCalled()

    reads[1].resolve(latest)
    await Promise.all([first, second])

    expect(maxActiveReads).toBe(1)
    expect(readSource).toHaveBeenCalledTimes(2)
    expect(computeLayouts).toHaveBeenCalledTimes(1)
    expect(replaceGraph).toHaveBeenCalledTimes(1)
    expect(editor.graph).toBe(latest)
    expect(editor.state.currentPageId).toBe(latest.getPages()[0].id)
    expect(editor.state.loading).toBe(false)
    expect(setSavedVersion).toHaveBeenCalledTimes(1)
  })

  test('keeps the restored page observable during graph replacement', async () => {
    const original = graphWithPages([
      { name: 'First', sourceId: 'source-1' },
      { name: 'Target', sourceId: 'source-2' }
    ])
    const targetPage = original.getPages()[1]
    const imported = graphWithPages([
      { name: 'First reloaded', sourceId: 'source-1' },
      { name: 'Target reloaded', sourceId: 'source-2' }
    ])
    const importedTargetPage = imported.getPages()[1]
    const editor = createEditor({ graph: original, skipInitialGraphSetup: true })
    editor.state.currentPageId = targetPage.id
    let pageAtGraphReplacement: string | null = null
    const pageChanges: string[] = []
    editor.onEditorEvent('graph:replaced', () => {
      pageAtGraphReplacement = editor.state.currentPageId
    })
    editor.onEditorEvent('page:changed', (pageId) => pageChanges.push(pageId))
    const { reloadFromDisk } = createReloadActions(
      {
        editor,
        state: editor.state,
        getFilePath: () => '/tmp/design.fig',
        getFileHandle: () => null,
        setSavedVersion: () => undefined
      },
      {
        readSource: async () => imported,
        computeLayouts: async () => undefined
      }
    )

    await reloadFromDisk()

    expect(editor.state.currentPageId).toBe(importedTargetPage.id)
    expect(pageAtGraphReplacement).toBe(importedTargetPage.id)
    expect(pageChanges).toEqual([importedTargetPage.id])
  })

  test('does not lose a reload requested while the previous runner settles', async () => {
    const original = graphWithPages([{ name: 'Original', sourceId: 'source-1' }])
    const firstReload = graphWithPages([{ name: 'First reload', sourceId: 'source-1' }])
    const latest = graphWithPages([{ name: 'Latest', sourceId: 'source-1' }])
    const editor = createEditor({ graph: original, skipInitialGraphSetup: true })
    const imported = [firstReload, latest]
    const readSource = mock(async () => imported.shift() ?? null)
    const actions = createReloadActions(
      {
        editor,
        state: editor.state,
        getFilePath: () => '/tmp/design.fig',
        getFileHandle: () => null,
        setSavedVersion: () => undefined
      },
      { readSource, computeLayouts: async () => undefined }
    )
    let settlementReload: Promise<void> | null = null
    let requestedDuringSettlement = false
    editor.onEditorEvent('repaint:requested', () => {
      if (requestedDuringSettlement) return
      requestedDuringSettlement = true
      settlementReload = actions.reloadFromDisk()
    })

    await actions.reloadFromDisk()
    if (!settlementReload) throw new Error('Expected a reload during runner settlement')
    await settlementReload

    expect(readSource).toHaveBeenCalledTimes(2)
    expect(editor.graph).toBe(latest)
    expect(editor.state.loading).toBe(false)
  })

  test('a failed current reload settles and can be retried', async () => {
    const original = graphWithPages([{ name: 'Original', sourceId: 'source-1' }])
    const latest = graphWithPages([{ name: 'Latest', sourceId: 'source-1' }])
    const editor = createEditor({ graph: original, skipInitialGraphSetup: true })
    const readSource = mock()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(latest)
    const actions = createReloadActions(
      {
        editor,
        state: editor.state,
        getFilePath: () => '/tmp/design.fig',
        getFileHandle: () => null,
        setSavedVersion: () => undefined
      },
      { readSource, computeLayouts: async () => undefined }
    )

    await expect(actions.reloadFromDisk()).rejects.toThrow('read failed')
    expect(editor.state.loading).toBe(false)
    await expect(actions.reloadFromDisk()).resolves.toBeUndefined()

    expect(readSource).toHaveBeenCalledTimes(2)
    expect(editor.graph).toBe(latest)
    expect(editor.state.loading).toBe(false)
  })
})
