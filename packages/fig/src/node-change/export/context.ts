import { effectiveFigmaRawNodeFields } from '#fig/source-metadata'

import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import { stringToGuid } from '@open-pencil/kiwi/fig/guid'
import type {
  ComponentPropertyDefinition,
  PluginDataEntry,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'
import type { Color, GUID, Matrix } from '@open-pencil/scene-graph/primitives'

export type KiwiNodeChange = NodeChange & Record<string, unknown>

export type KiwiSymbolOverridePayload = NonNullable<
  NonNullable<NodeChange['symbolData']>['symbolOverrides']
>[number] &
  Record<string, unknown>

/** How a record names a shared style: a local GUID, or a published library asset. */
export interface StyleReference {
  guid?: GUID
  assetRef?: { key: string; version?: string }
}

/** Published styles by graph and source id, built once with the rest of the context. */
export function buildStyleReferences(graph: SceneGraph): ReadonlyMap<string, StyleReference> {
  const references = new Map<string, StyleReference>()
  for (const node of graph.getAllNodes()) {
    if (!node.sharedStyleType || !node.source.id) continue
    const raw = effectiveFigmaRawNodeFields(node)
    if (typeof raw.key !== 'string') continue
    const reference: StyleReference = {
      assetRef: {
        key: raw.key,
        ...(typeof raw.version === 'string' ? { version: raw.version } : {})
      }
    }
    references.set(node.source.id, reference)
    references.set(node.id, reference)
  }
  return references
}

/** Caches shared only within one immutable graph export batch. */
export interface FigNodeExportCaches {
  styleReferences: ReadonlyMap<string, StyleReference>
  siblingOrderKeys: Map<string, { keyById: Map<string, string> }>
}

export function createFigNodeExportCaches(graph: SceneGraph): FigNodeExportCaches {
  return { styleReferences: buildStyleReferences(graph), siblingOrderKeys: new Map() }
}

export interface SceneNodeToKiwiContext {
  styleReferences?: ReadonlyMap<string, StyleReference>
  siblingOrderKeys?: FigNodeExportCaches['siblingOrderKeys']
  graph: SceneGraph
  blobs: Uint8Array[]
  blobIndexByHex?: Map<string, number>
  nodeIdToGuid?: Map<string, GUID>
  /** Reverse index of assigned GUID values ("sessionID:localID") for O(1)
   *  collision detection. Populated alongside every nodeIdToGuid.set() call. */
  assignedGuidValues?: Set<string>
  fontDigestMap?: Map<string, Uint8Array>
  glyphBlobMap?: Map<string, number>
  varIdToGuid?: Map<string, GUID>
  modeIdToGuid?: Map<string, GUID>
  /** Variable GUIDs used only where raw effect aliases cannot retain asset refs. */
  assetRefToVarGuid?: Map<string, GUID>
  /** GUIDs minted for component property IDs (e.g. "prop:abc123") that aren't
   *  already Figma-GUID-shaped, keyed by the original ID so refs/assignments/
   *  variantPropSpecs pointing at the same property reuse the same GUID. */
  propertyIdToGuid: Map<string, GUID>
  componentPropertyDefinitionsById: ReadonlyMap<string, ComponentPropertyDefinition>
  /**
   * Receives the content frames of instance slots. Figma stores them on the internal canvas,
   * so the caller re-parents the `isSlotContent` roots there after serializing its nodes.
   */
  slotContentRecords?: KiwiNodeChange[]
  fractionalPosition: (index: number) => string
  getExportNode: (node: SceneNode) => SceneNode
  getExportChildren: (node: SceneNode) => readonly SceneNode[]
  getAdditionalPluginData: (node: SceneNode, graph: SceneGraph) => PluginDataEntry[]
  mapToFigmaType: (node: SceneNode) => string
  fillToKiwiPaint: (fill: SceneNode['fills'][number]) => Paint
  safeColor: (color: Color) => Color
  computeExportTransform: (node: SceneNode) => Matrix
  serializeCornerRadii: (node: SceneNode, nc: KiwiNodeChange) => void
  serializeTextProps: (
    node: SceneNode,
    nc: KiwiNodeChange,
    graph: SceneGraph,
    fontDigestMap: Map<string, Uint8Array> | undefined,
    blobs: Uint8Array[],
    glyphBlobMap: Map<string, number> | undefined,
    generateMissingGlyphs?: boolean
  ) => void
  serializeLayoutProps: (node: SceneNode, nc: KiwiNodeChange) => void
  serializeGeometry: (node: SceneNode, nc: KiwiNodeChange, blobs: Uint8Array[]) => void
  serializeVariableBindings: (
    node: SceneNode,
    nc: KiwiNodeChange,
    graph: SceneGraph,
    varIdToGuid?: Map<string, GUID>
  ) => void
  sceneNodeToKiwi: (
    node: SceneNode,
    parentGuid: GUID,
    childIndex: number,
    localIdCounter: { value: number },
    context: SceneNodeToKiwiContext
  ) => KiwiNodeChange[]
}

export function parseGuidOrNull(value: string) {
  return /^\d+:\d+$/.test(value) ? stringToGuid(value) : null
}

export function resolveInstanceComponentId(
  context: SceneNodeToKiwiContext,
  componentId: string
): string {
  const seen = new Set<string>()
  let currentId = componentId
  while (!seen.has(currentId)) {
    seen.add(currentId)
    const node = context.graph.getNode(currentId)
    if (node?.type !== 'INSTANCE' || !node.componentId) return currentId
    currentId = node.componentId
  }
  return componentId
}

export function getOrCreateNodeGuid(
  context: SceneNodeToKiwiContext,
  nodeId: string,
  localIdCounter: { value: number }
): GUID | undefined {
  const node = context.graph.getNode(nodeId)
  if (!node) return undefined
  const existing = context.nodeIdToGuid?.get(nodeId)
  if (existing) return existing
  const importedGuid = node.source.id ? parseGuidOrNull(node.source.id) : null

  // When source.id maps to a GUID value that is already assigned to a
  // different node (e.g. two nodes from different canvases with the same
  // source.id "1:94"), fall back to the counter to avoid collisions.
  if (importedGuid && context.assignedGuidValues) {
    const key = `${importedGuid.sessionID}:${importedGuid.localID}`
    if (context.assignedGuidValues.has(key)) {
      const guid: GUID = { sessionID: 1, localID: localIdCounter.value++ }
      context.nodeIdToGuid?.set(nodeId, guid)
      context.assignedGuidValues.add(`${guid.sessionID}:${guid.localID}`)
      return guid
    }
  }

  const guid = importedGuid ?? { sessionID: 1, localID: localIdCounter.value++ }
  context.nodeIdToGuid?.set(nodeId, guid)
  context.assignedGuidValues?.add(`${guid.sessionID}:${guid.localID}`)
  return guid
}

/**
 * Component property IDs ("prop:abc123") never match the Figma GUID shape,
 * so parseGuidOrNull always rejects them — mint a stable synthetic GUID from
 * the shared node-id counter instead, memoized so every def/ref/assignment/
 * variantPropSpec pointing at the same property ID round-trips consistently.
 */
export function getOrCreatePropertyGuid(
  context: SceneNodeToKiwiContext,
  propertyId: string,
  localIdCounter: { value: number }
): GUID {
  const existing = context.propertyIdToGuid.get(propertyId)
  if (existing) return existing
  const parsed = parseGuidOrNull(propertyId)
  if (parsed) return parsed
  const guid = { sessionID: 1, localID: localIdCounter.value++ }
  context.propertyIdToGuid.set(propertyId, guid)
  context.assignedGuidValues?.add(`${guid.sessionID}:${guid.localID}`)
  return guid
}

export function isDescendantOf(
  context: SceneNodeToKiwiContext,
  nodeId: string,
  ancestorId: string
) {
  let current = context.graph.getNode(nodeId)
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = context.graph.getNode(current.parentId)
  }
  return false
}

