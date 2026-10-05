/* eslint-disable max-lines -- FIG export orchestration keeps shared GUID state in one pipeline */
import type { CanvasKit } from 'canvaskit-wasm'
import { deflateSync, inflateSync } from 'fflate'
import { toUint8Array } from 'js-base64'

import { compressFigDataSync } from '@open-pencil/fig'
import {
  adaptPaintBindingsToSchema,
  buildComponentPropIndex,
  createFigNodeExportCaches,
  type FigNodeExportCaches,
  placeSlotContent,
  orderKeyBetween,
  exportCanvasGuides,
  guidToString,
  importCanvasGuides,
  materializeFigmaPayload,
  mergePluginData,
  remapFigmaMessageObjectAnimations,
  remapFigmaNodeReferences,
  stringToGuid,
  type FigNodeChangeExportRuntime
} from '@open-pencil/fig/node-change'
import { initCodec, getCompiledSchema, getSchemaBytes } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import {
  decodeBinarySchema,
  compileSchema,
  ByteBuffer,
  type Schema
} from '@open-pencil/kiwi/schema-runtime'
import { ownsSlotContent, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas'
import { CANVAS_BG_COLOR, IS_BROWSER, IS_TAURI } from '#core/constants'
import { applyEnabledLibrariesPluginData } from '#core/io/formats/fig/library-metadata'
import { projectLowcodeNodeForFigma } from '#core/io/formats/fig/lowcode-projection'
import { encodeNativeFigBuildPayload } from '#core/io/formats/fig/native-payload'
import { prepareFigmaProjectionFonts } from '#core/io/formats/fig/projection-fonts'
import { findFigThumbnailPageId } from '#core/io/formats/fig/thumbnail-page'
import { renderThumbnail } from '#core/io/formats/raster'
import type { FigWriteOptions, IOContext } from '#core/io/types'
import {
  remapSerializedLowcodeMotionActionReferences,
  resolveSerializedGraphNodeReference
} from '#core/kiwi/fig/node-change/lowcode-node-references'
import { serializeLowcodeFields } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import {
  createCoreFigExportRuntime,
  sceneNodeToKiwi,
  fractionalPosition,
  buildFontDigestMap,
  makeDocumentNodeChange,
  makeCanvasNodeChange
} from '#core/kiwi/fig/node-change/serialize'
import { cloneSceneGraphForFigExport } from '#core/kiwi/fig/parse/transfer'
import {
  FIGMA_CANVAS_METADATA_FIELD_KEYS,
  FIGMA_DOCUMENT_METADATA_FIELD_KEYS
} from '#core/kiwi/fig/root-metadata'
import { populateReaderExport } from '#core/kiwi/fig/session/document-state'
import { originalFigArchive } from '#core/kiwi/fig/session/original-archive'

interface CompatibleFigProjection {
  runtime: FigNodeChangeExportRuntime
  nodes: SceneNode[]
}

function createCompatibleFigProjection(graph: SceneGraph): CompatibleFigProjection {
  const plansByNodeId = new Map<
    string,
    NonNullable<ReturnType<typeof projectLowcodeNodeForFigma>>
  >()
  const nodes: SceneNode[] = []

  for (const node of graph.getAllNodes()) {
    const plan = projectLowcodeNodeForFigma(node, graph.getChildren(node.id))
    if (!plan) continue
    nodes.push(...plan.allNodes)
    for (const projectedNode of plan.allNodes) plansByNodeId.set(projectedNode.id, plan)
  }

  return {
    nodes,
    runtime: createCoreFigExportRuntime({
      getExportNode(node) {
        const plan = plansByNodeId.get(node.id)
        return plan?.sourceNodeId === node.id ? plan.root : node
      },
      getExportChildren(node, runtimeGraph) {
        const plan = plansByNodeId.get(node.id)
        if (!plan) return runtimeGraph.getChildren(node.id)
        const authoredChildren =
          node.id === plan.sourceNodeId ? runtimeGraph.getChildren(plan.sourceNodeId) : []
        return plan.childrenFor(node, authoredChildren)
      }
    })
  }
}

import {
  appendVariableNodeChanges,
  assignSharedStyleGuids,
  assignVariableGuid,
  assignVariableGuids
} from './variable-export'

const THUMBNAIL_1X1 = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
)

