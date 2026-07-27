import {
  sceneNodeToKiwi as sceneNodeToKiwiWithRuntime,
  type FigNodeChangeExportRuntime,
  type KiwiNodeChange
} from '@open-pencil/fig/node-change'
import type { ComponentPropertyDefinition, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import {
  fontCoversTextSync,
  getFontVerticalMetricsSync,
  getGlyphOutlineMetricsSync
} from '#core/text/opentype'

import { serializeInstanceOverrides, serializeLowcodeFields } from './lowcode-plugin-data'

export {
  buildFigKiwi,
  decompressFigKiwiDataAsync,
  FIG_KIWI_DEFAULT_VERSION,
  fractionalPosition,
  makeCanvasNodeChange,
  makeDocumentNodeChange,
  mapToFigmaType,
  parseFigKiwiChunks,
  safeColor
} from '@open-pencil/fig/node-change'
export { buildFontDigestMap } from './font/digests'

const coreFigExportRuntime = {
  getGlyphOutlineMetrics(family: string, style: string, text: string, fontSize: number) {
    if (!fontCoversTextSync(family, style, text)) return null
    return getGlyphOutlineMetricsSync(family, style, text, fontSize)
  },
  getFontVerticalMetrics(family: string, style: string, fontSize: number) {
    return getFontVerticalMetricsSync(family, style, fontSize)
  },
  getAdditionalPluginData(node: SceneNode, graph: SceneGraph) {
    const entries = serializeLowcodeFields(node)
    const instanceOverrides = serializeInstanceOverrides(node, graph)
    if (instanceOverrides) entries.push(instanceOverrides)
    return entries
  }
}

type FigExportProjectionRuntime = Pick<
  FigNodeChangeExportRuntime,
  'getExportNode' | 'getExportNodeType' | 'getExportChildren'
>

export function createCoreFigExportRuntime(
  projection?: FigExportProjectionRuntime
): FigNodeChangeExportRuntime {
  return projection ? { ...coreFigExportRuntime, ...projection } : coreFigExportRuntime
}

export function sceneNodeToKiwi(
  node: SceneNode,
  parentGuid: GUID,
  childIndex: number,
  localIdCounter: { value: number },
  graph: SceneGraph,
  blobs: Uint8Array[],
  nodeIdToGuid?: Map<string, GUID>,
  fontDigestMap?: Map<string, Uint8Array>,
  varIdToGuid?: Map<string, GUID>,
  glyphBlobMap = new Map<string, number>(),
  blobIndexByHex?: Map<string, number>,
  assignedGuidValues?: Set<string>,
  componentPropertyDefinitionsById?: ReadonlyMap<string, ComponentPropertyDefinition>,
  modeIdToGuid?: Map<string, GUID>,
  runtime: FigNodeChangeExportRuntime = coreFigExportRuntime
): KiwiNodeChange[] {
  return sceneNodeToKiwiWithRuntime(
    node,
    parentGuid,
    childIndex,
    localIdCounter,
    graph,
    blobs,
    nodeIdToGuid,
    fontDigestMap,
    varIdToGuid,
    glyphBlobMap,
    blobIndexByHex,
    assignedGuidValues,
    runtime,
    componentPropertyDefinitionsById,
    modeIdToGuid
  )
}
