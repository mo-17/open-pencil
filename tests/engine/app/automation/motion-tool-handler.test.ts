import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'

function setup() {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Expected current page')
  const ids = [0, 1].map(
    (index) =>
      store.graph.createNode('RECTANGLE', page.id, {
        x: index * 120,
        y: 0,
        width: 100,
        height: 80
      }).id
  )
  const flashed: string[][] = []
  store.flashNodes = (nodeIds) => flashed.push([...nodeIds])
  const target: AutomationTarget = {
    store,
    documentId: 'motion-automation-test',
    documentName: 'Motion automation test',
    pageId: page.id,
    pageName: page.name
  }
  const handle = createAutomationToolHandler((currentStore) => new FigmaAPI(currentStore.graph))
  return { flashed, handle, ids, store, target }
}

describe('automation Motion tool handler', () => {
  test('applies and flashes nested Motion tool result ids in one undo step', async () => {
    const { flashed, handle, ids, store, target } = setup()
    const response = await handle(target, {
      name: 'apply_motion_preset',
      args: { nodeIds: ids, preset: 'slide-up', staggerMs: 40 }
    })

    expect(response).toEqual({
      ok: true,
      result: { ok: true, data: { nodeIds: ids, preset: 'slide-up' } }
    })
    expect(flashed).toEqual([ids])
    expect(ids.map((id) => store.graph.getNode(id)?.motion?.tracks[0]?.timing.delayMs)).toEqual([
      0, 40
    ])
    expect(store.undo.undoLabel).toBe('AI: apply_motion_preset')

    store.undo.undo()
    expect(ids.map((id) => store.graph.getNode(id)?.motion)).toEqual([undefined, undefined])
  })

  test('returns an explicit nested tool failure without flashing or mutating', async () => {
    const { flashed, handle, ids, store, target } = setup()
    const response = await handle(target, {
      name: 'apply_motion_spec',
      args: { nodeIds: ids, specJson: '{invalid' }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { ok: false, error: expect.stringContaining('valid JSON') }
    })
    expect(flashed).toEqual([])
    expect(ids.map((id) => store.graph.getNode(id)?.motion)).toEqual([undefined, undefined])
    expect(store.undo.canUndo).toBe(false)
  })

  test('rejects an already-cancelled mutation before it writes to the graph', async () => {
    const { flashed, handle, ids, store, target } = setup()
    const controller = new AbortController()
    controller.abort()

    const outcome = handle(
      target,
      {
        name: 'apply_motion_preset',
        args: { nodeIds: ids, preset: 'slide-up', staggerMs: 40 }
      },
      { signal: controller.signal }
    ).catch((error: Error) => error)

    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(flashed).toEqual([])
    expect(ids.map((id) => store.graph.getNode(id)?.motion)).toEqual([undefined, undefined])
    expect(store.undo.canUndo).toBe(false)
  })

  test('serializes concurrent mutations so undo batches cannot cross', async () => {
    const { handle, ids, store, target } = setup()
    const secondHandle = createAutomationToolHandler(
      (currentStore) => new FigmaAPI(currentStore.graph)
    )

    await Promise.all([
      secondHandle(target, {
        name: 'apply_motion_preset',
        args: { nodeIds: [ids[0]], preset: 'slide-up' }
      }),
      handle(target, {
        name: 'apply_motion_preset',
        args: { nodeIds: [ids[1]], preset: 'fade-in' }
      })
    ])

    expect(ids.map((id) => store.graph.getNode(id)?.motion?.preset?.id)).toEqual([
      'slide-up',
      'fade-in'
    ])
    store.undo.undo()
    expect(ids.map((id) => store.graph.getNode(id)?.motion?.preset?.id)).toEqual([
      'slide-up',
      undefined
    ])
    store.undo.undo()
    expect(ids.map((id) => store.graph.getNode(id)?.motion)).toEqual([undefined, undefined])
  })

  test('cancels a large render tree and restores the page snapshot', async () => {
    const { handle, ids, store, target } = setup()
    const controller = new AbortController()
    const tree = {
      type: 'frame',
      props: { name: 'Cancelled automation root' },
      children: Array.from({ length: 180 }, (_, index) => ({
        type: 'rectangle',
        props: { name: `Item ${index}`, w: 20, h: 20 },
        children: []
      }))
    }
    setTimeout(() => controller.abort(), 0)

    const error = await handle(
      target,
      { name: 'render', args: { tree } },
      { signal: controller.signal }
    ).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(ids)
  })

  test('rolls back a cancelled document map mutation without a scene event', async () => {
    const { handle, store, target } = setup()
    const controller = new AbortController()
    queueMicrotask(() => controller.abort())

    const error = await handle(
      target,
      { name: 'create_collection', args: { name: 'Cancelled collection' } },
      { signal: controller.signal }
    ).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.variableCollections.size).toBe(0)
  })

  test('rolls back a cancelled mutation targeting another page', async () => {
    const { handle, store, target } = setup()
    const otherPage = store.graph.addPage('Other page')
    const otherNode = store.graph.createNode('RECTANGLE', otherPage.id, { name: 'Before' })
    const controller = new AbortController()
    queueMicrotask(() => controller.abort())

    const error = await handle(
      target,
      { name: 'update_node', args: { id: otherNode.id, name: 'After' } },
      { signal: controller.signal }
    ).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.getNode(otherNode.id)?.name).toBe('Before')
  })

  test('renders and lays out against the actual cross-page parent', async () => {
    const { handle, ids, store, target } = setup()
    const otherPage = store.graph.addPage('Render destination')
    const parent = store.graph.createNode('FRAME', otherPage.id, {
      name: 'Destination row',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      width: 300,
      height: 80,
      paddingLeft: 5,
      itemSpacing: 10
    })
    const existing = store.graph.createNode('RECTANGLE', parent.id, { width: 20, height: 20 })

    const response = await handle(target, {
      name: 'render',
      args: {
        parent_id: parent.id,
        tree: {
          type: 'rectangle',
          props: { name: 'Cross-page render', w: 30, h: 20 },
          children: []
        }
      }
    })

    expect(response).toMatchObject({ ok: true, result: { name: 'Cross-page render' } })
    const rendered = store.graph
      .getChildren(parent.id)
      .find((node) => node.name === 'Cross-page render')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(ids)
    expect(existing.x).toBe(5)
    expect(rendered?.x).toBe(35)
  })

  test('restores the actual parent page when cross-page render layout is cancelled', async () => {
    const { handle, store, target } = setup()
    const otherPage = store.graph.addPage('Cancelled destination')
    const parent = store.graph.createNode('FRAME', otherPage.id, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      width: 300,
      height: 80
    })
    const existing = store.graph.createNode('RECTANGLE', parent.id, { width: 20, height: 20 })
    const controller = new AbortController()
    graphAbortOnFirstLayoutUpdate(store, controller)

    const error = await handle(
      target,
      {
        name: 'render',
        args: {
          parent_id: parent.id,
          tree: {
            type: 'rectangle',
            props: { name: 'Must roll back', w: 30, h: 20 },
            children: []
          }
        }
      },
      { signal: controller.signal }
    ).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.getNode(parent.id)?.childIds).toEqual([existing.id])
    expect(store.graph.getChildren(otherPage.id).map((node) => node.id)).toEqual([parent.id])
  })
})

function graphAbortOnFirstLayoutUpdate(
  store: ReturnType<typeof createEditorStore>,
  controller: AbortController
): void {
  store.graph.onNodeEvents({
    updated: () => controller.abort()
  })
}