type KiwiNodeChange = NodeChange & Record<string, unknown>
type FigExportPage = ReturnType<SceneGraph['getPages']>[number]

interface FigSchemaContext {
  compiled: ReturnType<typeof getCompiledSchema>
  schemaDeflated: Uint8Array
  schema: Schema
}

function resolveFigSchema(graph: SceneGraph): FigSchemaContext {
  if (!graph.figSchemaDeflated) {
    return {
      compiled: getCompiledSchema(),
      schemaDeflated: deflateSync(getSchemaBytes()),
      schema: decodeBinarySchema(getSchemaBytes())
    }
  }
  const schemaBytes = inflateSync(graph.figSchemaDeflated)
  const figSchema = decodeBinarySchema(new ByteBuffer(schemaBytes))
  return {
    compiled: compileSchema(figSchema) as ReturnType<typeof getCompiledSchema>,
    schemaDeflated: graph.figSchemaDeflated,
    schema: figSchema
  }
}

function applyPreservedRootMetadata(
  rawNodeFields: Record<string, unknown>,
  nodeChange: KiwiNodeChange,
  fields: readonly (keyof NodeChange)[],
  blobs: Uint8Array[],
  blobIndexByHex: Map<string, number>
): void {
  for (const field of fields) {
    const value = rawNodeFields[field]
    if (value === undefined) continue
    nodeChange[field] = materializeFigmaPayload(value, blobs, {
      blobIndexByHex,
      includePaintVariables: true,
      includeVariableMaps: true
    })
  }
}

function makeExportDocumentNodeChange(
  graph: SceneGraph,
  docGuid: GUID,
  blobs: Uint8Array[],
  blobIndexByHex: Map<string, number>
): KiwiNodeChange {
  const documentNc = makeDocumentNodeChange(docGuid, graph.documentColorSpace)
  const rootNode = graph.getNode(graph.rootId)
  if (!rootNode) return documentNc

  applyPreservedRootMetadata(
    rootNode.source.fig.rawNodeFields,
    documentNc,
    FIGMA_DOCUMENT_METADATA_FIELD_KEYS,
    blobs,
    blobIndexByHex
  )
  applyEnabledLibrariesPluginData(documentNc, graph)
  const rootLowcode = serializeLowcodeFields(rootNode)
  const rootPluginData = (documentNc.pluginData ?? []).map((entry) => ({
    pluginId: entry.pluginID,
    key: entry.key,
    value: entry.value
  }))
  if (rootPluginData.length > 0 || rootLowcode.length > 0) {
    documentNc.pluginData = mergePluginData([...rootPluginData, ...rootLowcode])
  }
  return documentNc
}

function advanceCounterPastSourceGuids(
  graph: SceneGraph,
  localIdCounter: { value: number }
): Set<string> {
  let maxLocalId0 = localIdCounter.value - 1
  let maxLocalId1 = localIdCounter.value - 1
  const sourceGuidValues = new Set<string>()
  for (const node of graph.nodes.values()) {
    if (!node.source.id) continue
    sourceGuidValues.add(node.source.id)
    const guid = stringToGuid(node.source.id)
    if (guid.sessionID === 0) maxLocalId0 = Math.max(maxLocalId0, guid.localID)
    if (guid.sessionID === 1) maxLocalId1 = Math.max(maxLocalId1, guid.localID)
  }
  localIdCounter.value = Math.max(localIdCounter.value, maxLocalId0 + 1, maxLocalId1 + 1)
  return sourceGuidValues
}

