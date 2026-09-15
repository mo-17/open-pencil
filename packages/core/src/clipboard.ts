import {
  embedClipboardImages,
  encodeFigmaClipboard,
  importClipboardNodes as importFigmaClipboardNodes
} from '@open-pencil/fig/clipboard'
export { parseFigmaClipboard, figmaNodesBounds } from '@open-pencil/fig/clipboard'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange as KiwiNodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { shapeTextForClipboard } from './canvas/text/clipboard'
import {
  remapSerializedLowcodeMotionActionReferences,
  resolveSerializedGraphNodeReference
} from './kiwi/fig/node-change/lowcode-node-references'
import {
  extractImportedLowcodeProps,
  reapplyInstanceOverrides
} from './kiwi/fig/node-change/lowcode-plugin-data'
import {
  sceneNodeToKiwi,
  makeDocumentNodeChange,
  makeCanvasNodeChange,
  buildFontDigestMap
} from './kiwi/fig/node-change/serialize'
import { randomInt } from './random'
import { buildDerivedTextDataV4 } from './text/derived-text/clipboard'

export async function prefetchFigmaSchema(): Promise<void> {
  await initCodec()
}

export async function buildFigmaClipboardHTML(
  nodes: SceneNode[],
  graph: SceneGraph
): Promise<string | null> {
  const fontDigestMap = await buildFontDigestMap(graph)

  const docGuid = { sessionID: 0, localID: 0 }
  const canvasGuid = { sessionID: 0, localID: 1 }
  const localIdCounter = { value: 100 }

  const nodeChanges: KiwiNodeChange[] = [
    makeDocumentNodeChange(docGuid, graph.documentColorSpace),
    makeCanvasNodeChange(canvasGuid, docGuid, '!', 'Page 1')
  ]

  const exportedTextNodes: SceneNode[] = []
  const collectTextNodes = (node: SceneNode) => {
    if (node.type === 'TEXT') exportedTextNodes.push(node)
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      if (child) collectTextNodes(child)
    }
  }

  const nodeIdToGuid = new Map<string, GUID>()
  const assignedGuidValues = new Set<string>()
  const blobs: Uint8Array[] = []
  for (let i = 0; i < nodes.length; i++) {
    collectTextNodes(nodes[i])
    nodeChanges.push(
      ...sceneNodeToKiwi(
        nodes[i],
        canvasGuid,
        i,
        localIdCounter,
        graph,
        blobs,
        nodeIdToGuid,
        fontDigestMap,
        undefined,
        undefined,
        undefined,
        assignedGuidValues
      )
    )
  }

  remapSerializedLowcodeMotionActionReferences(nodeChanges, (nodeId) =>
    resolveSerializedGraphNodeReference(graph, nodeIdToGuid, nodeId)
  )

  const textNodeQueue = [...exportedTextNodes]
  await Promise.all(
    nodeChanges.map(async (change) => {
      if (change.type !== 'TEXT') return
      const source = textNodeQueue.shift()
      if (!source) return
      change.textAutoResize = 'NONE'
      change.textUserLayoutVersion = 5
      change.lineHeight = {
        value: source.lineHeight ?? 100,
        units: source.lineHeight ? 'PIXELS' : 'PERCENT'
      }
      const shaped = await shapeTextForClipboard(source).catch(() => null)
      change.derivedTextData = await buildDerivedTextDataV4(source, fontDigestMap, shaped, blobs)
    })
  )
  await embedClipboardImages(nodeChanges, blobs, graph.images)
  return encodeFigmaClipboard(nodeChanges, blobs, randomInt())
}

export {
  buildOpenPencilClipboardHTML,
  parseOpenPencilClipboard,
  type OpenPencilClipboardData,
  type TextPictureBuilder
} from './clipboard/openpencil'

/** Restore core-owned lowcode metadata while keeping format decoding in the fig package. */
export function importClipboardNodes(
  nodes: KiwiNodeChange[],
  graph: SceneGraph,
  parentId: string,
  offsetX = 0,
  offsetY = 0,
  blobs: Uint8Array[] = []
): string[] {
  return importFigmaClipboardNodes(nodes, graph, parentId, offsetX, offsetY, blobs, {
    mapNodeProps: (change, converted) => {
      const lowcode = extractImportedLowcodeProps(change)
      return {
        ...converted,
        ...lowcode.props,
        nodeType: lowcode.nodeTypeOverride ?? converted.nodeType
      }
    },
    afterPopulate: (created) => {
      reapplyInstanceOverrides(graph, created.values())
      graph.remapClonedNodeReferences(created)
    }
  })
}
