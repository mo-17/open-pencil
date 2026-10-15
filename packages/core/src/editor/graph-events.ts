import {
  TRANSFORM_FIELDS,
  type SceneGraph,
  type SceneGraphEvents,
  type SceneNode,
  type NodeMutationOrigin
} from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { markFlowChanged } from '#core/layout/derived'

type EmittedGraphEventName = keyof SceneGraphEvents

/** The renderer surface graph events invalidate; tests provide a double of just this. */
export type GraphEventRenderer = Pick<
  SkiaRenderer,
  'invalidateVectorPath' | 'invalidateNodePicture'
> & {
  tiledScene: Pick<SkiaRenderer['tiledScene'], 'invalidateNode' | 'invalidateStructure'>
}

type GraphEventOptions = {
  getGraph: () => SceneGraph
  getRenderers: () => Iterable<GraphEventRenderer>
  scheduleComponentSync: (nodeId: string, origin?: NodeMutationOrigin) => void
  requestRender: () => void
  emitEditorEvent: <K extends EmittedGraphEventName>(
    event: K,
    ...args: Parameters<SceneGraphEvents[K]>
  ) => void
}

const GEOMETRY_CACHE_KEYS = new Set<keyof SceneNode>([
  'vectorNetwork',
  'fillGeometry',
  'strokeGeometry'
])

const TILED_CHUNK_TOPOLOGY_KEYS = new Set<keyof SceneNode>([
  'type',
  'visible',
  'isMask',
  'maskType'
])

const NODE_PICTURE_STABLE_PREVIEW_KEYS = new Set<keyof SceneNode>([...TRANSFORM_FIELDS, 'parentId'])

export type RendererInvalidation = {
  geometryCache: boolean
  nodePicture: boolean
}

export function rendererInvalidationForChanges(
  changes: Partial<SceneNode>,
  options: { preview: boolean }
): RendererInvalidation {
  const keys = Object.keys(changes) as (keyof SceneNode)[]
  const geometryCache = keys.some((key) => GEOMETRY_CACHE_KEYS.has(key))
  const nodePicture = options.preview
    ? keys.some((key) => !NODE_PICTURE_STABLE_PREVIEW_KEYS.has(key))
    : true
  return { geometryCache, nodePicture }
}

function invalidateRenderersForChange(
  graph: SceneGraph,
  renderers: Iterable<GraphEventRenderer>,
  id: string,
  changes: Partial<SceneNode>,
  invalidateNodePicture: boolean
) {
  const invalidation = rendererInvalidationForChanges(changes, { preview: !invalidateNodePicture })
  for (const renderer of renderers) {
    if (invalidation.geometryCache) renderer.invalidateVectorPath(id)
    if (invalidation.nodePicture)
      renderer.invalidateNodePicture(id, Object.keys(changes) as (keyof SceneNode)[])
    if (Object.keys(changes).some((key) => TILED_CHUNK_TOPOLOGY_KEYS.has(key as keyof SceneNode))) {
      renderer.tiledScene.invalidateStructure()
    } else {
      renderer.tiledScene.invalidateNode(id, graph)
    }
  }
}

export function createGraphEventSubscription(options: GraphEventOptions) {
  let unbindGraphEvents: (() => void) | null = null
  let batchRenderPending = false

  /**
   * A layout pass or a page's layers loading updates many layers at once, and each render
   * request bumps reactive versions; the batch asks for one render after it, before the next
   * frame draws.
   */
  function requestRenderFor(graph: SceneGraph, origin?: NodeMutationOrigin) {
    if (origin === undefined && !graph.isApplyingLayout && !graph.isApplyingImportedState) {
      options.requestRender()
      return
    }
    if (batchRenderPending) return
    batchRenderPending = true
    queueMicrotask(() => {
      batchRenderPending = false
      options.requestRender()
    })
  }

  function onNodeUpdated(id: string, changes: Partial<SceneNode>, origin?: NodeMutationOrigin) {
    const graph = options.getGraph()
    invalidateRenderersForChange(graph, options.getRenderers(), id, changes, true)
    options.emitEditorEvent('node:updated', id, changes, origin)
    options.scheduleComponentSync(id, origin)
    requestRenderFor(graph, origin)
  }

  function onNodePreviewUpdated(
    id: string,
    changes: Partial<SceneNode>,
    origin?: NodeMutationOrigin
  ) {
    const { nodePicture } = rendererInvalidationForChanges(changes, { preview: true })
    invalidateRenderersForChange(
      options.getGraph(),
      options.getRenderers(),
      id,
      changes,
      nodePicture
    )
    options.emitEditorEvent('node:previewUpdated', id, changes, origin)
  }

  function onNodeStructureChanged(nodeId: string, origin?: NodeMutationOrigin) {
    for (const renderer of options.getRenderers()) {
      renderer.invalidateNodePicture(nodeId)
      renderer.tiledScene.invalidateStructure()
    }
    options.scheduleComponentSync(nodeId, origin)
    requestRenderFor(options.getGraph(), origin)
  }

  /**
   * An edit that adds, removes, or moves a layer changes its parent's flow, which then stops
   * keeping the geometry a file saved for it. Loading a page and laying out are not edits.
   */
  function flowChanged(parentId: string | null | undefined, origin?: NodeMutationOrigin) {
    const graph = options.getGraph()
    if (
      origin !== undefined ||
      !parentId ||
      graph.isApplyingImportedState ||
      graph.isApplyingLayout
    )
      return
    markFlowChanged(graph, parentId)
  }

  function subscribeToGraph() {
    unbindGraphEvents?.()
    unbindGraphEvents = options.getGraph().onNodeEvents({
      updated: onNodeUpdated,
      previewUpdated: onNodePreviewUpdated,
      created: (node, origin) => {
        options.emitEditorEvent('node:created', node, origin)
        onNodeStructureChanged(node.id, origin)
        flowChanged(node.parentId, origin)
      },
      // A layer that leaves a component, deleted or moved out, changes the component it left;
      // the parent it had finds that component when the sync runs.
      deleted: (id, parentId, origin) => {
        options.emitEditorEvent('node:deleted', id, parentId, origin)
        onNodeStructureChanged(id, origin)
        flowChanged(parentId, origin)
        if (parentId) options.scheduleComponentSync(parentId, origin)
      },
      reparented: (nodeId, oldParentId, newParentId, origin) => {
        options.emitEditorEvent('node:reparented', nodeId, oldParentId, newParentId, origin)
        onNodeStructureChanged(nodeId, origin)
        flowChanged(oldParentId, origin)
        flowChanged(newParentId, origin)
        if (oldParentId) options.scheduleComponentSync(oldParentId, origin)
      },
      reordered: (nodeId, parentId, index, previousParentId, origin) => {
        options.emitEditorEvent('node:reordered', nodeId, parentId, index, previousParentId, origin)
        onNodeStructureChanged(nodeId, origin)
        flowChanged(parentId, origin)
        flowChanged(previousParentId, origin)
        if (previousParentId && previousParentId !== parentId) {
          options.scheduleComponentSync(previousParentId, origin)
        }
      }
    })
  }

  function unsubscribeFromGraph() {
    unbindGraphEvents?.()
    unbindGraphEvents = null
  }

  return { subscribeToGraph, unsubscribeFromGraph }
}