function owningCanvasId(graph: SceneGraph, nodeId: string): string | null {
  let current = graph.getNode(nodeId)
  while (current) {
    if (current.type === 'CANVAS') return current.id
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

function remapExportedFigmaNodeReferences(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  nodeIdToGuid: ReadonlyMap<string, GUID>,
  documentGuid: GUID,
  schema: Schema
): unknown {
  const emittedGuidToNodeId = new Map<string, string>()
  for (const [nodeId, guid] of nodeIdToGuid) emittedGuidToNodeId.set(guidToString(guid), nodeId)
  emittedGuidToNodeId.set(guidToString(documentGuid), graph.rootId)

  const sourceGuidToNodeIds = new Map<string, string[]>()
  for (const node of graph.getAllNodes()) {
    const sourceGuid = node.source.id
    if (!sourceGuid || !nodeIdToGuid.has(node.id)) continue
    const candidates = sourceGuidToNodeIds.get(sourceGuid)
    if (candidates) candidates.push(node.id)
    else sourceGuidToNodeIds.set(sourceGuid, [node.id])
  }

  const canvasIdByNodeId = new Map<string, string | null>()
  const getCanvasId = (nodeId: string): string | null => {
    if (canvasIdByNodeId.has(nodeId)) return canvasIdByNodeId.get(nodeId) ?? null
    const canvasId = owningCanvasId(graph, nodeId)
    canvasIdByNodeId.set(nodeId, canvasId)
    return canvasId
  }

  for (const nodeChange of nodeChanges) {
    if (!nodeChange.guid) continue
    const ownerNodeId = emittedGuidToNodeId.get(guidToString(nodeChange.guid))
    if (!ownerNodeId) continue

    remapFigmaNodeReferences(
      nodeChange,
      (sourceGuid, path) => {
        if (path === 'paint.sourceNodeId') {
          const runtimeGuid = nodeIdToGuid.get(guidToString(sourceGuid))
          if (runtimeGuid) return runtimeGuid
        }
        const candidates = sourceGuidToNodeIds.get(guidToString(sourceGuid)) ?? []
        if (candidates.length === 0) return null
        if (candidates.length === 1) return nodeIdToGuid.get(candidates[0]) ?? null
        if (candidates.includes(ownerNodeId)) return nodeIdToGuid.get(ownerNodeId) ?? null

        const ownerCanvasId = getCanvasId(ownerNodeId)
        const scopedCandidates = candidates.filter(
          (candidateId) => getCanvasId(candidateId) === ownerCanvasId
        )
        return scopedCandidates.length === 1
          ? (nodeIdToGuid.get(scopedCandidates[0]) ?? null)
          : null
      },
      schema
    )
  }

  if (graph.figMessageObjectAnimations === null) return null
  return remapFigmaMessageObjectAnimations(
    structuredClone(graph.figMessageObjectAnimations),
    (sourceGuid) => {
      const candidates = sourceGuidToNodeIds.get(guidToString(sourceGuid)) ?? []
      if (candidates.length === 1) return nodeIdToGuid.get(candidates[0]) ?? null
      if (candidates.length > 1) return null
      return guidToString(sourceGuid) === guidToString(documentGuid) ? documentGuid : null
    }
  )
}

interface CanvasExportEntry {
  page: FigExportPage
  canvasGuid: GUID
  canvasNc: KiwiNodeChange
}

function collectImageEntries(graph: SceneGraph): Array<{ name: string; data: Uint8Array }> {
  const entries: Array<{ name: string; data: Uint8Array }> = []
  for (const [hash, data] of graph.images) {
    entries.push({ name: `images/${hash}`, data })
  }
  return entries
}

const THUMBNAIL_WIDTH = 512
const THUMBNAIL_HEIGHT = 512

async function renderFigThumbnail(
  graph: SceneGraph,
  pageId: string | undefined,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  renderHeadless = false
): Promise<Uint8Array> {
  if (!pageId) return THUMBNAIL_1X1
  if (ck && renderer) {
    return (
      renderThumbnail(ck, renderer, graph, pageId, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT) ??
      THUMBNAIL_1X1
    )
  }
  if (!renderHeadless || IS_BROWSER || IS_TAURI) return THUMBNAIL_1X1
  const { headlessRenderThumbnail } = await import('#core/io/formats/raster')
  return (
    (await headlessRenderThumbnail(graph, pageId, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)) ??
    THUMBNAIL_1X1
  )
}

interface ComponentPropertyGuidState {
  ids: string[]
  maxLocalId0: number
  maxLocalId1: number
}

function collectComponentPropertyGuidState(graph: SceneGraph): ComponentPropertyGuidState {
  const ids = new Set<string>()
  let maxLocalId0 = 0
  let maxLocalId1 = 0
  for (const node of graph.getAllNodes()) {
    for (const definition of node.componentPropertyDefinitions) ids.add(definition.id)
    for (const reference of node.componentPropertyReferences) ids.add(reference.propertyId)
    for (const propertyId of Object.keys(node.componentPropertyAssignments)) ids.add(propertyId)
    for (const spec of node.variantPropSpecs) ids.add(spec.propDefId)
  }
  for (const propertyId of ids) {
    const match = /^(\d+):(\d+)$/.exec(propertyId)
    if (!match) continue
    const sessionID = Number.parseInt(match[1], 10)
    const localID = Number.parseInt(match[2], 10)
    if (sessionID === 0) maxLocalId0 = Math.max(maxLocalId0, localID)
    if (sessionID === 1) maxLocalId1 = Math.max(maxLocalId1, localID)
  }
  return { ids: [...ids], maxLocalId0, maxLocalId1 }
}

function assignComponentPropertyGuids(
  propertyIds: readonly string[],
  localIdCounter: { value: number },
  propertyIdToGuid: Map<string, GUID>,
  assignedGuidValues: Set<string>,
  nodeSourceGuidValues: Set<string>
): void {
  for (const propertyId of propertyIds) {
    const guid = assignVariableGuid(
      propertyId,
      localIdCounter,
      assignedGuidValues,
      nodeSourceGuidValues
    )
    propertyIdToGuid.set(propertyId, guid)
  }
}

function applyImportedCanvasFields(
  page: FigExportPage,
  canvasNc: KiwiNodeChange,
  blobs: Uint8Array[],
  blobIndexByHex: Map<string, number>
): void {
  if (!page.source.id && Object.keys(page.source.fig.rawNodeFields).length === 0) return
  if (!('pageType' in page.source.fig.rawNodeFields)) delete canvasNc.pageType
  applyPreservedRootMetadata(
    page.source.fig.rawNodeFields,
    canvasNc,
    FIGMA_CANVAS_METADATA_FIELD_KEYS,
    blobs,
    blobIndexByHex
  )
  if (page.guides.length > 0) {
    const normalized = exportCanvasGuides(page.guides)
    const raw = page.source.fig.rawNodeFields.guides
    canvasNc.guides =
      Array.isArray(raw) && JSON.stringify(importCanvasGuides(raw)) === JSON.stringify(page.guides)
        ? structuredClone(raw)
        : normalized
  }
}

function buildCanvasEntries(
  graph: SceneGraph,
  pages: FigExportPage[],
  docGuid: GUID,
  localIdCounter: { value: number },
  nodeIdToGuid: Map<string, GUID>,
  assignedGuidValues: Set<string>,
  blobs: Uint8Array[],
  blobIndexByHex: Map<string, number>
): { canvasEntries: CanvasExportEntry[]; internalCanvasGuid: GUID | null } {
  const canvasEntries: CanvasExportEntry[] = []
  let internalCanvasGuid: GUID | null = null
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]
    const canvasGuid = (() => {
      if (!page.source.id) return { sessionID: 0, localID: localIdCounter.value++ }

      const importedGuid = stringToGuid(page.source.id)
      const key = `${importedGuid.sessionID}:${importedGuid.localID}`

      if (!assignedGuidValues.has(key)) return importedGuid

      return { sessionID: 0, localID: localIdCounter.value++ }
    })()
    // Advance counter past any source.id-derived GUID to prevent collisions
    // with subsequently generated variable/collection GUIDs.
    if (page.source.id && canvasGuid.sessionID === 0) {
      localIdCounter.value = Math.max(localIdCounter.value, canvasGuid.localID + 1)
    }
    nodeIdToGuid.set(page.id, canvasGuid)
    assignedGuidValues.add(`${canvasGuid.sessionID}:${canvasGuid.localID}`)
    if (page.internalOnly) internalCanvasGuid = canvasGuid

    const canvasNc = makeCanvasNodeChange(
      canvasGuid,
      docGuid,
      page.source.orderKey ?? fractionalPosition(p),
      page.name,
      {
        backgroundOpacity: 1,
        backgroundColor: { ...CANVAS_BG_COLOR },
        backgroundEnabled: true
      }
    )
    applyImportedCanvasFields(page, canvasNc, blobs, blobIndexByHex)
    const pageLowcode = serializeLowcodeFields(page)
    if (page.pluginData.length > 0 || pageLowcode.length > 0) {
      canvasNc.pluginData = mergePluginData([...page.pluginData, ...pageLowcode])
    }
    if (page.internalOnly) canvasNc.internalOnly = true
    canvasEntries.push({ page, canvasGuid, canvasNc })
  }

  const hasSharedStyles = [...graph.nodes.values()].some((node) => node.sharedStyleType !== null)
  const hasSlotContent = [...graph.nodes.values()].some((node) => ownsSlotContent(graph, node))
  if (
    (graph.variableCollections.size > 0 || hasSharedStyles || hasSlotContent) &&
    internalCanvasGuid === null
  ) {
    internalCanvasGuid = { sessionID: 0, localID: localIdCounter.value++ }
    assignedGuidValues.add(`${internalCanvasGuid.sessionID}:${internalCanvasGuid.localID}`)
    canvasEntries.push({
      page: { id: '', name: 'Internal Only Canvas', internalOnly: true } as FigExportPage,
      canvasGuid: internalCanvasGuid,
      canvasNc: makeCanvasNodeChange(
        internalCanvasGuid,
        docGuid,
        fractionalPosition(canvasEntries.length),
        'Internal Only Canvas',
        { internalOnly: true }
      )
    })
  }

  return { canvasEntries, internalCanvasGuid }
}

