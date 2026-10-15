import type { CanvasKit } from 'canvaskit-wasm'

import { compressFigDataSync } from '@open-pencil/fig'
import {
  adaptPaintBindingsToSchema,
  createFigNodeExportCaches,
  nameImagesForFigma,
  placeSlotContent,
  type FigNodeChangeExportRuntime,
  type FigNodeExportCaches
} from '@open-pencil/fig/node-change'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { orderKeyBetween, siblingOrderKeys } from '@open-pencil/scene-graph/order-keys'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from '#core/canvas'
import { withFigExportRuntime } from '#core/canvas/text/shape'
import { IS_BROWSER, IS_TAURI } from '#core/constants'
import {
  exportSchema,
  figExportRecordOptions,
  figFileExtras,
  prepareFigExport,
  type FigExportSetup,
  type KiwiNodeChange
} from '#core/io/formats/fig/export/setup'
import { projectLowcodeNodeForFigma } from '#core/io/formats/fig/lowcode-projection'
import { encodeNativeFigBuildPayload } from '#core/io/formats/fig/native-payload'
import { archiveImagesNamedForFigma, writePatchedFigFile } from '#core/io/formats/fig/patch/export'
import { prepareFigmaProjectionFonts } from '#core/io/formats/fig/projection-fonts'
import type { FigWriteOptions, IOContext } from '#core/io/types'
import {
  remapSerializedLowcodeMotionActionReferences,
  resolveSerializedGraphNodeReference
} from '#core/kiwi/fig/node-change/lowcode-node-references'
import {
  createCoreFigExportRuntime,
  buildFontDigestMap,
  sceneNodeToKiwi
} from '#core/kiwi/fig/node-change/serialize'
import { cloneSceneGraphForFigExport } from '#core/kiwi/fig/parse/transfer'
import { hasPendingReaderPages, populateReaderExport } from '#core/kiwi/fig/session/document-state'
import { originalFigArchive } from '#core/kiwi/fig/session/original-archive'

import { remapExportedFigmaNodeReferences } from './export/metadata'

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

import { appendVariableNodeChanges, assignSharedStyleGuids } from './variable-export'

type InternalResourceContext = FigExportSetup & {
  nodeChanges: KiwiNodeChange[]
  caches: FigNodeExportCaches
}

/**
 * Children already written under a canvas. Shared styles, variables and the canvas's own
 * layers all append to the internal canvas from separate passes, so each continues this
 * count rather than numbering from zero and handing siblings the same order key.
 */
function countCanvasChildren(changes: readonly NodeChange[], canvas: GUID): number {
  let count = 0
  for (const change of changes) {
    const parent = change.parentIndex?.guid
    if (parent?.sessionID === canvas.sessionID && parent.localID === canvas.localID) count++
  }
  return count
}

function appendInternalResources(context: InternalResourceContext): Map<string, string> {
  const { graph, internalCanvasGuid, nodeChanges } = context
  const orderKeys = new Map<string, string>()
  if (!internalCanvasGuid) return orderKeys
  const sharedStyleNodes = [...graph.nodes.values()].filter((node) => node.sharedStyleType !== null)
  const canvas = context.canvasEntries.find((entry) => entry.canvasGuid === internalCanvasGuid)
  const children = graph
    .getChildren(canvas?.page.id ?? '')
    .filter((child) => !child.internalOnly || child.sharedStyleType !== null)
  const childIds = new Set(children.map((node) => node.id))
  const siblings = [...children, ...sharedStyleNodes.filter((node) => !childIds.has(node.id))]
  const keys = siblingOrderKeys(
    siblings.map((node) =>
      node.parentId === canvas?.page.id && node.source.format === 'fig'
        ? node.source.orderKey
        : null
    )
  )
  siblings.forEach((node, index) => orderKeys.set(node.id, keys[index]))
  let last = keys.at(-1) ?? null
  const nextPosition = () => {
    last = orderKeyBetween(last, null)
    return last
  }
  assignSharedStyleGuids(
    sharedStyleNodes,
    context.localIdCounter,
    context.nodeIdToGuid,
    context.assignedGuidValues
  )
  for (let index = 0; index < sharedStyleNodes.length; index++) {
    nodeChanges.push(
      ...sceneNodeToKiwi(
        sharedStyleNodes[index],
        internalCanvasGuid,
        index,
        context.localIdCounter,
        graph,
        context.blobs,
        {
          nodeIdToGuid: context.nodeIdToGuid,
          fontDigestMap: context.fontDigestMap,
          varIdToGuid: context.varIdToGuid,
          glyphBlobMap: context.glyphBlobMap,
          blobIndexByHex: context.blobIndexByHex,
          assignedGuidValues: context.assignedGuidValues,
          componentPropertyDefinitionsById: context.componentPropertyDefinitionsById,
          modeIdToGuid: context.modeIdToGuid,
          propertyIdToGuid: context.propertyIdToGuid,
          pluginDataOverrides: context.pluginDataOverrides,
          runtime: context.runtime,
          caches: context.caches,
          orderKeys
        }
      )
    )
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
  return orderKeys
}

function appendSlotRecords(
  nodeChanges: KiwiNodeChange[],
  slots: KiwiNodeChange[],
  canvas: GUID | null
): void {
  if (!canvas) return
  let last: string | null = null
  for (const change of nodeChanges) {
    const parent = change.parentIndex
    if (parent?.guid.sessionID !== canvas.sessionID || parent.guid.localID !== canvas.localID)
      continue
    if (last === null || parent.position > last) last = parent.position
  }
  placeSlotContent(slots, canvas, 0, () => {
    last = orderKeyBetween(last, null)
    return last
  })
  nodeChanges.push(...slots)
}

export type ExportFigFileOptions = FigWriteOptions & IOContext

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
  const reuseArchive = profile === 'roundtrip' && (await archiveImagesNamedForFigma(sourceGraph))
  const originalArchive = reuseArchive ? await originalFigArchive(sourceGraph) : null
  if (originalArchive) return originalArchive.slice()
  let shapeGraph = sourceGraph
  if (profile === 'figma-compatible') {
    const projection = createCompatibleFigProjection(sourceGraph)
    await prepareFigmaProjectionFonts(projection.nodes)
    shapeGraph = cloneSceneGraphForFigExport(sourceGraph)
    for (const node of projection.nodes) shapeGraph.nodes.set(node.id, node)
  }
  return withFigExportRuntime(shapeGraph, ck, async (shapeRuntime) => {
    const runtime = { ...createCoreFigExportRuntime(), ...shapeRuntime }
    return (
      (reuseArchive
        ? await writePatchedFigFile(sourceGraph, runtime, {
            ck,
            renderer,
            pageId,
            renderHeadlessThumbnail
          })
        : null) ??
      writeFigFile(sourceGraph, runtime, ck, renderer, pageId, renderHeadlessThumbnail, profile)
    )
  })
}

