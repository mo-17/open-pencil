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

    expect(response).toMatchObject({
      ok: true,
      result: { ok: true, data: { nodeIds: ids, preset: 'slide-up' } },
      meta: {
        sceneVersionBefore: expect.any(Number),
        sceneVersionAfter: expect.any(Number),
        targetPageId: target.pageId,
        mutatedIds: ids
      }
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

  test('replaces a node at its existing sibling index and reports the applied placement', async () => {
    const { handle, ids, store, target } = setup()
    const ignoredPage = store.graph.addPage('Ignored explicit parent')

    const response = await handle(target, {
      name: 'render',
      args: {
        parent_id: ignoredPage.id,
        insert_index: 1,
        replace_id: ids[0],
        tree: {
          type: 'rectangle',
          props: { name: 'Replacement', w: 30, h: 20 },
          children: []
        }
      }
    })

    const rendered = store.graph
      .getChildren(target.pageId)
      .find((node) => node.name === 'Replacement')
    expect(rendered).toBeDefined()
    expect(response).toMatchObject({
      ok: true,
      result: {
        id: rendered?.id,
        parent_id: target.pageId,
        index: 0,
        replaced_id: ids[0]
      }
    })
    expect(store.graph.getNode(ids[0])).toBeUndefined()
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([rendered?.id, ids[1]])
    expect(store.graph.getNode(ignoredPage.id)?.childIds).toEqual([])
  })

  test('inserts a rendered node at the requested sibling index and reports the actual index', async () => {
    const { handle, ids, store, target } = setup()

    const response = await handle(target, {
      name: 'render',
      args: {
        insert_index: 1,
        tree: {
          type: 'rectangle',
          props: { name: 'Inserted', w: 30, h: 20 },
          children: []
        }
      }
    })

    const rendered = store.graph.getChildren(target.pageId).find((node) => node.name === 'Inserted')
    expect(rendered).toBeDefined()
    expect(response).toMatchObject({
      ok: true,
      result: { id: rendered?.id, parent_id: target.pageId, index: 1 }
    })
    expect((response as { result: Record<string, unknown> }).result).not.toHaveProperty(
      'replaced_id'
    )
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([ids[0], rendered?.id, ids[1]])
  })

  test('inserts fragment roots as one contiguous block with the same placement semantics', async () => {
    const { handle, ids, store, target } = setup()

    const response = await handle(target, {
      name: 'render',
      args: {
        insert_index: 1,
        tree: {
          type: 'fragment',
          props: {},
          children: [
            { type: 'rectangle', props: { name: 'Fragment first', w: 30, h: 20 }, children: [] },
            { type: 'rectangle', props: { name: 'Fragment second', w: 30, h: 20 }, children: [] }
          ]
        }
      }
    })

    const result = (
      response as {
        result: { id: string; index: number; siblings: Array<{ id: string; index: number }> }
      }
    ).result
    expect(result.index).toBe(1)
    expect(result.siblings).toHaveLength(1)
    expect(result.siblings[0]?.index).toBe(2)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([
      ids[0],
      result.id,
      result.siblings[0]?.id,
      ids[1]
    ])
  })

  test('rejects a non-container render parent without creating an orphan', async () => {
    const { handle, ids, store, target } = setup()
    const shapeParent = store.graph.getNode(ids[0])
    expect(shapeParent?.type).toBe('RECTANGLE')
    const beforeIds = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]

    const error = await handle(target, {
      name: 'render',
      args: {
        parent_id: ids[0],
        tree: {
          type: 'rectangle',
          props: { name: 'Must not become orphaned', w: 30, h: 20 },
          children: []
        }
      }
    }).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('cannot contain children')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(beforeIds)
    expect(
      store.graph
        .getChildren(target.pageId)
        .some((node) => node.name === 'Must not become orphaned')
    ).toBe(false)
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

  test('restores a cross-page replacement target when post-render layout is cancelled', async () => {
    const { handle, store, target } = setup()
    const otherPage = store.graph.addPage('Cancelled replacement destination')
    const parent = store.graph.createNode('FRAME', otherPage.id, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      width: 300,
      height: 80
    })
    const replaceTarget = store.graph.createNode('RECTANGLE', parent.id, {
      name: 'Original target',
      width: 20,
      height: 20
    })
    const sibling = store.graph.createNode('RECTANGLE', parent.id, {
      name: 'Original sibling',
      width: 20,
      height: 20
    })
    const controller = new AbortController()
    graphAbortOnFirstLayoutUpdate(store, controller)

    const error = await handle(
      target,
      {
        name: 'render',
        args: {
          replace_id: replaceTarget.id,
          tree: {
            type: 'rectangle',
            props: { name: 'Must roll back replacement', w: 30, h: 20 },
            children: []
          }
        }
      },
      { signal: controller.signal }
    ).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(store.graph.getNode(parent.id)?.childIds).toEqual([replaceTarget.id, sibling.id])
    expect(store.graph.getNode(replaceTarget.id)?.name).toBe('Original target')
    expect(
      store.graph.getChildren(parent.id).some((node) => node.name === 'Must roll back replacement')
    ).toBe(false)
  })

  test('provides editor undo and mutation metadata for page route updates', async () => {
    const { handle, store, target } = setup()

    const response = await handle(target, {
      name: 'update_page_route',
      args: { page_id: target.pageId, route_pattern: '/home' }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { ok: true },
      meta: { mutatedIds: [target.pageId] }
    })
    expect(store.graph.getNode(target.pageId)?.lowcodeRoutePattern).toBe('/home')
    expect(store.undo.undoLabel).toBe('AI: update_page_route')
    store.undo.undo()
    expect(store.graph.getNode(target.pageId)?.lowcodeRoutePattern).toBeUndefined()
  })

  test('reports every moved id in reparent_nodes mutation metadata', async () => {
    const { handle, ids, store, target } = setup()
    const parent = store.graph.createNode('FRAME', target.pageId, { name: 'Batch parent' })

    const response = await handle(target, {
      name: 'reparent_nodes',
      args: { ids, parent_id: parent.id, insert_index: 0 }
    })

    expect(response).toMatchObject({
      ok: true,
      result: { ok: true },
      meta: { mutatedIds: ids }
    })
    expect(store.graph.getNode(parent.id)?.childIds).toEqual(ids)
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
