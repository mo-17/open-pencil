import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import { computeAllLayoutsAsync, computeLayout } from '#core/layout'

import { autoFrame, pageId, rect } from '#tests/helpers/layout'

function geometry(graph: SceneGraph, frameId: string) {
  return graph.getChildren(frameId).map(({ x, y, width, height }) => ({ x, y, width, height }))
}

function makeHorizontalGraph(): { graph: SceneGraph; frameId: string } {
  const graph = new SceneGraph()
  const frame = autoFrame(graph, pageId(graph), {
    width: 360,
    height: 120,
    paddingLeft: 12,
    paddingTop: 8,
    itemSpacing: 7
  })
  rect(graph, frame.id, 40, 30)
  rect(graph, frame.id, 60, 40)
  rect(graph, frame.id, 80, 50)
  return { graph, frameId: frame.id }
}

describe('cooperative layout', () => {
  test('matches synchronous Yoga geometry when it completes', async () => {
    const sync = makeHorizontalGraph()
    const cooperative = makeHorizontalGraph()

    computeLayout(sync.graph, sync.frameId)
    await computeAllLayoutsAsync(cooperative.graph, cooperative.frameId, undefined, 1)

    expect(geometry(cooperative.graph, cooperative.frameId)).toEqual(
      geometry(sync.graph, sync.frameId)
    )
  })

  test('can cancel while building one large Yoga frame before geometry is applied', async () => {
    const graph = new SceneGraph()
    const frame = autoFrame(graph, pageId(graph), { width: 2000, height: 100 })
    for (let index = 0; index < 160; index++) rect(graph, frame.id, 10, 10)

    const updates: string[] = []
    graph.onNodeEvents({ updated: (nodeId) => updates.push(nodeId) })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 0)

    const error = await computeAllLayoutsAsync(graph, frame.id, controller.signal, 340).catch(
      (reason: Error) => reason
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(updates).toEqual([])

    // A cancelled partial Yoga tree must be fully released so the same graph
    // can be laid out successfully on the next attempt.
    await computeAllLayoutsAsync(graph, frame.id, undefined, 8)
    expect(graph.getChildren(frame.id)[1]?.x).toBe(10)
  })

  test('can cancel while applying a calculated large frame without walking the rest synchronously', async () => {
    const graph = new SceneGraph()
    const frame = autoFrame(graph, pageId(graph), { width: 2400, height: 100 })
    for (let index = 0; index < 120; index++) {
      const child = rect(graph, frame.id, 10, 10)
      graph.updateNode(child.id, { x: 999 })
    }

    const controller = new AbortController()
    const appliedChildren: string[] = []
    graph.onNodeEvents({
      updated: (nodeId, changes) => {
        if (nodeId === frame.id || changes.x === undefined) return
        appliedChildren.push(nodeId)
        if (appliedChildren.length === 5) controller.abort()
      }
    })

    const error = await computeAllLayoutsAsync(graph, frame.id, controller.signal, 1).catch(
      (reason: Error) => reason
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(appliedChildren).toHaveLength(5)
    expect(graph.getChildren(frame.id).filter((child) => child.x === 999).length).toBeGreaterThan(0)
  })

  test('computes one contiguous nested layout tree without recalculating every descendant', async () => {
    const graph = new SceneGraph()
    let parentId = pageId(graph)
    let outerFrameId = ''
    const depth = 40
    for (let index = 0; index < depth; index++) {
      const frame = autoFrame(graph, parentId, { width: 300 - index, height: 100 })
      if (index === 0) outerFrameId = frame.id
      parentId = frame.id
    }
    rect(graph, parentId, 20, 20)

    let geometryUpdates = 0
    graph.onNodeEvents({
      updated: (_nodeId, changes) => {
        if (changes.x !== undefined || changes.y !== undefined) geometryUpdates++
      }
    })

    await computeAllLayoutsAsync(graph, outerFrameId, undefined, 4)

    // Each descendant is applied once by the outer Yoga tree. The previous
    // bottom-up loop reapplied the same deep descendants quadratically.
    expect(geometryUpdates).toBe(depth)
  })
})