interface InternalResourceContext {
  caches: FigNodeExportCaches
  graph: SceneGraph
  nodeChanges: KiwiNodeChange[]
  internalCanvasGuid: GUID | null
  localIdCounter: { value: number }
  blobs: Uint8Array[]
  nodeIdToGuid: Map<string, GUID>
  fontDigestMap: Map<string, Uint8Array>
  varIdToGuid: Map<string, GUID>
  modeIdToGuid: Map<string, GUID>
  glyphBlobMap: Map<string, number>
  blobIndexByHex: Map<string, number>
  assignedGuidValues: Set<string>
  componentPropertyDefinitionsById: ReturnType<typeof buildComponentPropIndex>
  runtime: FigNodeChangeExportRuntime
  propertyIdToGuid: Map<string, GUID>
}

/** Allocate resource keys after the canvas layers, including retained imported keys. */
function positionsAfterCanvasChildren(changes: readonly NodeChange[], canvas: GUID): () => string {
  let previous: string | null = null
  for (const change of changes) {
    const parent = change.parentIndex?.guid
    const position = change.parentIndex?.position
    if (parent?.sessionID !== canvas.sessionID || parent.localID !== canvas.localID || !position)
      continue
    if (previous === null || position > previous) previous = position
  }
  return () => {
    const position = orderKeyBetween(previous, null)
    if (position === null) throw new Error('Cannot allocate a canvas resource order key')
    previous = position
    return position
  }
}

