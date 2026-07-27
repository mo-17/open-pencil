/* eslint-disable max-lines -- FIG export orchestration keeps shared GUID state in one pipeline */
import type { CanvasKit } from 'canvaskit-wasm'
import { deflateSync, inflateSync } from 'fflate'

import { compressFigDataSync } from '@open-pencil/fig'
import {
  buildComponentPropIndex,
  mergePluginData,
  stringToGuid,
  type FigNodeChangeExportRuntime
} from '@open-pencil/fig/node-change'
import { initCodec, getCompiledSchema, getSchemaBytes } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { decodeBinarySchema, compileSchema, ByteBuffer } from '@open-pencil/kiwi/schema-runtime'
import type { SceneGraph, SceneNode, VariableValue } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas'
import { CANVAS_BG_COLOR, IS_BROWSER, IS_TAURI } from '#core/constants'
import { projectLowcodeNodeForFigma } from '#core/io/formats/fig/lowcode-projection'
import { prepareFigmaProjectionFonts } from '#core/io/formats/fig/projection-fonts'
import { renderThumbnail } from '#core/io/formats/raster'
import type { FigWriteOptions, IOContext } from '#core/io/types'
import { populateAllLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { serializeLowcodeFields } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import {
  createCoreFigExportRuntime,
  sceneNodeToKiwi,
  fractionalPosition,
  buildFontDigestMap,
  safeColor,
  makeDocumentNodeChange,
  makeCanvasNodeChange
} from '#core/kiwi/fig/node-change/serialize'

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

const THUMBNAIL_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
)

type KiwiNodeChange = NodeChange & Record<string, unknown>
type FigExportPage = ReturnType<SceneGraph['getPages']>[number]

interface FigSchemaContext {
  compiled: ReturnType<typeof getCompiledSchema>
  schemaDeflated: Uint8Array
}

function resolveFigSchema(graph: SceneGraph): FigSchemaContext {
  if (!graph.figSchemaDeflated) {
    return {
      compiled: getCompiledSchema(),
      schemaDeflated: deflateSync(getSchemaBytes())
    }
  }
  const schemaBytes = inflateSync(graph.figSchemaDeflated)
  const figSchema = decodeBinarySchema(new ByteBuffer(schemaBytes))
  return {
    compiled: compileSchema(figSchema) as ReturnType<typeof getCompiledSchema>,
    schemaDeflated: graph.figSchemaDeflated
  }
}