async function writeFigFile(
  sourceGraph: SceneGraph,
  runtime: FigNodeChangeExportRuntime,
  ck: CanvasKit | undefined,
  renderer: SkiaRenderer | undefined,
  pageId: string | undefined,
  renderHeadlessThumbnail: boolean,
  profile: FigWriteOptions['profile']
): Promise<Uint8Array> {
  await initCodec()
  // The export reads the document itself and writes nothing to it. Only pages still in the
  // archive need a copy, which they load into instead of the document.
  let graph = sourceGraph
  if (hasPendingReaderPages(sourceGraph)) {
    graph = cloneSceneGraphForFigExport(sourceGraph)
    populateReaderExport(sourceGraph, graph)
  }
  const compatibleProjection =
    profile === 'figma-compatible' ? createCompatibleFigProjection(graph) : null
  if (compatibleProjection) await prepareFigmaProjectionFonts(compatibleProjection.nodes)
  const exportRuntime = compatibleProjection
    ? {
        ...runtime,
        ...compatibleProjection.runtime,
        shapeText: runtime.shapeText?.bind(runtime),
        textDecorations: runtime.textDecorations?.bind(runtime)
      }
    : runtime
  const setup = await prepareFigExport(graph, exportRuntime)
  if (compatibleProjection) {
    const additionalDigests = await buildFontDigestMap(graph, compatibleProjection.nodes)
    for (const [key, digest] of additionalDigests) setup.fontDigestMap.set(key, digest)
  }
  const caches = createFigNodeExportCaches(graph)
  const { compiled, schemaDeflated, schema } = exportSchema(graph)
  const { canvasEntries, internalCanvasGuid, localIdCounter, blobs } = setup
  const nodeChanges: KiwiNodeChange[] = [setup.documentNc]
  for (const entry of canvasEntries) nodeChanges.push(entry.canvasNc)

  const orderKeys = appendInternalResources({ ...setup, nodeChanges, caches })

  const orderedCanvasEntries = [
    ...canvasEntries.filter((entry) => entry.page.internalOnly),
    ...canvasEntries.filter((entry) => !entry.page.internalOnly)
  ]
  const slotContentRecords: KiwiNodeChange[] = []
  const recordOptions = {
    ...figExportRecordOptions(setup),
    orderKeys,
    slotContentRecords,
    caches
  }
  for (const { page, canvasGuid } of orderedCanvasEntries) {
    const children = graph
      .getChildren(page.id)
      .filter((child) => !child.internalOnly && child.sharedStyleType === null)
    const base = countCanvasChildren(nodeChanges, canvasGuid)
    for (let i = 0; i < children.length; i++) {
      nodeChanges.push(
        ...sceneNodeToKiwi(
          children[i],
          canvasGuid,
          base + i,
          localIdCounter,
          graph,
          blobs,
          recordOptions
        )
      )
    }
  }
  appendSlotRecords(nodeChanges, slotContentRecords, internalCanvasGuid)

  remapSerializedLowcodeMotionActionReferences(nodeChanges, (nodeId) =>
    resolveSerializedGraphNodeReference(graph, setup.nodeIdToGuid, nodeId)
  )
  const messageObjectAnimations = remapExportedFigmaNodeReferences(
    graph,
    nodeChanges,
    setup.nodeIdToGuid,
    setup.docGuid,
    schema
  )
  adaptPaintBindingsToSchema(nodeChanges, schema)

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
  const imageNames = nameImagesForFigma(nodeChanges, graph.images)
  const kiwiData = compiled.encodeMessage(msg)
  const extras = await figFileExtras(
    graph,
    imageNames,
    pageId,
    ck,
    renderer,
    renderHeadlessThumbnail
  )

  const version = graph.figKiwiVersion ?? undefined

  if (IS_TAURI) {
    const { invoke } = await import('@tauri-apps/api/core')
    const response = await invoke<ArrayBuffer | Uint8Array | number[]>(
      'build_fig_file',
      encodeNativeFigBuildPayload({
        schemaDeflated,
        kiwiData,
        thumbnailPng: extras.thumbnailPNG,
        metaJson: extras.metaJSON,
        images: extras.images,
        figKiwiVersion: version
      })
    )
    return nativeFigArchiveBytes(response)
  }

  return compressFigData(
    schemaDeflated,
    kiwiData,
    extras.thumbnailPNG,
    extras.metaJSON,
    extras.images,
    version
  )
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
    const worker = new Worker(new URL('./export/worker.ts', import.meta.url), {
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