function appendInternalResources(context: InternalResourceContext): void {
  const { graph, internalCanvasGuid, nodeChanges } = context
  if (!internalCanvasGuid) return
  const relocatedStyles: KiwiNodeChange[][] = []
  const sharedStyleNodes = [...graph.nodes.values()].filter((node) => node.sharedStyleType !== null)
  for (let index = 0; index < sharedStyleNodes.length; index++) {
    const records = sceneNodeToKiwi(
      sharedStyleNodes[index],
      internalCanvasGuid,
      index,
      context.localIdCounter,
      graph,
      context.blobs,
      {
        caches: context.caches,
        nodeIdToGuid: context.nodeIdToGuid,
        fontDigestMap: context.fontDigestMap,
        varIdToGuid: context.varIdToGuid,
        glyphBlobMap: context.glyphBlobMap,
        blobIndexByHex: context.blobIndexByHex,
        assignedGuidValues: context.assignedGuidValues,
        componentPropertyDefinitionsById: context.componentPropertyDefinitionsById,
        modeIdToGuid: context.modeIdToGuid,
        runtime: context.runtime,
        propertyIdToGuid: context.propertyIdToGuid
      }
    )
    const node = sharedStyleNodes[index]
    const sourceParent = context.nodeIdToGuid.get(node.parentId ?? '')
    if (
      node.source.format === 'fig' &&
      sourceParent?.sessionID === internalCanvasGuid.sessionID &&
      sourceParent.localID === internalCanvasGuid.localID
    ) {
      // Authored styles share the canvas's native layer order, including interleaved keys.
      nodeChanges.push(...records)
    } else {
      relocatedStyles.push(records)
    }
  }
  const nextPosition = positionsAfterCanvasChildren(nodeChanges, internalCanvasGuid)
  for (const records of relocatedStyles) {
    if (records[0]?.parentIndex) records[0].parentIndex.position = nextPosition()
    nodeChanges.push(...records)
  }
  if (graph.variableCollections.size > 0) {
    appendVariableNodeChanges(
      graph,
      nodeChanges,
      internalCanvasGuid,
      context.varIdToGuid,
      context.modeIdToGuid,
      nextPosition
    )
  }
}

