import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { FigArchiveLimits } from '../archive'
import { reconcileLiveComponentEdits } from '../instance-overrides/live-component-edits'
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
import { loadPageTransaction } from './load-transaction'
import { applyDocumentMetadata } from './metadata'
import { createArchiveDocumentReader, createDocumentReader } from './read'
import { materializeSourceRecords } from './source-records'
import { materializeVariableResources } from './variables'

export interface DocumentAssemblyOptions extends InterpretInstanceOptions {
  archiveLimits?: FigArchiveLimits
  onArchiveParsed?: () => void
  /** Assemble a fresh full document once; lazy sessions still start with page shells. */
  initiallyPopulateAll?: boolean
  /** Decoded-record compatibility: authored nodes exist before occurrences expand. */
  initiallyMaterializeSourceRecords?: boolean
  afterMaterialize?: (
    graph: SceneGraph,
    sources: ReadonlyMap<string, string>,
    records: readonly NodeChange[]
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
    assemblyReader(createDocumentReader(changes, options.pageIds), options),
    blobs,
    options
  )
}

/** Own parsed archive records; do not create a second full source tree. */
export function materializeFigArchive(bytes: ArrayBuffer, options: DocumentAssemblyOptions = {}) {
  const { reader, blobs, images, objectAnimations } = createArchiveDocumentReader(
    bytes,
    options.pageIds,
    { limits: options.archiveLimits }
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
  sources: Map<string, string>
  components: Map<string, MaterializedComponentOccurrence>
  componentIds: Map<string, string>
  savedSizeNodes: Set<string>
  unexpandedInstanceSourceIds: Set<string>
  /** Component property types by definition id, carried across page loads. */
  definitionTypes?: Map<string, string>
}

export interface FigSessionCheckpoint {
  sources: Array<[string, string]>
  componentIds: Array<[string, string]>
  savedSizeNodeIds: string[]
  unexpandedInstanceSourceIds?: string[]
  loadedPageIds: string[]
  components: Array<[string, ComponentCheckpoint]>
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
  const archive = createArchiveDocumentReader(bytes, new Set(), { limits: options.archiveLimits })
  options.onArchiveParsed?.()
  const session = createReaderSession(
    archive.reader,
    archive.blobs,
    { ...options, images: options.images ?? new Map(archive.images) },
    resume
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
  return createReaderSession(createDocumentReader(changes, new Set()), blobs, options, resume)
}

function createReaderSession(
  reader: ReturnType<typeof createDocumentReader>,
  blobs: Uint8Array[],
  sessionOptions: DocumentAssemblyOptions,
  resume?: FigSessionResume
) {
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
      createAssemblyState(reader, sessionOptions)
    )
  } else state = materializeReader(initialReader, blobs, sessionOptions)
  const loaded = new Set<string>(
    resume?.checkpoint.loadedPageIds ??
      (sessionOptions.initiallyPopulateAll ? reader.pages.map((page) => page.id) : [])
  )
  return {
    checkpoint(): FigSessionCheckpoint {
      return structuredClone({
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
  options: DocumentAssemblyOptions
): AssemblyState {
  const graph = new SceneGraph({
    maxNodes: options.archiveLimits?.maxGraphNodes,
    maxDepth: options.archiveLimits?.maxTreeDepth
  })
  applyDocumentMetadata(graph, reader.documentRecord)
  const document = reader.documentRecord
  const root = graph.getNode(graph.rootId)
  if (document && root && options.mapNodeProps) {
    const { nodeType: _type, ...props } = options.mapNodeProps(
      document,
      nodeChangeToProps(document, [])
    )
    Object.assign(root, props, {
      width: document.size?.x ?? 0,
      height: document.size?.y ?? 0,
      componentId: null
    })
  }
  for (const [hash, bytes] of options.images ?? []) graph.images.set(hash, bytes.slice())
  materializeVariableResources(graph, reader.resources, options.onUnsupportedResource)
  for (const page of graph.getPages()) graph.deleteNode(page.id)
  return {
    graph,
    sources: new Map(document?.guid ? [[guidToString(document.guid), graph.rootId]] : []),
    components: new Map(),
    componentIds: new Map(),
    savedSizeNodes: new Set(),
    unexpandedInstanceSourceIds: new Set()
  }
}

function materializeReader(
  reader: ReturnType<typeof createDocumentReader>,
  blobs: Uint8Array[],
  options: DocumentAssemblyOptions,
  previous?: AssemblyState
) {
  const state = previous ?? createAssemblyState(reader, options)
  state.graph.withNodeMutationOrigin('source-hydration', () =>
    state.graph.applyImportedStateDuring(() =>
      materializeReaderIntoState(reader, blobs, options, state, previous)
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
  const plan = reader.planComponents(pages, options)
  const { graph, sources, components, savedSizeNodes, componentIds, unexpandedInstanceSourceIds } =
    state
  const existingNodeIds = new Set(graph.nodes.keys())
  const layoutScales = new Map<string, number>()
  const rememberDerivedSizes = (nodes: ReadonlyMap<InstanceOccurrence, SceneNode>): void => {
    for (const [occurrence, node] of nodes) {
      if (occurrence.derivedSize) savedSizeNodes.add(node.id)
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
      retainRootSourceMetadata: true,
      sourceChildren: mapInstanceSourceChildren(item.occurrence, components),
      existingNodes
    })
    rememberDerivedSizes(materialized.nodes)
    linkInstanceSourceChildren(item.occurrence, materialized, components)
    components.set(item.sourceId, { occurrence: item.occurrence, materialized })
    componentIds.set(item.sourceId, materialized.root.id)
    sources.set(item.sourceId, materialized.root.id)
    for (const occurrence of materialized.nodes.keys())
      unexpandedInstanceSourceIds.delete(occurrence.sourceId)
  }
  /**
   * Components whose instances a resumed load must re-sync. Syncing visits every instance
   * of a component, so a page placing many instances of one component collects it once
   * and syncs after the page is built rather than per instance.
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
          retainRootSourceMetadata: true,
          sourceChildren: mapInstanceSourceChildren(child, components),
          existingNodes: existing ? new Map([[child, existing]]) : undefined
        })
        rememberDerivedSizes(materialized.nodes)
        linkInstanceSourceChildren(child, materialized, components)
        if (previous) {
          reconcileLiveComponentEdits(graph, materialized)
          if (materialized.root.componentId) resync.add(materialized.root.componentId)
        }
        sources.set(child.sourceId, materialized.root.id)
        unexpandedInstanceSourceIds.delete(child.sourceId)
      } else if (child.mainComponentId === null && child.properties.type !== 'SYMBOL')
        populateInstances(child)
      const id = sources.get(child.sourceId)
      if (!id) throw new Error(`Missing assembled child ${child.sourceId}`)
      ordered.push(id)
    }
    const parent = graph.getNode(parentId)
    if (parent)
      parent.childIds = [...ordered, ...parent.childIds.filter((id) => !ordered.includes(id))]
  }
  for (const page of pages) populateInstances(page)
  const pendingInstanceIds = new Set(
    [...unexpandedInstanceSourceIds].flatMap((id) => sources.get(id) ?? [])
  )
  for (const componentId of resync)
    graph.syncInstances(
      componentId,
      new Set(
        graph
          .getInstances(componentId)
          .filter((node) => !pendingInstanceIds.has(node.id))
          .map((node) => node.id)
      )
    )
  for (const node of graph.getAllNodes()) {
    if (existingNodeIds.has(node.id)) continue
    for (const field of [
      'fillStyleId',
      'strokeStyleId',
      'textStyleId',
      'effectStyleId',
      'gridStyleId'
    ] as const) {
      const id = node[field]
      if (id && sources.has(id)) node[field] = sources.get(id) ?? id
    }
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
        : reader.sourceRecords
    )
  })
  return state
}
