import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { createComponentSyncScheduler } from '#core/editor/component-sync'
import { restoreDocumentFromSnapshot, snapshotDocument } from '#core/editor/history/snapshot'
import type { EditorContext } from '#core/editor/types'
import { getLazyFigImportContext, setLazyFigImportContext } from '#core/kiwi/fig/lazy-import'
import {
  createFigPopulationWorker,
  registerFigPopulationWorker,
  registerOriginalArchiveRequest,
  releaseFigPopulationWorker,
  requestOriginalArchive
} from '#core/kiwi/fig/population/client'
import { applyFigPopulationDelta, type FigPopulationDelta } from '#core/kiwi/fig/population/delta'
import { createFigSessionOriginalArchiveRequester } from '#core/kiwi/fig/session/client'
import { computeAllLayouts } from '#core/layout'

const ROOT = resolve(import.meta.dir, '../../../../..')
const READ_MODULE_URL = pathToFileURL(
  resolve(ROOT, 'packages/core/src/io/formats/fig/read.ts')
).href

function hydrationDelta(graph: SceneGraph, options: { create?: boolean } = {}): FigPopulationDelta {
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected page')
  const created: Array<[string, SceneNode]> = []
  if (options.create) {
    const node = {
      ...structuredClone(page),
      id: 'hydrated-node',
      type: 'RECTANGLE',
      name: 'Hydrated node',
      parentId: page.id,
      childIds: []
    } as SceneNode
    created.push([node.id, node])
  }
  return {
    created,
    updated: [[page.id, { name: 'Hydrated page' }]],
    deleted: [],
    instanceIndex: [],
    populatedRootIds: [page.id]
  }
}