export type ExportFigFileOptions = FigWriteOptions & IOContext

/**
 * Backward-compatible positional API. It intentionally keeps the historical
 * roundtrip profile; Figma-targeted callers use exportFigFileWithOptions.
 */
export function exportFigFile(
  sourceGraph: SceneGraph,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  pageId?: string,
  renderHeadlessThumbnail = false
): Promise<Uint8Array> {
  return exportFigFileWithOptions(sourceGraph, {
    canvasKit: ck,
    renderer,
    thumbnailPageId: pageId,
    renderThumbnail: renderHeadlessThumbnail,
    profile: 'roundtrip'
  })
}

function nativeFigArchiveBytes(response: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (response instanceof ArrayBuffer) return new Uint8Array(response)
  if (ArrayBuffer.isView(response)) {
    return new Uint8Array(response.buffer, response.byteOffset, response.byteLength)
  }
  return Uint8Array.from(response)
}

export async function exportFigFileWithOptions(
  sourceGraph: SceneGraph,
  options: ExportFigFileOptions = {}
): Promise<Uint8Array> {
  const {
    canvasKit: ck,
    renderer,
    thumbnailPageId: pageId,
    renderThumbnail: renderHeadlessThumbnail = false
  } = options
  const profile = options.profile ?? 'roundtrip'
  if (profile === 'roundtrip') {
    const originalArchive = await originalFigArchive(sourceGraph)
    if (originalArchive) return originalArchive.slice()
  }
  // Lazy population synchronizes component trees and therefore mutates its graph. Saving must not
  // rewrite the live editor document or restore component values over edits made by the user.
  const graph = cloneSceneGraphForFigExport(sourceGraph)
  populateReaderExport(sourceGraph, graph)
  await initCodec()

  // When the document was imported from a .fig file, preserve the original
  // kiwi schema for both encoding and embedding. For the current version of
  // Figma, likely for quite some time, schema has more types/fields than our
  // subset, and using our schema to encode would produce field IDs that don't
  // align with the embedded schema. By compiling and using the original
  // schema, we improve the roundtrip-ability... This requires further work.
  const { compiled, schemaDeflated, schema } = resolveFigSchema(graph)

  const docGuid = { sessionID: 0, localID: 0 }
  const localIdCounter = { value: 2 }

  const blobs: Uint8Array[] = []
  const blobIndexByHex = new Map<string, number>()

  const documentNc = makeExportDocumentNodeChange(graph, docGuid, blobs, blobIndexByHex)
  const nodeChanges: KiwiNodeChange[] = [documentNc]

  const pages = graph.getPages(true)
  const nodeIdToGuid = new Map<string, GUID>()
  const assignedGuidValues = new Set<string>()
  // Reserve the document GUID to prevent imported nodes with source.id "0:0"
  // from reusing the document's own GUID slot.
  assignedGuidValues.add(`${docGuid.sessionID}:${docGuid.localID}`)
  const varIdToGuid = new Map<string, GUID>()
  const modeIdToGuid = new Map<string, GUID>()
  const propertyIdToGuid = new Map<string, GUID>()
  const compatibleProjection =
    profile === 'figma-compatible' ? createCompatibleFigProjection(graph) : null
  if (compatibleProjection) await prepareFigmaProjectionFonts(compatibleProjection.nodes)
  const runtime = compatibleProjection?.runtime ?? createCoreFigExportRuntime()
  const fontDigestMap = await buildFontDigestMap(graph, compatibleProjection?.nodes)
  const glyphBlobMap = new Map<string, number>()
  const componentPropertyDefinitionsById = buildComponentPropIndex(graph)
  const caches = createFigNodeExportCaches(graph)

  // Scan ALL imported source.ids BEFORE any new GUID assignment to find
  // max sessionID:0 and sessionID:1 localID values. This guarantees the
  // counter is past every imported GUID before any canvas, variable, or
  // node claims a new counter-based GUID — preventing collisions.
  const nodeSourceGuidValues = advanceCounterPastSourceGuids(graph, localIdCounter)
  const propertyGuidState = collectComponentPropertyGuidState(graph)
  localIdCounter.value = Math.max(
    localIdCounter.value,
    propertyGuidState.maxLocalId0 + 1,
    propertyGuidState.maxLocalId1 + 1
  )

  const { canvasEntries, internalCanvasGuid } = buildCanvasEntries(
    graph,
    pages,
    docGuid,
    localIdCounter,
    nodeIdToGuid,
    assignedGuidValues,
    blobs,
    blobIndexByHex
  )

  // Assign variable GUIDs AFTER canvas entries so that source.id-derived
  // canvas GUIDs don't collide with generated variable GUIDs.
  assignVariableGuids(
    graph,
    localIdCounter,
    varIdToGuid,
    modeIdToGuid,
    assignedGuidValues,
    nodeSourceGuidValues
  )

  assignComponentPropertyGuids(
    propertyGuidState.ids,
    localIdCounter,
    propertyIdToGuid,
    assignedGuidValues,
    nodeSourceGuidValues
  )

  for (const entry of canvasEntries) nodeChanges.push(entry.canvasNc)

  assignSharedStyleGuids(
    [...graph.nodes.values()].filter((node) => node.sharedStyleType !== null),
    localIdCounter,
    nodeIdToGuid,
    assignedGuidValues
  )

  const orderedCanvasEntries = [
    ...canvasEntries.filter((entry) => entry.page.internalOnly),
    ...canvasEntries.filter((entry) => !entry.page.internalOnly)
  ]
  const slotContentRecords: KiwiNodeChange[] = []
  for (const { page, canvasGuid } of orderedCanvasEntries) {
    const children = graph
      .getChildren(page.id)
      .filter((child) => !child.internalOnly && child.sharedStyleType === null)
    for (let i = 0; i < children.length; i++) {
      nodeChanges.push(
        ...sceneNodeToKiwi(children[i], canvasGuid, i, localIdCounter, graph, blobs, {
          caches,
          nodeIdToGuid,
          fontDigestMap,
          varIdToGuid,
          glyphBlobMap,
          blobIndexByHex,
          assignedGuidValues,
          componentPropertyDefinitionsById,
          modeIdToGuid,
          propertyIdToGuid,
          slotContentRecords,
          runtime
        })
      )
    }
  }
  appendInternalResources({
    caches,
    graph,
    nodeChanges,
    internalCanvasGuid,
    localIdCounter,
    blobs,
    nodeIdToGuid,
    fontDigestMap,
    varIdToGuid,
    modeIdToGuid,
    glyphBlobMap,
    blobIndexByHex,
    assignedGuidValues,
    componentPropertyDefinitionsById,
    runtime,
    propertyIdToGuid
  })
  if (internalCanvasGuid) {
    const nextPosition = positionsAfterCanvasChildren(nodeChanges, internalCanvasGuid)
    placeSlotContent(slotContentRecords, internalCanvasGuid, 0, nextPosition)
    nodeChanges.push(...slotContentRecords)
  }

  remapSerializedLowcodeMotionActionReferences(nodeChanges, (nodeId) => {
    return resolveSerializedGraphNodeReference(graph, nodeIdToGuid, nodeId)
  })

  const messageObjectAnimations = remapExportedFigmaNodeReferences(
    graph,
    nodeChanges,
    nodeIdToGuid,
    docGuid,
    schema
  )

  const msg: Record<string, unknown> = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges
  }

  if (blobs.length > 0) {
    msg.blobs = blobs.map((bytes) => ({ bytes }))
  }
  if (messageObjectAnimations !== null) msg.objectAnimations = messageObjectAnimations

  adaptPaintBindingsToSchema(nodeChanges, schema)
  const kiwiData = compiled.encodeMessage(msg)

  const currentPageId = pageId ?? findFigThumbnailPageId(pages)
  const thumbnailPNG = await renderFigThumbnail(
    graph,
    currentPageId,
    ck,
    renderer,
    renderHeadlessThumbnail
  )

  const metaJSON = JSON.stringify({
    version: 1,
    app: 'OpenPencil',
    createdAt: new Date().toISOString()
  })

  const imageEntries = collectImageEntries(graph)

  const version = graph.figKiwiVersion ?? undefined

  if (IS_TAURI) {
    const { invoke } = await import('@tauri-apps/api/core')
    const response = await invoke<ArrayBuffer | Uint8Array | number[]>(
      'build_fig_file',
      encodeNativeFigBuildPayload({
        schemaDeflated,
        kiwiData,
        thumbnailPng: thumbnailPNG,
        metaJson: metaJSON,
        images: imageEntries,
        figKiwiVersion: version
      })
    )
    return nativeFigArchiveBytes(response)
  }

  return compressFigData(schemaDeflated, kiwiData, thumbnailPNG, metaJSON, imageEntries, version)
}

export { compressFigDataSync } from '@open-pencil/fig'

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && IS_BROWSER
}

function compressViaWorker(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export-worker.ts', import.meta.url), {
      type: 'module'
    })

    worker.onmessage = (e: MessageEvent<Uint8Array>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = (err) => {
      reject(new Error(err.message))
      worker.terminate()
    }

    // Do NOT use transferables here. toUint8Array() in ByteBuffer returns a view of the
    // internal buffer, so transferring kiwiData.buffer or schemaDeflated.buffer detaches
    // buffers that may be shared with other views, causing "already detached" errors on
    // subsequent saves. Structured clone (the default) copies the data safely.
    worker.postMessage({
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      images: imageEntries,
      figKiwiVersion
    })
  })
}

export function compressFigData(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number
): Promise<Uint8Array> {
  if (canUseWorker()) {
    return compressViaWorker(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      figKiwiVersion
    )
  }
  return Promise.resolve(
    compressFigDataSync(
      schemaDeflated,
      kiwiData,
      thumbnailPNG,
      metaJSON,
      imageEntries,
      figKiwiVersion
    )
  )
}
