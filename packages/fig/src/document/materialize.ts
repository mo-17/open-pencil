import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import {
  generateId,
  remapStyleRunReferences,
  SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { FigArchiveLimits } from '../archive'
import {
  reconcileLiveComponentEdits,
  syncSourceLayers
} from '../instance-overrides/live-component-edits'
import {
  materializeInstance,
  type MaterializeInstanceOptions
} from '../instance-overrides/materialize-instance'
import type {
  InstanceOccurrence,
  InterpretInstanceOptions
} from '../instance-overrides/occurrence/types'
import {
  reconcileOccurrenceStructure,
  linkInstanceSourceChildren,
  mapInstanceSourceChildren,
  type MaterializedComponentOccurrence
} from '../instance-overrides/source-children'
import { nodeChangeToProps } from '../node-change'
import { figArchiveRecordInfo, type FigArchiveRecordInfo } from '../record-patch'
import { applyDocumentLayoutBindings } from './bindings/layout'
import { applyDocumentPaintBindings } from './bindings/paint'
import type { BindingReferenceDiagnostic } from './bindings/references'
import { applyDocumentTextBindings } from './bindings/text'
import {
  checkpointComponent,
  restoreComponentCheckpoint,
  type ComponentCheckpoint
} from './component/checkpoint'
import { linkComponentPropertyValues, resolveVariantPropertyValues } from './component/values'
import type { SourceDependencySelector } from './dependency-closure'
import { restoreImageAliases } from './image-aliases'
import { loadPageTransaction } from './load-transaction'
import { applyDocumentMetadata } from './metadata'
import { createArchiveDocumentReader, createDocumentReader } from './read'
import { materializeSourceRecords } from './source-records'
import { materializeVariableResources } from './variables'

export interface DocumentAssemblyOptions extends InterpretInstanceOptions {
  archiveLimits?: FigArchiveLimits
  /** Reachability for host-owned metadata, using the reader's complete source index. */
  sourceDependencies?: SourceDependencySelector
  onArchiveParsed?: () => void
  /** Assemble a fresh full document once; lazy sessions still start with page shells. */
  initiallyPopulateAll?: boolean
  /** Decoded-record compatibility: authored nodes exist before occurrences expand. */
  initiallyMaterializeSourceRecords?: boolean
  afterMaterialize?: (
    graph: SceneGraph,
    sources: ReadonlyMap<string, string>,
    records: readonly NodeChange[],
    /** First-hydrated authored records, including the initial root. Fig always supplies this;
     * optional so existing host adapters may still invoke the callback with three arguments. */
    newSourceNodeIds?: ReadonlySet<string>
  ) => void
  /** Limit only the detached host callback snapshot; the reader retains complete records. */
  afterMaterializeSourceFields?: readonly (keyof NodeChange)[]
  afterMaterializeInstance?: MaterializeInstanceOptions['afterMaterializeInstance']
  /** Host-owned metadata conversion applied to every shell and occurrence through this reader. */
  mapNodeProps?: (
    change: NodeChange,
    converted: ReturnType<typeof nodeChangeToProps>
  ) => ReturnType<typeof nodeChangeToProps>
  /** Restrict scene population to these source pages plus required component ownership. */
  pageIds?: ReadonlySet<string>
  images?: ReadonlyMap<string, Uint8Array>
  /** A resource record the materializer does not convert; acknowledged rather than dropped. */
  onUnsupportedResource?: (resource: NodeChange) => void
  onUnresolvedBinding?: (diagnostic: BindingReferenceDiagnostic) => void
}

/** Assemble every page of an archive into one graph. */
export function materializeDocument(
  changes: readonly NodeChange[],
  blobs: Uint8Array[] = [],
  options: DocumentAssemblyOptions = {}
) {
  return materializeReader(
    assemblyReader(
      createDocumentReader(changes, options.pageIds, options.sourceDependencies),
      options
    ),
    blobs,
    options
  )
}

/** Own parsed archive records; do not create a second full source tree. */
export function materializeFigArchive(bytes: ArrayBuffer, options: DocumentAssemblyOptions = {}) {
  const { reader, blobs, images, objectAnimations } = createArchiveDocumentReader(
    bytes,
    options.pageIds,
    {
      limits: options.archiveLimits
    },
    options.sourceDependencies
  )
  const result = materializeReader(assemblyReader(reader, options), blobs, {
    ...options,
    images: options.images ?? new Map(images)
  })
  result.graph.figMessageObjectAnimations = objectAnimations
  return result
}

/** Standalone whole-archive assembly selects internal pages explicitly, as sessions do. */
function assemblyReader(
  reader: ReturnType<typeof createDocumentReader>,
  options: DocumentAssemblyOptions
) {
  return options.initiallyPopulateAll && !options.pageIds
    ? reader.selectPages(new Set(reader.pages.map((page) => page.id)))
    : reader
}

export interface AssemblyState {
  graph: SceneGraph
  nextImportedId: number
  sources: Map<string, string>
  components: Map<string, MaterializedComponentOccurrence>
  componentIds: Map<string, string>
  savedSizeNodes: Set<string>
  unexpandedInstanceSourceIds: Set<string>
  /** Component property types by definition id, carried across page loads. */
  definitionTypes?: Map<string, string>
}

export interface FigSessionCheckpoint {
  /** Continuation of imported runtime handles, including handles consumed then deleted. */
  nextImportedId?: number
  sources: Array<[string, string]>
  componentIds: Array<[string, string]>
  savedSizeNodeIds: string[]
  unexpandedInstanceSourceIds?: string[]
  loadedPageIds: string[]
  components: Array<[string, ComponentCheckpoint]>
}

/**
 * The layer each archive record became, by record GUID: layers, pages, instances, and the
 * layers inside components down to the instances they nest, whose contents are no records.
 */
export function figCheckpointRecords(checkpoint: FigSessionCheckpoint): Map<string, string> {
  const records = new Map(checkpoint.sources)
  for (const [componentId, component] of checkpoint.components) {
    records.set(componentId, component.rootId)
    const instances: string[][] = []
    for (const entry of component.nodes) {
      const sourceId = entry.path.at(-1)
      if (!sourceId) continue
      const inInstance = instances.some(
        (prefix) =>
          prefix.length < entry.path.length && prefix.every((id, index) => entry.path[index] === id)
      )
      if (inInstance) continue
      records.set(sourceId, entry.nodeId)
      if (entry.mainComponentId !== null) instances.push(entry.path)
    }
  }
  return records
}

export interface FigSessionResume {
  graph: SceneGraph
  checkpoint: FigSessionCheckpoint
}

function restoreAssemblyState(
  resume: FigSessionResume,
  reader: ReturnType<typeof createDocumentReader>,
  options: DocumentAssemblyOptions
): AssemblyState {
  const { graph, checkpoint } = resume
  const components = new Map<string, MaterializedComponentOccurrence>()
  for (const [id, entry] of checkpoint.components) {
    components.set(id, restoreComponentCheckpoint(graph, reader.readComponent(id, options), entry))
  }
  return {
    graph,
    nextImportedId: checkpoint.nextImportedId ?? inferNextImportedId(graph),
    components,
    sources: new Map(checkpoint.sources),
    componentIds: new Map(checkpoint.componentIds),
    savedSizeNodes: new Set(checkpoint.savedSizeNodeIds),
    unexpandedInstanceSourceIds: new Set(checkpoint.unexpandedInstanceSourceIds)
  }
}

export function createFigDocumentSession(
  bytes: ArrayBuffer,
  options: DocumentAssemblyOptions = {},
  resume?: FigSessionResume
) {
  const archive = createArchiveDocumentReader(
    bytes,
    new Set(),
    { limits: options.archiveLimits },
    options.sourceDependencies
  )
  options.onArchiveParsed?.()
  const session = createReaderSession(
    archive.reader,
    archive.blobs,
    { ...options, images: options.images ?? new Map(archive.images) },
    resume,
    archive.records,
    archive.images.map(([hash]) => hash)
  )
  session.graph.figKiwiVersion = archive.figKiwiVersion
  session.graph.figSchemaDeflated = archive.figSchemaDeflated
  session.graph.figMessageObjectAnimations = archive.objectAnimations
  return session
}

/** Already decoded records use precisely the same document materializer as archive IO. */
export function createFigRecordSession(
  changes: readonly NodeChange[],
  blobs: Uint8Array[] = [],
  options: DocumentAssemblyOptions = {},
  resume?: FigSessionResume
) {
  return createReaderSession(
    createDocumentReader(changes, new Set(), options.sourceDependencies),
    blobs,
    options,
    resume
  )
}

function createReaderSession(
  reader: ReturnType<typeof createDocumentReader>,
  blobs: Uint8Array[],
  sessionOptions: DocumentAssemblyOptions,
  resume?: FigSessionResume,
  archiveRecords?: readonly NodeChange[],
  archivedImageHashes?: readonly string[]
) {
  const sourceImageHashes = archivedImageHashes ?? [...(sessionOptions.images?.keys() ?? [])]
  let recordInfo: FigArchiveRecordInfo | undefined
  const initialReader = sessionOptions.initiallyPopulateAll
    ? reader.selectPages(new Set(reader.pages.map((page) => page.id)))
    : reader
  let state
  if (resume) state = restoreAssemblyState(resume, reader, sessionOptions)
  else if (sessionOptions.initiallyMaterializeSourceRecords) {
    state = materializeSourceRecords(
      reader,
      blobs,
      sessionOptions,
      createAssemblyState(reader, sessionOptions, blobs)
    )
  } else state = materializeReader(initialReader, blobs, sessionOptions)
  const loaded = new Set<string>(
    resume?.checkpoint.loadedPageIds ??
      (sessionOptions.initiallyPopulateAll ? reader.pages.map((page) => page.id) : [])
  )
  return {
    checkpoint(): FigSessionCheckpoint {
      return structuredClone({
        nextImportedId: state.nextImportedId,
        sources: [...state.sources],
        componentIds: [...state.componentIds],
        savedSizeNodeIds: [...state.savedSizeNodes],
        unexpandedInstanceSourceIds: [...state.unexpandedInstanceSourceIds],
        loadedPageIds: [...loaded],
        components: [...state.components].map(([id, component]) => [
          id,
          checkpointComponent(component)
        ])
      } satisfies FigSessionCheckpoint)
    },
    graph: state.graph,
    graphPageId(sourcePageId: string): string | undefined {
      return reader.pages.some((page) => page.id === sourcePageId)
        ? state.sources.get(sourcePageId)
        : undefined
    },
    pages: reader.pages,
    archiveRecordInfo(): FigArchiveRecordInfo {
      recordInfo ??= figArchiveRecordInfo({
        records: archiveRecords ?? reader.sourceRecords,
        blobCount: blobs.length,
        imageHashes: sourceImageHashes
      })
      return recordInfo
    },
    loadPage(id: string): void {
      if (loaded.has(id)) return
      const selectedReader = reader.selectPages(new Set([id]))
      state.graph.withNodeMutationOrigin('source-hydration', () =>
        state.graph.applyImportedStateDuring(() =>
          loadPageTransaction(state, selectedReader.dependencyClosure, () => {
            materializeReader(selectedReader, blobs, sessionOptions, state)
            loaded.add(id)
          })
        )
      )
    },
    get loadedPageIds(): ReadonlySet<string> {
      return new Set(loaded)
    }
  }
}

/** Definition types already in the graph; only needed once, or after a resume. */
function seedDefinitionTypes(graph: SceneGraph): Map<string, string> {
  const types = new Map<string, string>()
  for (const node of graph.getAllNodes())
    for (const definition of node.componentPropertyDefinitions)
      types.set(definition.id, definition.type)
  return types
}

function createAssemblyState(
  reader: ReturnType<typeof createDocumentReader>,
  options: DocumentAssemblyOptions,
  blobs: Uint8Array[]
): AssemblyState {
  // Imported runtime handles remain reproducible for CLI inspection and patches. Authored
  // entities use the production allocator even when created in a previously imported graph.
  let initializing = true
  let nextImportedId = 1
  const graph: SceneGraph = new SceneGraph({
    maxNodes: options.archiveLimits?.maxGraphNodes,
    maxDepth: options.archiveLimits?.maxTreeDepth,
    idGenerator: () => (initializing ? `0:${nextImportedId++}` : generateId())
  })
  initializing = false
  applyDocumentMetadata(graph, reader.documentRecord, blobs)
  const document = reader.documentRecord
  const root = graph.getNode(graph.rootId)
  if (document && root && options.mapNodeProps) {
    const { nodeType: _type, ...props } = options.mapNodeProps(
      document,
      nodeChangeToProps(document, blobs)
    )
    Object.assign(root, props, {
      width: document.size?.x ?? 0,
      height: document.size?.y ?? 0,
      componentId: null
    })
  }
  for (const [hash, bytes] of options.images ?? []) graph.images.set(hash, bytes.slice())
  restoreImageAliases(graph, options.archiveLimits)
  graph.applyImportedStateDuring(
    () => materializeVariableResources(graph, reader.resources, options.onUnsupportedResource),
    () => `0:${nextImportedId++}`
  )
  for (const page of graph.getPages()) graph.deleteNode(page.id)
  return {
    graph,
    nextImportedId,
    sources: new Map(document?.guid ? [[guidToString(document.guid), graph.rootId]] : []),
    components: new Map(),
    componentIds: new Map(),
    savedSizeNodes: new Set(),
    unexpandedInstanceSourceIds: new Set()
  }
}

/** Compatibility with checkpoints saved before they carried the import counter. */
function inferNextImportedId(graph: SceneGraph): number {
  let next = 3
  const ids = [
    ...graph.nodes.keys(),
    ...graph.variables.keys(),
    ...graph.variableCollections.keys(),
    ...[...graph.variableCollections.values()].flatMap((collection) =>
      collection.modes.map((mode) => mode.modeId)
    )
  ]
  for (const id of ids) {
    if (!/^0:\d+$/.test(id)) continue
    next = Math.max(next, Number(id.slice(2)) + 1)
  }
  return next
}

/**
 * Syncing a resumed load's new instances copies their component's sizes over the sizes Figma
 * derived for them, such as a field filling its resized instance. Puts the derived sizes back,
 * except along an axis whose component layer was edited live, which syncing rightly carried over:
 * the layer an owning instance maps it to, or its own component.
 */
function restoreDerivedSizes(
  graph: SceneGraph,
  derivedSizes: ReadonlyMap<string, { width: number; height: number }>
): void {
  graph.preserveSourceMetadataDuring(() => {
    for (const [id, size] of derivedSizes) {
      const node = graph.getNode(id)
      if (!node) continue
      const edited = new Set(
        syncSourceLayers(graph, node).flatMap((layer) => layer.source.editedFields)
      )
      const updates: Partial<SceneNode> = {}
      if (node.width !== size.width && !edited.has('width')) updates.width = size.width
      if (node.height !== size.height && !edited.has('height')) updates.height = size.height
      if (Object.keys(updates).length > 0) graph.updateNode(id, updates)
    }
  })
}

function materializeReader(
  reader: ReturnType<typeof createDocumentReader>,
  blobs: Uint8Array[],
  options: DocumentAssemblyOptions,
  previous?: AssemblyState
) {
  const state = previous ?? createAssemblyState(reader, options, blobs)
  state.graph.withNodeMutationOrigin('source-hydration', () =>
    state.graph.applyImportedStateDuring(
      () => materializeReaderIntoState(reader, blobs, options, state, previous),
      () => `0:${state.nextImportedId++}`
    )
  )
  return state
}

function materializeReaderIntoState(
  reader: ReturnType<typeof createDocumentReader>,
  blobs: Uint8Array[],
  options: DocumentAssemblyOptions,
  state: AssemblyState,
  previous?: AssemblyState
) {
  for (const diagnostic of reader.bindingDiagnostics) {
    if (!options.onUnresolvedBinding)
      throw new Error(`Unresolved binding ${diagnostic.sourceId}: ${diagnostic.field}`)
    options.onUnresolvedBinding(diagnostic)
  }
  const pages = reader.pages.map((page) => reader.readPage(page.id, options))
  const plan = reader.planComponents(pages, options, (id) => state.components.has(id))
  const { graph, sources, components, savedSizeNodes, componentIds, unexpandedInstanceSourceIds } =
    state
  const resumed = previous !== undefined
  const existingNodeIds = new Set(graph.nodes.keys())
  const layoutScales = new Map<string, number>()
  /** The sizes Figma derived for this pass's instance layers, as materialized. */
  const derivedSizes = new Map<string, { width: number; height: number }>()
  const rememberDerivedSizes = (nodes: ReadonlyMap<InstanceOccurrence, SceneNode>): void => {
    for (const [occurrence, node] of nodes) {
      if (occurrence.derivedSize) {
        savedSizeNodes.add(node.id)
        derivedSizes.set(node.id, { width: node.width, height: node.height })
      }
      if (occurrence.layoutScale !== undefined) layoutScales.set(node.id, occurrence.layoutScale)
    }
  }
  const createShells = (occurrence: InstanceOccurrence, parentId: string): void => {
    const existingId = sources.get(occurrence.sourceId)
    if (existingId) {
      if (occurrence.mainComponentId === null)
        for (const child of occurrence.children) createShells(child, existingId)
      return
    }
    const source = reader.sourceRecord(occurrence.sourceId)
    if (!source) throw new Error(`Missing authored source ${occurrence.sourceId}`)
    const converted = nodeChangeToProps(source, blobs, 'source', reader.resolveStyleReference)
    const { nodeType, ...props } = options.mapNodeProps?.(source, converted) ?? converted
    if (nodeType === 'DOCUMENT' || nodeType === 'VARIABLE')
      throw new Error(`Unsupported scene type ${nodeType}`)
    if (nodeType === 'CANVAS')
      Object.assign(props, {
        width: occurrence.properties.size?.x ?? 0,
        height: occurrence.properties.size?.y ?? 0,
        componentId: null
      })
    const node = graph.createNode(nodeType, parentId, props)
    sources.set(occurrence.sourceId, node.id)
    if (node.type === 'COMPONENT') componentIds.set(occurrence.sourceId, node.id)
    if (node.type === 'INSTANCE') unexpandedInstanceSourceIds.add(occurrence.sourceId)
    // A placed instance is an authored record, including inside a component.
    // Its expansion is materialized later and must not acquire fabricated source ids.
    if (occurrence.mainComponentId === null)
      for (const child of occurrence.children) createShells(child, node.id)
  }
  for (const page of pages) createShells(page, graph.rootId)
  for (const item of plan) {
    if (components.has(item.sourceId)) continue
    const parentId = sources.get(item.parentSourceId)
    if (!parentId) throw new Error(`Unmaterialized component parent ${item.parentSourceId}`)
    const existingNodes = new Map<InstanceOccurrence, SceneNode>()
    const collectExisting = (node: InstanceOccurrence): void => {
      const id = sources.get(node.sourceId)
      const existing = id ? graph.getNode(id) : undefined
      if (existing) existingNodes.set(node, existing)
      if (node.mainComponentId === null) node.children.forEach(collectExisting)
    }
    collectExisting(item.occurrence)
    const materialized = materializeInstance(graph, parentId, item.occurrence, componentIds, {
      blobs,
      resolveStyleReference: reader.resolveStyleReference,
      mapNodeProps: options.mapNodeProps,
      afterMaterializeInstance: options.afterMaterializeInstance,
      sourceNodes: sources,
      retainRootSourceMetadata: true,
      sourceChildren: mapInstanceSourceChildren(item.occurrence, components),
      existingNodes
    })
    rememberDerivedSizes(materialized.nodes)
    linkInstanceSourceChildren(item.occurrence, materialized, components)
    components.set(item.sourceId, {
      occurrence: item.occurrence,
      materialized
    })
    componentIds.set(item.sourceId, materialized.root.id)
    sources.set(item.sourceId, materialized.root.id)
    for (const occurrence of materialized.nodes.keys())
      unexpandedInstanceSourceIds.delete(occurrence.sourceId)
  }
  /**
   * Instances a resumed load must sync with their components, which may have changed live since
   * the file loaded. Only this page's new instances: syncing a whole component would copy its
   * sizes over the sizes Figma derived for instances earlier pages already placed.
   */
  const resync = new Set<string>()
  const populateInstances = (occurrence: InstanceOccurrence): void => {
    if (occurrence.properties.type === 'SYMBOL') return
    const parentId = sources.get(occurrence.sourceId)
    if (!parentId) throw new Error(`Missing source container ${occurrence.sourceId}`)
    const ordered: string[] = []
    for (const child of occurrence.children) {
      if (previous && components.size) reconcileOccurrenceStructure(child, graph, components)
      if (
        child.mainComponentId !== null &&
        (!sources.has(child.sourceId) || unexpandedInstanceSourceIds.has(child.sourceId))
      ) {
        const existingId = sources.get(child.sourceId)
        const existing = existingId ? graph.getNode(existingId) : undefined
        if (existingId && !existing) throw new Error(`Missing retained instance ${child.sourceId}`)
        const materialized = materializeInstance(graph, parentId, child, componentIds, {
          blobs,
          resolveStyleReference: reader.resolveStyleReference,
          mapNodeProps: options.mapNodeProps,
          afterMaterializeInstance: options.afterMaterializeInstance,
          sourceNodes: sources,
          retainRootSourceMetadata: true,
          sourceChildren: mapInstanceSourceChildren(child, components),
          existingNodes: existing ? new Map([[child, existing]]) : undefined
        })
        rememberDerivedSizes(materialized.nodes)
        linkInstanceSourceChildren(child, materialized, components)
        if (resumed) {
          reconcileLiveComponentEdits(graph, materialized)
          if (materialized.root.componentId) resync.add(materialized.root.id)
        }
        sources.set(child.sourceId, materialized.root.id)
        unexpandedInstanceSourceIds.delete(child.sourceId)
      } else if (child.mainComponentId === null && child.properties.type !== 'SYMBOL')
        populateInstances(child)
      const id = sources.get(child.sourceId)
      if (!id) throw new Error(`Missing assembled child ${child.sourceId}`)
      // Host metadata can fold source-only projection layers out of the live graph.
      // Keep their source identity without restoring deleted child links on a later page load.
      if (graph.getNode(id)) ordered.push(id)
    }
    const parent = graph.getNode(parentId)
    if (parent)
      parent.childIds = [...ordered, ...parent.childIds.filter((id) => !ordered.includes(id))]
  }
  for (const page of pages) populateInstances(page)
  for (const instanceId of resync) graph.syncInstance(instanceId)
  if (resync.size > 0) restoreDerivedSizes(graph, derivedSizes)
  // Layers and ranges name their styles by the styles' own IDs, which the records' GUIDs are,
  // so only links to other layers are renamed to the layers this page added.
  for (const node of graph.getAllNodes()) {
    if (existingNodeIds.has(node.id) || node.styleRuns.length === 0) continue
    node.styleRuns = remapStyleRunReferences(node.styleRuns, {
      variable: (id) => id,
      style: (id) => id,
      node: (id) => sources.get(id) ?? id
    })
  }
  // These passes apply to the nodes this page added, not to the whole graph.
  const materialized = [...graph.nodes.values()].filter((node) => !existingNodeIds.has(node.id))
  state.definitionTypes ??= seedDefinitionTypes(graph)
  linkComponentPropertyValues(graph, sources, materialized, state.definitionTypes)
  graph.preserveSourceMetadataDuring(() => {
    resolveVariantPropertyValues(graph, materialized)
    applyDocumentLayoutBindings(graph, savedSizeNodes, materialized, layoutScales)
    applyDocumentPaintBindings(graph, materialized)
    applyDocumentTextBindings(graph, materialized)
    options.afterMaterialize?.(
      graph,
      sources,
      options.afterMaterializeSourceFields
        ? reader.sourceRecordsFor(options.afterMaterializeSourceFields)
        : reader.sourceRecords,
      new Set([...sources.values()].filter((id) => !previous || !existingNodeIds.has(id)))
    )
  })
  return state
}
