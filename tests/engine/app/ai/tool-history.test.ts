import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createAITools, resetRunSteps } from '@/app/ai/tools'
import { createCodePenStaticEvidence, getCodePenAIManager } from '@/app/codepen'
import { createEditorStore } from '@/app/editor/session'

type ExecutableTool = {
  execute(
    args: Record<string, unknown>,
    execution?: { abortSignal?: AbortSignal }
  ): Promise<unknown>
}

let previousWindow: typeof globalThis.window | undefined

beforeEach(() => {
  previousWindow = globalThis.window
  Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } })
})

afterEach(() => {
  if (previousWindow) Object.assign(globalThis, { window: previousWindow })
  else Reflect.deleteProperty(globalThis, 'window')
})

function executable(tools: ReturnType<typeof createAITools>, name: string): ExecutableTool {
  return tools[name] as ExecutableTool
}

describe('AI tool history', () => {
  test('blocks live mutation tools while a CodePen shadow reconstruction is active', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    const manager = getCodePenAIManager(store)
    const evidence = await createCodePenStaticEvidence({
      penURL: 'https://codepen.io/openpencil/pen/safeshadow',
      sources: {
        html: '<main><h1>Reference</h1></main>',
        css: 'main { display: block; }',
        js: ''
      }
    })
    const registered = await manager.registerEvidence(evidence)
    const draft = await manager.createShadowDraft(registered.evidenceDigest)
    const render = executable(createAITools(store), 'render')

    await expect(
      render.execute({ jsx: '<Rectangle name="Must stay detached" w={100} h={80} />' })
    ).resolves.toEqual({
      error:
        'Live-document mutation tools are disabled while a CodePen shadow reconstruction is active. Seal, review, or discard the shadow draft first.'
    })
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toEqual([])

    await manager.discardShadowDraft({
      draftId: draft.draftId,
      evidenceDigest: draft.evidenceDigest
    })
    await render.execute({ jsx: '<Rectangle name="Allowed after discard" w={100} h={80} />' })
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toHaveLength(1)
  })

  test('coalesces all mutating tools in one model turn into one page snapshot entry', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    const snapshotPage = store.snapshotPage
    let snapshotCount = 0
    store.snapshotPage = () => {
      snapshotCount++
      return snapshotPage()
    }
    resetRunSteps(store)
    const tools = createAITools(store)
    const render = executable(tools, 'render')

    await render.execute({
      jsx: '<Rectangle name="First AI shape" x={0} y={0} w={100} h={80} />'
    })
    await render.execute({
      jsx: '<Rectangle name="Second AI shape" x={120} y={0} w={100} h={80} />'
    })

    const page = store.graph.getNode(store.state.currentPageId)
    expect(page?.childIds).toHaveLength(2)
    expect(store.undo.undoLabel).toBe('AI: render')
    expect(snapshotCount).toBe(3)

    store.undo.undo()
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toEqual([])

    store.undo.redo()
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toHaveLength(2)
  })

  test('undo restores the AI transaction page after switching pages', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const render = executable(createAITools(store), 'render')
    const firstPageId = store.state.currentPageId

    await render.execute({ jsx: '<Rectangle name="First page AI" w={100} h={80} />' })
    const secondPageId = store.addPage('Second page')
    await store.switchPage(secondPageId)
    store.undo.undo()

    expect(store.state.currentPageId).toBe(secondPageId)
    expect(store.graph.getNode(firstPageId)?.childIds).toEqual([])
  })

  test('does not coalesce across an intervening manual history entry', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const render = executable(createAITools(store), 'render')
    const pageId = store.state.currentPageId

    await render.execute({ jsx: '<Rectangle name="First AI" w={100} h={80} />' })
    const manual = store.graph.createNode('RECTANGLE', pageId, { name: 'Manual edit' })
    store.pushUndoEntry({
      label: 'Manual edit',
      forward: () => undefined,
      inverse: () => store.graph.deleteNode(manual.id)
    })
    await render.execute({ jsx: '<Rectangle name="Second AI" w={100} h={80} />' })

    store.undo.undo()
    const names = store.graph.getChildren(pageId).map((node) => node.name)
    expect(names).toContain('First AI')
    expect(names).toContain('Manual edit')
    expect(names).not.toContain('Second AI')
  })

  test('does not capture a concurrent manual edit in a successful AI undo entry', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const pageId = store.state.currentPageId
    const target = store.graph.createNode('RECTANGLE', pageId, { name: 'Before' })
    const update = executable(createAITools(store), 'update_node')
    let manualNodeId = ''
    setTimeout(() => {
      const manual = store.graph.createNode('RECTANGLE', pageId, { name: 'Manual during AI' })
      manualNodeId = manual.id
      store.pushUndoEntry({
        label: 'Manual during AI',
        forward: () => undefined,
        inverse: () => store.graph.deleteNode(manual.id)
      })
    }, 0)

    await update.execute({ id: target.id, name: 'After' })

    expect(store.graph.getNode(target.id)?.name).toBe('After')
    expect(store.graph.getNode(manualNodeId)?.name).toBe('Manual during AI')
    expect(store.undo.undoLabel).toBe('Manual during AI')
    store.undo.undo()
    expect(store.graph.getNode(manualNodeId)).toBeUndefined()
    expect(store.graph.getNode(target.id)?.name).toBe('After')
  })

  test('does not roll back concurrent manual history when AI postprocessing is cancelled', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const pageId = store.state.currentPageId
    const target = store.graph.createNode('RECTANGLE', pageId, { name: 'Before' })
    const update = executable(createAITools(store), 'update_node')
    const controller = new AbortController()
    let manualNodeId = ''
    setTimeout(() => {
      const manual = store.graph.createNode('RECTANGLE', pageId, { name: 'Manual during cancel' })
      manualNodeId = manual.id
      store.pushUndoEntry({
        label: 'Manual during cancel',
        forward: () => undefined,
        inverse: () => store.graph.deleteNode(manual.id)
      })
      controller.abort()
    }, 0)

    const error = await update
      .execute({ id: target.id, name: 'After' }, { abortSignal: controller.signal })
      .catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.getNode(target.id)?.name).toBe('After')
    expect(store.graph.getNode(manualNodeId)?.name).toBe('Manual during cancel')
    expect(store.undo.undoLabel).toBe('Manual during cancel')
    store.undo.undo()
    expect(store.graph.getNode(manualNodeId)).toBeUndefined()
    expect(store.graph.getNode(target.id)?.name).toBe('After')
  })

  test('keeps a single-page batch update in page-scoped history', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const target = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Before'
    })
    const originalSnapshotDocument = store.snapshotDocument
    let documentSnapshots = 0
    store.snapshotDocument = () => {
      documentSnapshots++
      return originalSnapshotDocument()
    }
    const batch = executable(createAITools(store), 'batch_update')

    await batch.execute({
      operations: JSON.stringify([{ id: target.id, props: { name: 'After' } }])
    })

    expect(store.graph.getNode(target.id)?.name).toBe('After')
    expect(documentSnapshots).toBe(0)
    store.undo.undo()
    expect(store.graph.getNode(target.id)?.name).toBe('Before')
  })

  test('cancels a large render without leaving partial nodes or undo history', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const render = executable(createAITools(store), 'render')
    const controller = new AbortController()
    const children = Array.from(
      { length: 180 },
      (_, index) => `<Rectangle name="Item ${index}" w={20} h={20} />`
    ).join('')
    let manualNodeId = ''
    setTimeout(() => {
      manualNodeId = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
        name: 'Manual during AI'
      }).id
      controller.abort()
    }, 0)

    const error = await render
      .execute(
        { jsx: `<Frame name="Cancelled">${children}</Frame>` },
        { abortSignal: controller.signal }
      )
      .catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.getNode(store.state.currentPageId)?.childIds).toEqual([manualNodeId])
    expect(store.graph.getNode(manualNodeId)?.name).toBe('Manual during AI')
    expect(store.undo.canUndo).toBe(false)
  })

  test('undo and redo restore document-level lowcode metadata', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const setStates = executable(createAITools(store), 'set_doc_states')

    await setStates.execute({
      states_json: JSON.stringify([
        { id: 'doc-count', name: 'count', type: 'number', defaultValue: 0 }
      ])
    })
    expect(store.graph.getNode(store.graph.rootId)?.lowcodeDocumentState).toHaveLength(1)

    store.undo.undo()
    expect(store.graph.getNode(store.graph.rootId)?.lowcodeDocumentState).toBeUndefined()

    store.undo.redo()
    expect(store.graph.getNode(store.graph.rootId)?.lowcodeDocumentState).toHaveLength(1)
  })

  test('does not restore or create history for a rejected validation result', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    let restoreCount = 0
    const restore = store.restorePageFromSnapshot
    store.restorePageFromSnapshot = (...args) => {
      restoreCount++
      return restore(...args)
    }
    const setStates = executable(createAITools(store), 'set_doc_states')

    const result = (await setStates.execute({ states_json: '{invalid json' })) as {
      ok?: boolean
    }

    expect(result.ok).toBe(false)
    expect(restoreCount).toBe(0)
    expect(store.undo.canUndo).toBe(false)
  })

  test('eval uses a document snapshot so page creation is undoable', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const evaluate = executable(createAITools(store), 'eval')

    await evaluate.execute({ code: 'figma.createPage(); return { ok: true }' })
    expect(store.graph.getPages()).toHaveLength(2)

    store.undo.undo()
    expect(store.graph.getPages()).toHaveLength(1)

    store.undo.redo()
    expect(store.graph.getPages()).toHaveLength(2)
  })

  test('resolves a node target on another page for undo', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const firstPageId = store.state.currentPageId
    const secondPage = store.graph.addPage('Second page')
    const target = store.graph.createNode('RECTANGLE', secondPage.id, { name: 'Before' })
    const update = executable(createAITools(store), 'update_node')

    await update.execute({ id: target.id, name: 'After' })
    expect(store.graph.getNode(target.id)?.name).toBe('After')

    store.undo.undo()
    expect(store.state.currentPageId).toBe(firstPageId)
    expect(store.graph.getNode(target.id)?.name).toBe('Before')
  })

  test('document undo preserves a later valid page and selection', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const secondPage = store.graph.addPage('Second page')
    const selected = store.graph.createNode('RECTANGLE', secondPage.id, { name: 'Selected' })
    const evaluate = executable(createAITools(store), 'eval')

    await evaluate.execute({ code: 'figma.createPage(); return { ok: true }' })
    const createdPageId = store.graph.getPages().at(-1)?.id
    await store.switchPage(secondPage.id)
    store.select([selected.id])
    store.undo.undo()

    expect(store.state.currentPageId).toBe(secondPage.id)
    expect(store.state.selectedIds).toEqual(new Set([selected.id]))
    expect(store.graph.getNode(createdPageId ?? '')).toBeUndefined()
  })

  test('eval detects variable map changes that do not emit node events', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const evaluate = executable(createAITools(store), 'eval')

    await evaluate.execute({
      code: "figma.createVariableCollection('Temporary'); return { ok: true }"
    })
    expect(store.graph.variableCollections.size).toBe(1)

    store.undo.undo()
    expect(store.graph.variableCollections.size).toBe(0)
  })

  test('uses a document snapshot when deleting a page and protects the last page', async () => {
    const store = createEditorStore()
    store.aiFlashDone = () => undefined
    resetRunSteps(store)
    const remove = executable(createAITools(store), 'delete_node')
    const firstPageId = store.state.currentPageId
    const secondPage = store.graph.addPage('Second page')

    await remove.execute({ id: secondPage.id })
    expect(store.graph.getPages().map((page) => page.id)).toEqual([firstPageId])
    store.undo.undo()
    expect(store.graph.getPages().map((page) => page.id)).toEqual([firstPageId, secondPage.id])

    store.undo.redo()
    const rejected = (await remove.execute({ id: firstPageId })) as { ok?: boolean }
    expect(rejected.ok).toBe(false)
    expect(store.graph.getPages().map((page) => page.id)).toEqual([firstPageId])
  })
})