function makeExportDocumentNodeChange(graph: SceneGraph, docGuid: GUID): KiwiNodeChange {
  const documentNc = makeDocumentNodeChange(docGuid, graph.documentColorSpace)
  const rootNode = graph.getNode(graph.rootId)
  if (!rootNode) return documentNc

  Object.assign(documentNc, rootNode.source.fig.rawNodeFields)
  const rootLowcode = serializeLowcodeFields(rootNode)
  if (rootLowcode.length > 0) {
    documentNc.pluginData = mergePluginData([...rootNode.pluginData, ...rootLowcode])
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

interface CanvasExportEntry {
  page: FigExportPage
  canvasGuid: GUID
  canvasNc: KiwiNodeChange
}

function variableValueToKiwi(
  value: VariableValue,
  type: string,
  varIdToGuid: Map<string, GUID>
): { value: Record<string, unknown>; dataType: string; resolvedDataType: string } {
  if (value && typeof value === 'object' && 'aliasId' in value) {
    const aliasGuid = varIdToGuid.get(value.aliasId) ?? stringToGuid(value.aliasId)
    return {
      value: { alias: { guid: aliasGuid } },
      dataType: 'ALIAS',
      resolvedDataType: { COLOR: 'COLOR', BOOLEAN: 'BOOLEAN', STRING: 'STRING' }[type] ?? 'FLOAT'
    }
  }
  if (type === 'COLOR' && typeof value === 'object' && 'r' in value) {
    return {
      value: { colorValue: safeColor(value) },
      dataType: 'COLOR',
      resolvedDataType: 'COLOR'
    }
  }
  if (type === 'BOOLEAN') {
    return { value: { boolValue: !!value }, dataType: 'BOOLEAN', resolvedDataType: 'BOOLEAN' }
  }
  if (type === 'STRING') {
    return {
      value: { textValue: typeof value === 'string' ? value : JSON.stringify(value) },
      dataType: 'STRING',
      resolvedDataType: 'STRING'
    }
  }
  return { value: { floatValue: Number(value) }, dataType: 'FLOAT', resolvedDataType: 'FLOAT' }
}

function collectImageEntries(graph: SceneGraph): Array<{ name: string; data: Uint8Array }> {
  const entries: Array<{ name: string; data: Uint8Array }> = []
  for (const [hash, data] of graph.images) {
    entries.push({ name: `images/${hash}`, data })
  }
  return entries
}

const THUMBNAIL_WIDTH = 400
const THUMBNAIL_HEIGHT = 225

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

function assignVariableGuid(
  id: string,
  localIdCounter: { value: number },
  assignedGuidValues: Set<string>,
  nodeSourceGuidValues: Set<string>
): GUID {
  if (/^\d+:\d+$/.test(id) && !assignedGuidValues.has(id) && !nodeSourceGuidValues.has(id)) {
    const guid = stringToGuid(id)
    assignedGuidValues.add(id)
    return guid
  }
  const guid = { sessionID: 0, localID: localIdCounter.value++ }
  assignedGuidValues.add(`${guid.sessionID}:${guid.localID}`)
  return guid
}

function assignVariableGuids(
  graph: SceneGraph,
  localIdCounter: { value: number },
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>,
  assignedGuidValues: Set<string>,
  nodeSourceGuidValues: Set<string>
): void {
  for (const [colId, col] of graph.variableCollections) {
    const colGuid = assignVariableGuid(
      colId,
      localIdCounter,
      assignedGuidValues,
      nodeSourceGuidValues
    )
    varIdToGuid.set(colId, colGuid)
    for (const mode of col.modes) {
      const modeGuid = assignVariableGuid(
        mode.modeId,
        localIdCounter,
        assignedGuidValues,
        nodeSourceGuidValues
      )
      modeIdToGuid.set(mode.modeId, modeGuid)
    }
    for (const varId of col.variableIds) {
      const varGuid = assignVariableGuid(
        varId,
        localIdCounter,
        assignedGuidValues,
        nodeSourceGuidValues
      )
      varIdToGuid.set(varId, varGuid)
    }
  }
}

function appendVariableNodeChanges(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  internalCanvasGuid: GUID,
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>
): void {
  let collIdx = 0
  for (const [colId, col] of graph.variableCollections) {
    const colGuid = varIdToGuid.get(colId) ?? stringToGuid(colId)
    nodeChanges.push({
      guid: colGuid,
      parentIndex: { guid: internalCanvasGuid, position: fractionalPosition(collIdx++) },
      type: 'VARIABLE_SET',
      name: col.name,
      phase: 'CREATED',
      strokeAlign: 'CENTER',
      strokeJoin: 'BEVEL',
      variableSetModes: col.modes.map((m, i) => {
        const mGuid = modeIdToGuid.get(m.modeId) ?? stringToGuid(m.modeId)
        return { id: mGuid, name: m.name, sortPosition: fractionalPosition(i) }
      })
    })

    appendVariablesForCollection(
      graph,
      nodeChanges,
      colGuid,
      internalCanvasGuid,
      col.variableIds,
      varIdToGuid,
      modeIdToGuid
    )
  }
}

function appendVariablesForCollection(
  graph: SceneGraph,
  nodeChanges: KiwiNodeChange[],
  colGuid: GUID,
  parentGuid: GUID,
  variableIds: string[],
  varIdToGuid: Map<string, GUID>,
  modeIdToGuid: Map<string, GUID>
): void {
  let varIdx = 0
  for (const varId of variableIds) {
    const variable = graph.variables.get(varId)
    if (!variable) continue

    const varGuid = varIdToGuid.get(varId) ?? stringToGuid(varId)
    const typeMap: Record<string, string> = {
      COLOR: 'COLOR',
      BOOLEAN: 'BOOLEAN',
      STRING: 'STRING'
    }
    const resolvedType = typeMap[variable.type] ?? 'FLOAT'

    const entries = Object.entries(variable.valuesByMode).map(([modeId, value]) => ({
      modeID: modeIdToGuid.get(modeId) ?? stringToGuid(modeId),
      variableData: variableValueToKiwi(value, variable.type, varIdToGuid)
    }))

    const nc: KiwiNodeChange = {
      guid: varGuid,
      parentIndex: { guid: parentGuid, position: fractionalPosition(varIdx++) },
      type: 'VARIABLE',
      name: variable.name,
      phase: 'CREATED',
      strokeAlign: 'CENTER',
      strokeJoin: 'BEVEL',
      variableSetID: { guid: colGuid },
      variableResolvedType: resolvedType,
      variableDataValues: { entries },
      variableScopes: ['ALL_SCOPES']
    }
    // Preserve library key/version on VARIABLE NodeChanges so that
    // buildAssetRefMap can resolve assetRef to guid on reimport.
    if (variable.key) nc.key = variable.key
    if (variable.version) nc.version = variable.version
    nodeChanges.push(nc)
  }
}

function applyImportedCanvasFields(page: FigExportPage, canvasNc: KiwiNodeChange): void {
  if (!page.source.id) return
  if (!('pageType' in page.source.fig.rawNodeFields)) delete canvasNc.pageType
  if ('backgroundColor' in page.source.fig.rawNodeFields) {
    canvasNc.backgroundColor = structuredClone(page.source.fig.rawNodeFields.backgroundColor)
  }
  if ('backgroundPaints' in page.source.fig.rawNodeFields) {
    canvasNc.backgroundPaints = structuredClone(
      page.source.fig.rawNodeFields.backgroundPaints
    ) as NodeChange['backgroundPaints']
  }
  if ('guides' in page.source.fig.rawNodeFields) {
    canvasNc.guides = structuredClone(page.source.fig.rawNodeFields.guides)
  }
  const strokeJoin = page.source.fig.rawNodeFields.strokeJoin
  if (typeof strokeJoin === 'string') canvasNc.strokeJoin = strokeJoin
  const strokeWeight = page.source.fig.rawNodeFields.strokeWeight
  if (typeof strokeWeight === 'number') canvasNc.strokeWeight = strokeWeight
}

function buildCanvasEntries(
  graph: SceneGraph,
  pages: FigExportPage[],
  docGuid: GUID,
  localIdCounter: { value: number },
  nodeIdToGuid: Map<string, GUID>,
  assignedGuidValues: Set<string>
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
    applyImportedCanvasFields(page, canvasNc)
    const pageLowcode = serializeLowcodeFields(page)
    if (pageLowcode.length > 0) {
      canvasNc.pluginData = mergePluginData([...page.pluginData, ...pageLowcode])
    }
    if (page.internalOnly) canvasNc.internalOnly = true
    canvasEntries.push({ page, canvasGuid, canvasNc })
  }

  const hasSharedStyles = [...graph.nodes.values()].some((node) => node.sharedStyleType !== null)
  if ((graph.variableCollections.size > 0 || hasSharedStyles) && internalCanvasGuid === null) {
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
}

function appendInternalResources(context: InternalResourceContext): void {
  const { graph, internalCanvasGuid, nodeChanges } = context
  if (!internalCanvasGuid) return
  const sharedStyleNodes = [...graph.nodes.values()].filter((node) => node.sharedStyleType !== null)
  for (let index = 0; index < sharedStyleNodes.length; index++) {
    nodeChanges.push(
      ...sceneNodeToKiwi(
        sharedStyleNodes[index],
        internalCanvasGuid,
        index,
        context.localIdCounter,
        graph,
        context.blobs,
        context.nodeIdToGuid,
        context.fontDigestMap,
        context.varIdToGuid,
        context.glyphBlobMap,
        context.blobIndexByHex,
        context.assignedGuidValues,
        context.componentPropertyDefinitionsById,
        context.modeIdToGuid,
        context.runtime
      )
    )
  }
  if (graph.variableCollections.size > 0) {
    appendVariableNodeChanges(
      graph,
      nodeChanges,
      internalCanvasGuid,
      context.varIdToGuid,
      context.modeIdToGuid
    )
  }
}

export type ExportFigFileOptions = FigWriteOptions & IOContext

/**
 * Backward-compatible positional API. It intentionally keeps the historical
 * roundtrip profile; Figma-targeted callers use exportFigFileWithOptions.
 */
export function exportFigFile(
  graph: SceneGraph,
  ck?: CanvasKit,
  renderer?: SkiaRenderer,
  pageId?: string,
  renderHeadlessThumbnail = false
): Promise<Uint8Array> {
  return exportFigFileWithOptions(graph, {
    canvasKit: ck,
    renderer,
    thumbnailPageId: pageId,
    renderThumbnail: renderHeadlessThumbnail,
    profile: 'roundtrip'
  })
}

export async function exportFigFileWithOptions(
  graph: SceneGraph,
  options: ExportFigFileOptions = {}
): Promise<Uint8Array> {
  const {
    canvasKit: ck,
    renderer,
    thumbnailPageId: pageId,
    renderThumbnail: renderHeadlessThumbnail = false
  } = options
  const profile = options.profile ?? 'roundtrip'
  populateAllLazyFigImportRoots(graph)
  await initCodec()

  // When the document was imported from a .fig file, preserve the original
  // kiwi schema for both encoding and embedding. For the current version of
  // Figma, likely for quite some time, schema has more types/fields than our
  // subset, and using our schema to encode would produce field IDs that don't
  // align with the embedded schema. By compiling and using the original
  // schema, we improve the roundtrip-ability... This requires further work.
  const { compiled, schemaDeflated } = resolveFigSchema(graph)

  const docGuid = { sessionID: 0, localID: 0 }
  const localIdCounter = { value: 2 }

  const documentNc = makeExportDocumentNodeChange(graph, docGuid)
  const nodeChanges: KiwiNodeChange[] = [documentNc]

  const blobs: Uint8Array[] = []
  const pages = graph.getPages(true)
  const nodeIdToGuid = new Map<string, GUID>()
  const assignedGuidValues = new Set<string>()
  // Reserve the document GUID to prevent imported nodes with source.id "0:0"
  // from reusing the document's own GUID slot.
  assignedGuidValues.add(`${docGuid.sessionID}:${docGuid.localID}`)
  const varIdToGuid = new Map<string, GUID>()
  const modeIdToGuid = new Map<string, GUID>()
  const compatibleProjection =
    profile === 'figma-compatible' ? createCompatibleFigProjection(graph) : null
  if (compatibleProjection) await prepareFigmaProjectionFonts(compatibleProjection.nodes)
  const runtime = compatibleProjection?.runtime ?? createCoreFigExportRuntime()
  const fontDigestMap = await buildFontDigestMap(graph, compatibleProjection?.nodes)
  const glyphBlobMap = new Map<string, number>()
  const blobIndexByHex = new Map<string, number>()
  const componentPropertyDefinitionsById = buildComponentPropIndex(graph)

  // Scan ALL imported source.ids BEFORE any new GUID assignment to find
  // max sessionID:0 and sessionID:1 localID values. This guarantees the
  // counter is past every imported GUID before any canvas, variable, or
  // node claims a new counter-based GUID — preventing collisions.
  const nodeSourceGuidValues = advanceCounterPastSourceGuids(graph, localIdCounter)

  const { canvasEntries, internalCanvasGuid } = buildCanvasEntries(
    graph,
    pages,
    docGuid,
    localIdCounter,
    nodeIdToGuid,
    assignedGuidValues
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

  for (const entry of canvasEntries) nodeChanges.push(entry.canvasNc)

  const orderedCanvasEntries = [
    ...canvasEntries.filter((entry) => entry.page.internalOnly),
    ...canvasEntries.filter((entry) => !entry.page.internalOnly)
  ]
  for (const { page, canvasGuid } of orderedCanvasEntries) {
    const children = graph.getChildren(page.id).filter((child) => !child.internalOnly)
    for (let i = 0; i < children.length; i++) {
      nodeChanges.push(
        ...sceneNodeToKiwi(
          children[i],
          canvasGuid,
          i,
          localIdCounter,
          graph,
          blobs,
          nodeIdToGuid,
          fontDigestMap,
          varIdToGuid,
          glyphBlobMap,
          blobIndexByHex,
          assignedGuidValues,
          componentPropertyDefinitionsById,
          modeIdToGuid,
          runtime
        )
      )
    }
  }

  appendInternalResources({
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
    runtime
  })

  const msg: Record<string, unknown> = {
    type: 'NODE_CHANGES',
    sessionID: 0,
    ackID: 0,
    nodeChanges
  }

  if (blobs.length > 0) {
    msg.blobs = blobs.map((bytes) => ({ bytes }))
  }

  const kiwiData = compiled.encodeMessage(msg)

  const currentPageId = pageId ?? pages[0]?.id
  const thumbnailPng = await renderFigThumbnail(
    graph,
    currentPageId,
    ck,
    renderer,
    renderHeadlessThumbnail
  )

  const metaJson = JSON.stringify({
    version: 1,
    app: 'OpenPencil',
    createdAt: new Date().toISOString()
  })

  const imageEntries = collectImageEntries(graph)

  const version = graph.figKiwiVersion ?? undefined

  if (IS_TAURI) {
    const { invoke } = await import('@tauri-apps/api/core')
    return new Uint8Array(
      await invoke<number[]>('build_fig_file', {
        schemaDeflated: Array.from(schemaDeflated),
        kiwiData: Array.from(kiwiData),
        thumbnailPng: Array.from(thumbnailPng),
        metaJson,
        images: imageEntries.map((e) => ({ name: e.name, data: Array.from(e.data) })),
        figKiwiVersion: version
      })
    )
  }

  return compressFigData(schemaDeflated, kiwiData, thumbnailPng, metaJson, imageEntries, version)
}

export { compressFigDataSync } from '@open-pencil/fig'

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && IS_BROWSER
}

function compressViaWorker(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPng: Uint8Array,
  metaJson: string,
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
      thumbnailPng,
      metaJson,
      images: imageEntries,
      figKiwiVersion
    })
  })
}

export function compressFigData(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPng: Uint8Array,
  metaJson: string,
  imageEntries: Array<{ name: string; data: Uint8Array }>,
  figKiwiVersion?: number
): Promise<Uint8Array> {
  if (canUseWorker()) {
    return compressViaWorker(
      schemaDeflated,
      kiwiData,
      thumbnailPng,
      metaJson,
      imageEntries,
      figKiwiVersion
    )
  }
  return Promise.resolve(
    compressFigDataSync(
      schemaDeflated,
      kiwiData,
      thumbnailPng,
      metaJson,
      imageEntries,
      figKiwiVersion
    )
  )
}