describe('FIG session ownership', () => {
  test('returns the original archive while the complete graph state is unchanged', async () => {
    const graph = new SceneGraph()
    const archive = new Uint8Array([1, 2, 3])
    registerOriginalArchiveRequest(graph, async () => archive)

    await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('keeps the original archive valid after runtime variable mode changes', async () => {
    const graph = new SceneGraph()
    const archive = new Uint8Array([1, 2, 3])
    registerOriginalArchiveRequest(graph, async () => archive)

    graph.activeMode.set('collection', 'dark')

    await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('discards an archive response when the graph changes while it is pending', async () => {
    const graph = new SceneGraph()
    let resolveArchive: ((bytes: Uint8Array) => void) | null = null
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveArchive = resolve
        })
    )
    const request = requestOriginalArchive(graph)

    graph.updateNode(graph.rootId, { name: 'Edited' })
    resolveArchive?.(new Uint8Array([1, 2, 3]))

    await expect(request).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('invalidates the original archive after a variable collection change', async () => {
    const graph = new SceneGraph()
    const channel = new MessageChannel()
    let requested = false
    let archiveReleased = false
    let workerTerminated = false
    const worker = Object.assign(new EventTarget(), {
      terminate: () => {
        workerTerminated = true
      }
    }) as Worker
    registerOriginalArchiveRequest(
      graph,
      async () => {
        requested = true
        return new Uint8Array([1, 2, 3])
      },
      () => {
        archiveReleased = true
      }
    )
    registerFigPopulationWorker(graph, worker, channel.port1)

    graph.variableCollections.set('collection', {
      id: 'collection',
      name: 'Theme',
      modes: [{ modeId: 'light', name: 'Light' }],
      defaultModeId: 'light',
      variableIds: []
    })

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    expect(requested).toBe(false)
    expect(archiveReleased).toBe(true)
    expect(workerTerminated).toBe(true)
    releaseFigPopulationWorker(graph)
    channel.port2.close()
  })

  test('discards a pending archive response after a variable collection change', async () => {
    const graph = new SceneGraph()
    let resolveArchive: ((bytes: Uint8Array) => void) | null = null
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveArchive = resolve
        })
    )
    const request = requestOriginalArchive(graph)

    graph.variableCollections.set('collection', {
      id: 'collection',
      name: 'Theme',
      modes: [{ modeId: 'light', name: 'Light' }],
      defaultModeId: 'light',
      variableIds: []
    })
    resolveArchive?.(new Uint8Array([1, 2, 3]))

    await expect(request).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('invalidates on scalar, map, and immutable image-map state changes', async () => {
    const cases: Array<[string, (graph: SceneGraph) => void, (graph: SceneGraph) => void]> = [
      [
        'document color space',
        () => undefined,
        (graph) => {
          graph.documentColorSpace = 'srgb'
        }
      ],
      [
        'enabled library map',
        () => undefined,
        (graph) => {
          graph.enabledLibraries.set('design-system', {
            libraryId: 'design-system',
            revisionId: 'revision-1',
            enabled: true
          })
        }
      ],
      [
        'FIG schema reference replacement',
        (graph) => {
          graph.figSchemaDeflated = new Uint8Array([1, 2, 3])
        },
        (graph) => {
          if (!graph.figSchemaDeflated) throw new Error('Expected FIG schema bytes')
          graph.figSchemaDeflated = new Uint8Array(graph.figSchemaDeflated)
        }
      ],
      [
        'image reference replacement',
        (graph) => graph.images.set('image', new Uint8Array([1, 2, 3])),
        (graph) => {
          graph.images.set('image', new Uint8Array([1, 2, 3]))
        }
      ],
      [
        'image addition',
        () => undefined,
        (graph) => graph.images.set('image', new Uint8Array([1, 2, 3]))
      ],
      [
        'image deletion',
        (graph) => graph.images.set('image', new Uint8Array([1, 2, 3])),
        (graph) => {
          graph.images.delete('image')
        }
      ]
    ]

    for (const [name, arrange, mutate] of cases) {
      const graph = new SceneGraph()
      arrange(graph)
      registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))
      mutate(graph)

      const result = await requestOriginalArchive(graph)
      expect(result, name).toBeNull()
      releaseFigPopulationWorker(graph)
    }
  })

  test('fails closed for unsupported document-level signature state', async () => {
    const graph = new SceneGraph()
    const animations = {}
    Object.defineProperty(animations, 'hidden', { value: true })
    graph.figMessageObjectAnimations = animations
    let requested = false
    registerOriginalArchiveRequest(graph, async () => {
      requested = true
      return new Uint8Array([1, 2, 3])
    })

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    expect(requested).toBe(false)
    releaseFigPopulationWorker(graph)
  })

  test('keeps immutable schema ownership through an identical document snapshot restore', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const schema = new Uint8Array([1, 2, 3])
    const archive = new Uint8Array([4, 5, 6])
    graph.figSchemaDeflated = schema
    registerOriginalArchiveRequest(graph, async () => archive)
    const snapshot = snapshotDocument(graph, page.id)
    const state = {
      currentPageId: page.id,
      hoveredNodeId: null,
      selectedIds: new Set<string>()
    }
    const ctx = {
      graph,
      state,
      emitEditorEvent: () => undefined,
      getRenderer: () => undefined,
      requestRender: () => undefined,
      setSelectedIds: (ids: Set<string>) => {
        state.selectedIds = ids
      }
    } as unknown as EditorContext

    restoreDocumentFromSnapshot(ctx, snapshot)

    expect(graph.figSchemaDeflated).toBe(schema)
    await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('invalidates after detachInstance emits its persistent node update', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const component = graph.createNode('COMPONENT', page.id, { name: 'Button' })
    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))

    graph.detachInstance(instance.id)

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('keeps the original archive valid across trusted hydration create and update events', async () => {
    const graph = new SceneGraph()
    const archive = new Uint8Array([1, 2, 3])
    registerOriginalArchiveRequest(graph, async () => archive)

    applyFigPopulationDelta(graph, hydrationDelta(graph, { create: true }))

    expect(graph.getNode('hydrated-node')?.name).toBe('Hydrated node')
    await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('does not let hydration provenance escape into a listener-authored update', async () => {
    const graph = new SceneGraph()
    let authored = false
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))
    const unbind = graph.onNodeEvents({
      updated: (_id, _changes, origin) => {
        if (origin !== 'source-hydration' || authored) return
        authored = true
        graph.updateNode(graph.rootId, { name: 'Authored during hydration' })
      }
    })

    applyFigPopulationDelta(graph, hydrationDelta(graph))
    unbind()

    expect(authored).toBe(true)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('accepts trusted hydration while an original archive request is pending', async () => {
    const graph = new SceneGraph()
    let resolveArchive: ((bytes: Uint8Array) => void) | null = null
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveArchive = resolve
        })
    )
    const request = requestOriginalArchive(graph)

    applyFigPopulationDelta(graph, hydrationDelta(graph, { create: true }))
    const archive = new Uint8Array([1, 2, 3])
    resolveArchive?.(archive)

    await expect(request).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('does not let later trusted hydration revive an archive invalidated by an authored edit', async () => {
    const graph = new SceneGraph()
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))

    graph.updateNode(graph.rootId, { name: 'Authored first' })
    applyFigPopulationDelta(graph, hydrationDelta(graph, { create: true }))

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('keeps the archive valid through queued structural component sync from hydration', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const component = graph.createNode('COMPONENT', page.id, { name: 'Button' })
    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')
    const scheduler = createComponentSyncScheduler(
      () => graph,
      () => undefined
    )
    const unbind = graph.onNodeEvents({
      created: (node) => scheduler.scheduleComponentSync(node.id),
      updated: (id) => scheduler.scheduleComponentSync(id)
    })
    const archive = new Uint8Array([1, 2, 3])
    registerOriginalArchiveRequest(graph, async () => archive)
    const child = {
      ...structuredClone(component),
      id: 'hydrated-component-child',
      type: 'RECTANGLE',
      name: 'Hydrated child',
      parentId: component.id,
      childIds: []
    } as SceneNode

    applyFigPopulationDelta(graph, {
      created: [[child.id, child]],
      updated: [],
      deleted: [],
      instanceIndex: [[component.id, [instance.id]]],
      populatedRootIds: [page.id]
    })
    await Promise.resolve()
    unbind()

    expect(graph.getChildren(instance.id).some((node) => node.componentId === child.id)).toBe(true)
    await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('stays invalid when an authored component edit triggers the same queued sync', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const component = graph.createNode('COMPONENT', page.id, { name: 'Button' })
    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')
    const scheduler = createComponentSyncScheduler(
      () => graph,
      () => undefined
    )
    const unbind = graph.onNodeEvents({
      updated: (id) => scheduler.scheduleComponentSync(id)
    })
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))

    graph.updateNode(component.id, { width: component.width + 1 })
    await Promise.resolve()
    unbind()

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('does not let component-sync provenance escape into a listener-authored update', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const component = graph.createNode('COMPONENT', page.id, { name: 'Button' })
    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')
    const scheduler = createComponentSyncScheduler(
      () => graph,
      () => undefined
    )
    let authored = false
    const unbind = graph.onNodeEvents({
      created: (node, origin) => {
        scheduler.scheduleComponentSync(node.id)
        if (origin !== 'derived-component-sync' || authored) return
        authored = true
        graph.updateNode(graph.rootId, { name: 'Authored during component sync' })
      }
    })
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))
    const child = {
      ...structuredClone(component),
      id: 'hydrated-component-listener-child',
      type: 'RECTANGLE',
      name: 'Hydrated child',
      parentId: component.id,
      childIds: []
    } as SceneNode

    applyFigPopulationDelta(graph, {
      created: [[child.id, child]],
      updated: [],
      deleted: [],
      instanceIndex: [[component.id, [instance.id]]],
      populatedRootIds: [page.id]
    })
    await Promise.resolve()
    unbind()

    expect(authored).toBe(true)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('drops a queued component-sync batch when the editor graph identity changes', async () => {
    const graphA = new SceneGraph()
    const pageA = graphA.getPages()[0]
    if (!pageA) throw new Error('Expected first page')
    const componentA = graphA.createNodeWithId('shared-component', 'COMPONENT', pageA.id)

    const graphB = new SceneGraph()
    const pageB = graphB.getPages()[0]
    if (!pageB) throw new Error('Expected second page')
    const componentB = graphB.createNodeWithId('shared-component', 'COMPONENT', pageB.id)
    const instanceB = graphB.createInstance(componentB.id, pageB.id)
    if (!instanceB) throw new Error('Expected second instance')
    graphB.createNode('RECTANGLE', componentB.id, { name: 'Unsynced child' })

    let currentGraph = graphA
    const scheduler = createComponentSyncScheduler(
      () => currentGraph,
      () => undefined
    )
    scheduler.scheduleComponentSync(componentA.id)
    currentGraph = graphB
    const archive = new Uint8Array([1, 2, 3])
    registerOriginalArchiveRequest(graphB, async () => archive)

    await Promise.resolve()

    expect(graphB.getChildren(instanceB.id)).toHaveLength(0)
    await expect(requestOriginalArchive(graphB)).resolves.toBe(archive)
    releaseFigPopulationWorker(graphB)
  })

  test('does not expose component-sync provenance to an authored render callback', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const component = graph.createNode('COMPONENT', page.id, { name: 'Button' })
    const instance = graph.createInstance(component.id, page.id)
    if (!instance) throw new Error('Expected instance')
    let rendered = false
    const scheduler = createComponentSyncScheduler(
      () => graph,
      () => {
        rendered = true
        graph.updateNode(graph.rootId, { name: 'Authored from render listener' })
      }
    )
    const unbind = graph.onNodeEvents({
      created: (node) => scheduler.scheduleComponentSync(node.id)
    })
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))
    const child = {
      ...structuredClone(component),
      id: 'hydrated-component-render-child',
      type: 'RECTANGLE',
      name: 'Hydrated child',
      parentId: component.id,
      childIds: []
    } as SceneNode

    applyFigPopulationDelta(graph, {
      created: [[child.id, child]],
      updated: [],
      deleted: [],
      instanceIndex: [[component.id, [instance.id]]],
      populatedRootIds: [page.id]
    })
    await Promise.resolve()
    unbind()

    expect(rendered).toBe(true)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('keeps the original archive valid after derived auto-layout writes', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const frame = graph.createNode('FRAME', page.id, {
      width: 100,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      paddingLeft: 10
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      x: 99,
      width: 20,
      height: 20
    })
    const archive = new Uint8Array([1, 2, 3])
    registerOriginalArchiveRequest(graph, async () => archive)

    computeAllLayouts(graph, frame.id)

    expect(child.x).toBe(10)
    await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
    releaseFigPopulationWorker(graph)
  })

  test('invalidates authored node updates even when wrapped in a layout scope', async () => {
    const graph = new SceneGraph()
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))

    graph.withLayoutMutations(() => graph.updateNode(graph.rootId, { name: 'Authored edit' }))

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('invalidates a listener-authored geometry update during a derived layout event', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const frame = graph.createNode('FRAME', page.id, {
      width: 100,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const laidOut = graph.createNode('RECTANGLE', frame.id, { width: 20, height: 20 })
    const authored = graph.createNode('RECTANGLE', page.id, { x: 1, width: 20, height: 20 })
    let edited = false
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))
    const unbind = graph.onNodeEvents({
      updated: (id, _changes, origin) => {
        if (id !== laidOut.id || origin !== 'derived-layout' || edited) return
        edited = true
        graph.updateNode(authored.id, { x: 777 })
      }
    })

    computeAllLayouts(graph, frame.id)
    unbind()

    expect(authored.x).toBe(777)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('remains invalid after detachInstance is followed by derived layout', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const frame = graph.createNode('FRAME', page.id, {
      width: 100,
      height: 40,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      paddingLeft: 10
    })
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 20,
      height: 20
    })
    const instance = graph.createInstance(component.id, frame.id, { x: 99 })
    if (!instance) throw new Error('Expected instance')
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([1, 2, 3]))

    graph.detachInstance(instance.id)
    computeAllLayouts(graph, frame.id)

    expect(instance.x).toBe(10)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('keeps an oversized session for raw archive ownership but disables worker population', async () => {
    const previousDev = process.env.DEV
    process.env.DEV = 'true'
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    for (let index = 0; index < 200_001; index++) {
      graph.nodes.set(`oversized-${index}`, {
        ...page,
        id: `oversized-${index}`,
        childIds: []
      })
    }
    let workerTerminated = false
    let portClosed = false
    const worker = { terminate: () => (workerTerminated = true) } as Worker
    const port = {
      postMessage: () => undefined,
      close: () => (portClosed = true)
    } as MessagePort
    const archive = new Uint8Array([4, 5, 6])
    setLazyFigImportContext(graph, {
      changeMap: new Map(),
      guidToNodeId: new Map(),
      blobs: [],
      populatedRootIds: new Set()
    })
    registerOriginalArchiveRequest(graph, async () => archive)

    try {
      registerFigPopulationWorker(graph, worker, port)

      expect(createFigPopulationWorker(graph)).toBeNull()
      await expect(requestOriginalArchive(graph)).resolves.toBe(archive)
      expect(workerTerminated).toBe(false)
      expect(portClosed).toBe(false)
    } finally {
      releaseFigPopulationWorker(graph)
      if (previousDev === undefined) delete process.env.DEV
      else process.env.DEV = previousDev
    }

    expect(workerTerminated).toBe(true)
    expect(portClosed).toBe(true)
  })

  test('releases an oversized retained session immediately after an authored edit', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    for (let index = 0; index < 200_001; index++) {
      graph.nodes.set(`oversized-edited-${index}`, {
        ...page,
        id: `oversized-edited-${index}`,
        childIds: []
      })
    }
    let workerTerminated = false
    let portClosed = false
    const worker = { terminate: () => (workerTerminated = true) } as Worker
    const port = {
      postMessage: () => undefined,
      close: () => (portClosed = true)
    } as MessagePort
    registerOriginalArchiveRequest(graph, async () => new Uint8Array([4, 5, 6]))
    registerFigPopulationWorker(graph, worker, port)

    graph.updateNode(graph.rootId, { name: 'Authored edit' })

    expect(workerTerminated).toBe(true)
    expect(portClosed).toBe(true)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
  })

  test('routes original archive responses alongside the population port listener', async () => {
    const channel = new MessageChannel()
    const worker = new EventTarget() as Worker
    const archive = new Uint8Array([7, 8, 9])
    let populationListenerMessages = 0
    channel.port1.onmessage = () => {
      populationListenerMessages++
    }
    channel.port2.onmessage = (event: MessageEvent<{ requestId: string; type: string }>) => {
      if (event.data.type !== 'original-archive') return
      const bytes = archive.slice()
      channel.port2.postMessage(
        { type: 'original-archive-result', requestId: event.data.requestId, bytes },
        [bytes.buffer]
      )
    }
    channel.port2.start()
    const requester = createFigSessionOriginalArchiveRequester(worker, channel.port1, {
      timeoutMs: 1_000
    })

    await expect(requester.request()).resolves.toEqual(archive)
    expect(populationListenerMessages).toBe(1)

    requester.dispose()
    channel.port1.close()
    channel.port2.close()
  })

  test('falls back when the session reports an original archive request error', async () => {
    const graph = new SceneGraph()
    const channel = new MessageChannel()
    let workerTerminated = false
    const worker = Object.assign(new EventTarget(), {
      terminate: () => {
        workerTerminated = true
      }
    }) as Worker
    channel.port2.onmessage = (event: MessageEvent<{ requestId: string; type: string }>) => {
      if (event.data.type !== 'original-archive') return
      channel.port2.postMessage({
        type: 'population-error',
        requestId: event.data.requestId,
        error: 'archive unavailable'
      })
    }
    channel.port2.start()
    const requester = createFigSessionOriginalArchiveRequester(worker, channel.port1, {
      timeoutMs: 1_000
    })
    registerOriginalArchiveRequest(graph, requester.request, requester.dispose)
    registerFigPopulationWorker(graph, worker, channel.port1)

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    expect(workerTerminated).toBe(true)

    releaseFigPopulationWorker(graph)
    channel.port1.close()
    channel.port2.close()
  })

  test('falls back instead of hanging when an original archive request times out', async () => {
    const graph = new SceneGraph()
    const channel = new MessageChannel()
    let workerTerminated = false
    const worker = Object.assign(new EventTarget(), {
      terminate: () => {
        workerTerminated = true
      }
    }) as Worker
    const requester = createFigSessionOriginalArchiveRequester(worker, channel.port1, {
      timeoutMs: 10
    })
    registerOriginalArchiveRequest(graph, requester.request, requester.dispose)
    registerFigPopulationWorker(graph, worker, channel.port1)

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    expect(workerTerminated).toBe(true)

    releaseFigPopulationWorker(graph)
    channel.port1.close()
    channel.port2.close()
  })

  test('invalidates the shared archive immediately when session population is aborted', async () => {
    const previousDev = process.env.DEV
    process.env.DEV = 'true'
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    setLazyFigImportContext(graph, {
      changeMap: new Map(),
      guidToNodeId: new Map(),
      blobs: [],
      populatedRootIds: new Set()
    })
    const channel = new MessageChannel()
    let released = false
    let terminated = false
    const worker = Object.assign(new EventTarget(), {
      terminate: () => {
        terminated = true
      }
    }) as Worker
    try {
      registerOriginalArchiveRequest(
        graph,
        async () => new Uint8Array([1, 2, 3]),
        () => {
          released = true
        }
      )
      registerFigPopulationWorker(graph, worker, channel.port1)
      const population = createFigPopulationWorker(graph)
      if (!population) throw new Error('Expected population worker')
      const controller = new AbortController()
      const pending = population.populate(page.id, controller.signal)

      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect(requestOriginalArchive(graph)).resolves.toBeNull()
      expect(released).toBe(true)
      expect(terminated).toBe(true)
    } finally {
      releaseFigPopulationWorker(graph)
      channel.port2.close()
      if (previousDev === undefined) delete process.env.DEV
      else process.env.DEV = previousDev
    }
  })

  test('invalidates the shared archive immediately on a population protocol error', async () => {
    const graph = new SceneGraph()
    setLazyFigImportContext(graph, {
      changeMap: new Map(),
      guidToNodeId: new Map(),
      blobs: [],
      populatedRootIds: new Set()
    })
    const channel = new MessageChannel()
    let released = false
    let terminated = false
    const worker = Object.assign(new EventTarget(), {
      terminate: () => {
        terminated = true
      }
    }) as Worker
    registerOriginalArchiveRequest(
      graph,
      async () => new Uint8Array([1, 2, 3]),
      () => {
        released = true
      }
    )
    registerFigPopulationWorker(graph, worker, channel.port1)

    channel.port2.postMessage({ type: 'population-error', error: 'synthetic failure' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    expect(released).toBe(true)
    expect(terminated).toBe(true)
    releaseFigPopulationWorker(graph)
    channel.port2.close()
  })

  test('settles population immediately on retained session transport errors', async () => {
    const previousDev = process.env.DEV
    process.env.DEV = 'true'
    try {
      for (const target of ['port', 'worker'] as const) {
        const graph = new SceneGraph()
        const page = graph.getPages()[0]
        if (!page) throw new Error('Expected page')
        setLazyFigImportContext(graph, {
          changeMap: new Map(),
          guidToNodeId: new Map(),
          blobs: [],
          populatedRootIds: new Set()
        })
        const channel = new MessageChannel()
        let released = false
        let terminated = false
        const worker = Object.assign(new EventTarget(), {
          terminate: () => {
            terminated = true
          }
        }) as Worker
        registerOriginalArchiveRequest(
          graph,
          async () => new Uint8Array([1, 2, 3]),
          () => {
            released = true
          }
        )
        registerFigPopulationWorker(graph, worker, channel.port1)
        const population = createFigPopulationWorker(graph)
        if (!population) throw new Error('Expected population worker')
        const pending = population.populate(page.id)

        if (target === 'port') {
          channel.port1.onmessageerror?.call(channel.port1, new MessageEvent('messageerror'))
        } else {
          worker.onmessageerror?.call(worker, new MessageEvent('messageerror'))
        }

        await expect(pending).resolves.toBeNull()
        await expect(requestOriginalArchive(graph)).resolves.toBeNull()
        expect(released).toBe(true)
        expect(terminated).toBe(true)
        releaseFigPopulationWorker(graph)
        channel.port2.close()
      }
    } finally {
      if (previousDev === undefined) delete process.env.DEV
      else process.env.DEV = previousDev
    }
  })

  test('releases a stale shared session immediately after an authored node mutation', async () => {
    const graph = new SceneGraph()
    const channel = new MessageChannel()
    let released = false
    let terminated = false
    const worker = Object.assign(new EventTarget(), {
      terminate: () => {
        terminated = true
      }
    }) as Worker
    registerOriginalArchiveRequest(
      graph,
      async () => new Uint8Array([1, 2, 3]),
      () => {
        released = true
      }
    )
    registerFigPopulationWorker(graph, worker, channel.port1)

    graph.updateNode(graph.rootId, { name: 'Authored edit' })

    expect(released).toBe(true)
    expect(terminated).toBe(true)
    await expect(requestOriginalArchive(graph)).resolves.toBeNull()
    releaseFigPopulationWorker(graph)
    channel.port2.close()
  })

  test('round-trips the original archive through a live first-page session worker', async () => {
    const script = `
      import { strict as assert } from 'node:assert'
      import { readFile } from 'node:fs/promises'
      globalThis.window = {}
      process.env.DEV = 'true'
      const { parseFigFile } = await import(${JSON.stringify(READ_MODULE_URL)})
      const { createFigPopulationWorker, requestOriginalArchive, releaseFigPopulationWorker } = await import(
        ${JSON.stringify(pathToFileURL(resolve(ROOT, 'packages/core/src/kiwi/fig/population/client.ts')).href)}
      )
      const { getLazyFigImportContext } = await import(
        ${JSON.stringify(pathToFileURL(resolve(ROOT, 'packages/core/src/kiwi/fig/lazy-import.ts')).href)}
      )
      const { deserializeSceneGraph } = await import(
        ${JSON.stringify(pathToFileURL(resolve(ROOT, 'packages/core/src/kiwi/fig/parse/transfer.ts')).href)}
      )
      const bytes = await readFile(${JSON.stringify(resolve(ROOT, 'tests/fixtures/circle-text.fig'))})
      const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const graph = await parseFigFile(input, { populate: 'first-page' })
      assert.equal(input.byteLength, 0)
      const context = getLazyFigImportContext(graph)
      assert(context)
      const finalPage = graph.getPages(true).find((page) => !context.populatedRootIds.has(page.id))
      assert(finalPage)
      const population = createFigPopulationWorker(graph)
      assert(population)
      assert.equal(await population.populate(finalPage.id), true)
      assert.equal(getLazyFigImportContext(graph), undefined)
      const archive = await requestOriginalArchive(graph)
      assert(archive)
      assert.equal(Buffer.compare(Buffer.from(archive), bytes), 0)
      releaseFigPopulationWorker(graph)

      const legacyWorker = new Worker(
        ${JSON.stringify(pathToFileURL(resolve(ROOT, 'packages/core/src/kiwi/fig/parse/worker.ts')).href)},
        { type: 'module' }
      )
      const nextLegacyMessage = (predicate) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('legacy worker timed out')), 5_000)
          legacyWorker.onmessage = (event) => {
            if (!predicate(event.data)) return
            clearTimeout(timeout)
            resolve(event.data)
          }
          legacyWorker.onerror = (event) => {
            clearTimeout(timeout)
            reject(new Error(event.message || 'legacy worker failed'))
          }
        })
      const legacyInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const legacyGraphPending = nextLegacyMessage((message) => message.type === 'graph')
      legacyWorker.postMessage(
        { buffer: legacyInput, options: { populate: 'first-page' } },
        [legacyInput]
      )
      const legacyGraphResult = await legacyGraphPending
      assert(legacyGraphResult.graph)
      const legacyGraph = deserializeSceneGraph(legacyGraphResult.graph)
      const legacyContext = getLazyFigImportContext(legacyGraph)
      assert(legacyContext)
      const legacyFinalPage = legacyGraph
        .getPages(true)
        .find((page) => !legacyContext.populatedRootIds.has(page.id))
      assert(legacyFinalPage)
      const legacyPopulationPending = nextLegacyMessage(
        (message) => message.type === 'population-result' || message.type === 'population-error'
      )
      legacyWorker.postMessage({
        type: 'populate',
        requestId: 'final-page',
        baseRevision: 0,
        pageId: legacyFinalPage.id
      })
      const legacyPopulation = await legacyPopulationPending
      assert.equal(legacyPopulation.type, 'population-result')
      assert.equal(legacyPopulation.populated, true)
      assert(legacyPopulation.delta.populatedRootIds.includes(legacyFinalPage.id))
      legacyWorker.terminate()

      const probe = new MessageChannel()
      const portPrototype = Object.getPrototypeOf(probe.port1)
      const onmessageDescriptor = Object.getOwnPropertyDescriptor(portPrototype, 'onmessage')
      assert(onmessageDescriptor)
      probe.port1.close()
      probe.port2.close()
      Object.defineProperty(portPrototype, 'onmessage', {
        ...onmessageDescriptor,
        set() {
          throw new Error('synthetic registration failure')
        }
      })
      const failingInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      try {
        await assert.rejects(
          parseFigFile(failingInput, {
            populate: 'first-page',
            allowMainThreadFallback: false
          }),
          /synthetic registration failure/
        )
      } finally {
        Object.defineProperty(portPrototype, 'onmessage', onmessageDescriptor)
      }
    `
    const process = Bun.spawn([globalThis.process.execPath, '-e', script], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited
    ])

    expect(exitCode, [stdout, stderr].filter(Boolean).join('\n')).toBe(0)
  })

  test.serial('rejects session worker construction outside Worker runtimes', async () => {
    const originalWorker = globalThis.Worker
    Reflect.deleteProperty(globalThis, 'Worker')
    try {
      const { createFigSessionWorker } = await import('#core/kiwi/fig/session/client')
      expect(() => createFigSessionWorker()).toThrow('unavailable')
    } finally {
      globalThis.Worker = originalWorker
    }
  })
})
