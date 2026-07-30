import { computeContentBounds, type RasterRenderBounds } from '@open-pencil/core/io/formats/raster'
import type { SceneGraph } from '@open-pencil/scene-graph'

import {
  MAX_VISUAL_ATTACHMENT_EDGE,
  MAX_VISUAL_REFERENCE_NODE_IDS,
  normalizeVisualAttachment,
  type VisualChatAttachment,
  type VisualAttachmentFileLike
} from '@/app/ai/chat/attachments'

export interface SelectionAttachmentStore {
  graph: SceneGraph
  state: {
    selectedIds: Set<string>
    currentPageId: string
  }
  renderExportImage(
    nodeIds: string[],
    scale: number,
    format: 'PNG',
    pageId: string,
    options: { bounds: RasterRenderBounds }
  ): Promise<Uint8Array | null>
}

type SelectionAttachmentDependencies = {
  computeBounds?: typeof computeContentBounds
  normalize?: typeof normalizeVisualAttachment
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export async function captureSelectionVisualAttachment(
  store: SelectionAttachmentStore,
  dependencies: SelectionAttachmentDependencies = {}
): Promise<VisualChatAttachment> {
  const nodeIds = [...store.state.selectedIds]
  if (nodeIds.length === 0) throw new Error('Select a visible canvas layer first.')

  const computeBounds = dependencies.computeBounds ?? computeContentBounds
  const bounds = computeBounds(store.graph, nodeIds)
  if (!bounds) throw new Error('The selected layers do not have visible bounds.')
  const longestEdge = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  if (!Number.isFinite(longestEdge) || longestEdge <= 0) {
    throw new Error('The selected layers do not have visible bounds.')
  }

  const scale = Math.min(1, MAX_VISUAL_ATTACHMENT_EDGE / longestEdge)
  const bytes = await store.renderExportImage(nodeIds, scale, 'PNG', store.state.currentPageId, {
    bounds
  })
  if (!bytes) throw new Error('The selected layers could not be rendered.')

  const name =
    nodeIds.length === 1 ? (store.graph.getNode(nodeIds[0])?.name ?? 'Selection') : 'Selection'
  const buffer = ownedArrayBuffer(bytes)
  const file: VisualAttachmentFileLike = {
    name: `${name}.png`,
    type: 'image/png',
    size: buffer.byteLength,
    async arrayBuffer() {
      return buffer.slice(0)
    }
  }
  const attachment = await (dependencies.normalize ?? normalizeVisualAttachment)(file, {
    source: 'selection'
  })
  return { ...attachment, canvasNodeIds: nodeIds.slice(0, MAX_VISUAL_REFERENCE_NODE_IDS) }
}