export function applyColorVariableBinding(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  paint: Paint,
  field: string
): Paint {
  const variableId = node.boundVariables[field]
  // An imported paint carries the binding it arrived with. Unbinding the field has to clear
  // it, or the export hands Figma back a variable the document no longer references.
  if (!variableId) {
    if (!paint.colorVar) return paint
    const { colorVar: _cleared, ...unbound } = paint
    return unbound
  }
  return {
    ...paint,
    colorVar: {
      dataType: 'ALIAS',
      resolvedDataType: 'COLOR',
      value: { alias: { guid: context.varIdToGuid?.get(variableId) ?? stringToGuid(variableId) } }
    }
  }
}

function applyGradientStopBindings(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  paint: Paint,
  arrayKey: 'fills' | 'strokes',
  index: number
): Paint {
  const stops = paint.stopsVar ?? paint.stops
  if (!stops) return paint
  const stopsVar = stops.map((stop, stopIndex) => {
    const variableId = node.boundVariables[`${arrayKey}/${index}/gradientStops/${stopIndex}/color`]
    const { colorVar: _cleared, ...unbound } = stop as NonNullable<Paint['stopsVar']>[number]
    return variableId
      ? {
          ...unbound,
          colorVar: {
            dataType: 'ALIAS',
            resolvedDataType: 'COLOR',
            value: {
              alias: { guid: context.varIdToGuid?.get(variableId) ?? stringToGuid(variableId) }
            }
          }
        }
      : unbound
  })
  return { ...paint, stopsVar }
}

/** A node's fills with their colour variable aliases, for the record and for override claims alike. */
export function createFillPaints(context: SceneNodeToKiwiContext, node: SceneNode): Paint[] {
  return node.fills.map((fill, index) =>
    applyGradientStopBindings(
      context,
      node,
      applyColorVariableBinding(
        context,
        node,
        context.fillToKiwiPaint(fill),
        `fills/${index}/color`
      ),
      'fills',
      index
    )
  )
}

/** A stroke is a paint, so it writes the same way a fill does, gradients and images included. */
export function createStrokePaints(context: SceneNodeToKiwiContext, node: SceneNode): Paint[] {
  return node.strokes.map((stroke, index) =>
    applyGradientStopBindings(
      context,
      node,
      applyColorVariableBinding(
        context,
        node,
        context.fillToKiwiPaint({ ...stroke, type: stroke.type ?? 'SOLID' }),
        `strokes/${index}/color`
      ),
      'strokes',
      index
    )
  )
}

/** Instances address descendants by override key when one exists, else by node GUID. */
export function instanceGuidResolver(context: SceneNodeToKiwiContext, counter: { value: number }) {
  return (id: string): GUID | undefined => {
    const source = context.graph.getNode(id)
    return (
      (source?.overrideKey ? parseGuidOrNull(source.overrideKey) : null) ??
      getOrCreateNodeGuid(context, id, counter)
    )
  }
}
