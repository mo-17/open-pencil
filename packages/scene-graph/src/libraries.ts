/* eslint-disable max-lines -- Library publication, validation, and graph cloning share one public protocol. */
import { cloneNodeProps } from './copy'
import { inspectImageBytes } from './image-inspection'
import type { SceneGraph } from './index'
import {
  motionDriverNodeReferences,
  prototypeNodeReferences,
  validateMotionDriverSpec,
  validateMotionSceneSpec,
  validatePrototypeSpec
} from './motion'
import type { Fill, LibraryRef, LibrarySource, NodeType, SceneNode, SourceMetadata } from './types'

const VERSION_HASH_EXCLUDED_KEYS = new Set<keyof SceneNode | 'childIds'>([
  'id',
  'parentId',
  'childIds',
  'source',
  'pluginData',
  'pluginRelaunchData',
  'componentKey',
  'libraryComponentKey',
  'libraryId',
  'libraryVersion',
  'libraryReadonly',
  'sourceLibraryKey',
  'publishId',
  'overrideKey',
  'sharedSymbolVersion',
  'publishedVersion',
  'isPublishable',
  'isSymbolPublishable'
])

function randomHex(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('')
}

export interface LibraryComponentManifestEntry {
  key: string
  name: string
  version: string
  nodeId: string
  type: Extract<NodeType, 'COMPONENT' | 'COMPONENT_SET'>
}

export interface LibraryManifest {
  libraryId: string
  name: string
  source?: LibraryRef['source']
  components: LibraryComponentManifestEntry[]
}

export interface PublishLibraryComponentOptions {
  componentId: string
  libraryId: string
  libraryName?: string
  source?: LibraryRef['source']
  componentKey?: string
  readonly?: boolean
}

export interface PublishLibraryComponentResult {
  component: LibraryComponentManifestEntry
  manifest: LibraryManifest
}

export interface ImportLibraryComponentOptions {
  sourceGraph: SceneGraph
  targetGraph: SceneGraph
  manifest: LibraryManifest
  componentKey: string
  parentId?: string
  source?: LibraryRef['source']
  manifestSource?: LibrarySource
}

export interface ImportLibraryComponentResult {
  component: LibraryComponentManifestEntry
  importedNodeId: string
  libraryRef: LibraryRef
}

export type LibraryUpdateStatus =
  | 'up-to-date'
  | 'outdated'
  | 'missing-manifest'
  | 'missing-cached-master'

export interface LibraryUpdateCheck {
  libraryId: string
  componentKey: string
  status: LibraryUpdateStatus
  cachedNodeId?: string
  currentVersion?: string
  latestVersion?: string
}

export interface CheckLibraryUpdatesOptions {
  targetGraph: SceneGraph
  manifest: LibraryManifest
}

export interface AcceptLibraryUpdateOptions {
  sourceGraph: SceneGraph
  targetGraph: SceneGraph
  manifest: LibraryManifest
  componentKey: string
  manifestSource?: LibrarySource
}

export interface AcceptLibraryUpdateResult {
  component: LibraryComponentManifestEntry
  cachedNodeId: string
  previousVersion?: string
  libraryRef: LibraryRef
  warnings: string[]
}

export type LibraryArtifactValidationIssueCode =
  | 'duplicate-component-key'
  | 'duplicate-component-node'
  | 'ambiguous-component'
  | 'missing-component'
  | 'type-mismatch'
  | 'version-mismatch'
  | 'missing-image'
  | 'invalid-image'
  | 'oversized-image'
  | 'overlapping-component-subtree'
  | 'validation-work-limit'
  | 'bound-variables'
  | 'external-component-reference'
  | 'external-node-reference'
  | 'active-lowcode-behavior'
  | 'unsafe-library-metadata'
  | 'internal-library-node'
  | 'invalid-node-reference'

export interface LibraryArtifactValidationIssue {
  code: LibraryArtifactValidationIssueCode
  message: string
  componentKey?: string
  nodeId?: string
  imageHash?: string
}

export type LibraryArtifactValidationResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: LibraryArtifactValidationIssue[] }

export const LIBRARY_CACHE_PAGE_NAME = 'OpenPencil Library Cache'

export const REMOTE_LIBRARY_IMAGE_LIMITS = Object.freeze({
  maxSide: 32_768,
  maxPixels: 50_000_000
})

export const REMOTE_LIBRARY_VALIDATION_LIMITS = Object.freeze({
  maxSubtreeNodeVisits: 200_000,
  maxCanonicalCodeUnits: 16 * 1024 * 1024,
  maxCanonicalBinaryBytes: 4 * 1024 * 1024,
  maxCanonicalValueVisits: 1_000_000,
  maxCanonicalValueDepth: 64
})

const REMOTE_LIBRARY_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

interface LibraryValidationBudget {
  subtreeNodeVisits: number
  canonicalCodeUnits: number
  canonicalBinaryBytes: number
  canonicalValueVisits: number
}

interface CachedLibraryImageValidationIssue {
  code: Extract<LibraryArtifactValidationIssueCode, 'invalid-image' | 'oversized-image'>
  message: string
}

/** Return the single hidden page used to retain imported component masters. */
export function ensureLibraryCachePage(graph: SceneGraph): SceneNode {
  const existing = graph
    .getPages(true)
    .find((page) => page.type === 'CANVAS' && page.lowcodeLibraryCache === true)
  if (existing) {
    if (!existing.internalOnly) graph.updateNode(existing.id, { internalOnly: true })
    return existing
  }

  const page = graph.addPage(LIBRARY_CACHE_PAGE_NAME)
  graph.updateNode(page.id, { internalOnly: true, lowcodeLibraryCache: true })
  return page
}

/**
 * Validate a decoded library document before any of its nodes or images are
 * copied into another graph. The checks deliberately fail closed because the
 * manifest and artifact may have arrived from different remote requests.
 */
export function validateLibraryArtifact(
  graph: SceneGraph,
  manifest: LibraryManifest
): LibraryArtifactValidationResult {
  const issues: LibraryArtifactValidationIssue[] = []
  const seenKeys = new Set<string>()
  const componentKeysByNodeId = new Map<string, string>()
  const claimedSubtreeNodeIds = new Map<string, string>()
  const embeddedComponentIndex = indexEmbeddedLibraryComponents(graph)
  const imageValidationCache = new Map<string, CachedLibraryImageValidationIssue | null>()
  const budget: LibraryValidationBudget = {
    subtreeNodeVisits: 0,
    canonicalCodeUnits: 0,
    canonicalBinaryBytes: 0,
    canonicalValueVisits: 0
  }

  for (const entry of manifest.components) {
    if (seenKeys.has(entry.key)) {
      issues.push({
        code: 'duplicate-component-key',
        componentKey: entry.key,
        nodeId: entry.nodeId,
        message: `Component key "${entry.key}" appears more than once in the library manifest`
      })
    } else {
      seenKeys.add(entry.key)
    }

    const resolved = resolveManifestComponent(graph, entry, embeddedComponentIndex)
    const root = resolved.node
    if (!root) {
      issues.push({
        code: resolved.ambiguous ? 'ambiguous-component' : 'missing-component',
        componentKey: entry.key,
        nodeId: entry.nodeId,
        message: resolved.ambiguous
          ? `Component "${entry.key}" resolves to multiple keyed nodes in the library artifact`
          : `Component "${entry.key}" cannot be resolved in the library artifact`
      })
      continue
    }

    const previousComponentKey = componentKeysByNodeId.get(root.id)
    if (previousComponentKey) {
      issues.push({
        code: 'duplicate-component-node',
        componentKey: entry.key,
        nodeId: root.id,
        message: `Component "${entry.key}" resolves to source node "${root.id}", which is already declared by component "${previousComponentKey}"`
      })
      continue
    }
    componentKeysByNodeId.set(root.id, entry.key)

    const subtree = collectManifestComponentSubtreeNodes(
      graph,
      root.id,
      entry.key,
      claimedSubtreeNodeIds,
      budget
    )
    if (!subtree.ok) {
      if (subtree.reason === 'overlap') {
        issues.push({
          code: 'overlapping-component-subtree',
          componentKey: entry.key,
          nodeId: subtree.nodeId,
          message: `Component "${entry.key}" overlaps component "${subtree.ownerComponentKey}" at source node "${subtree.nodeId}"`
        })
        continue
      }
      issues.push({
        code: 'validation-work-limit',
        componentKey: entry.key,
        nodeId: root.id,
        message: `Library validation exceeds the aggregate limit of ${REMOTE_LIBRARY_VALIDATION_LIMITS.maxSubtreeNodeVisits} component-subtree node visits`
      })
      break
    }

    const canonicalWorkFailure = consumeLibraryCanonicalWork(subtree.nodes, budget)
    if (canonicalWorkFailure) {
      issues.push({
        code: 'validation-work-limit',
        componentKey: entry.key,
        nodeId: root.id,
        message: `Component "${entry.key}" exceeds the bounded canonical version work policy: ${canonicalWorkFailure}`
      })
      break
    }

    if (root.type !== entry.type) {
      issues.push({
        code: 'type-mismatch',
        componentKey: entry.key,
        nodeId: root.id,
        message: `Component "${entry.key}" has type ${root.type}; manifest requires ${entry.type}`
      })
    }

    const actualVersion = componentSubtreeVersion(graph, root.id)
    if (actualVersion !== entry.version) {
      issues.push({
        code: 'version-mismatch',
        componentKey: entry.key,
        nodeId: root.id,
        message: `Component "${entry.key}" has version ${actualVersion}; manifest requires ${entry.version}`
      })
    }

    validateLibrarySubtree(graph, entry.key, root, subtree.nodes, issues, imageValidationCache)
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues }
}

export function publishLibraryComponent(
  graph: SceneGraph,
  options: PublishLibraryComponentOptions
): PublishLibraryComponentResult | { error: string } {
  const component = graph.getNode(options.componentId)
  if (!component) return { error: `Node "${options.componentId}" not found` }
  if (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET') {
    return { error: `Node "${options.componentId}" is not a COMPONENT or COMPONENT_SET` }
  }
  if (options.libraryId.trim() === '') return { error: 'libraryId must be a non-empty string' }
  if (options.componentKey?.trim() === '') {
    return { error: 'componentKey must be a non-empty string when provided' }
  }

  const key =
    options.componentKey ?? component.libraryComponentKey ?? component.componentKey ?? randomHex(20)
  const version = componentSubtreeVersion(graph, component.id)
  const manifestEntry: LibraryComponentManifestEntry = {
    key,
    name: component.name,
    version,
    nodeId: component.id,
    type: component.type
  }

  graph.updateNode(component.id, {
    componentKey: key,
    libraryComponentKey: key,
    libraryId: options.libraryId,
    libraryVersion: version,
    libraryReadonly: options.readonly ?? true
  })

  return {
    component: manifestEntry,
    manifest: {
      libraryId: options.libraryId,
      name: options.libraryName ?? options.libraryId,
      ...(options.source ? { source: options.source } : {}),
      components: [manifestEntry]
    }
  }
}

export function importLibraryComponent(
  options: ImportLibraryComponentOptions
): ImportLibraryComponentResult | { error: string } {
  const resolvedEntry = resolveLibraryOperationEntry(options)
  if ('error' in resolvedEntry) return resolvedEntry
  const manifestEntry = resolvedEntry
  const source = options.source ?? options.manifest.source
  if (!source) return { error: 'library source is required to register imported components' }
  const parentId = options.parentId ?? options.targetGraph.getPages()[0]?.id
  if (!parentId || !options.targetGraph.getNode(parentId)) {
    return { error: `Target parent "${parentId}" not found` }
  }

  const sourceRoot = resolveManifestComponent(options.sourceGraph, manifestEntry).node
  if (!sourceRoot) {
    return { error: `Source component "${manifestEntry.key}" not found in source graph` }
  }
  if (sourceRoot.type !== 'COMPONENT' && sourceRoot.type !== 'COMPONENT_SET') {
    return { error: `Source node "${sourceRoot.id}" is not a COMPONENT or COMPONENT_SET` }
  }
  const imageConflict = findImageAssetConflict(
    options.sourceGraph,
    options.targetGraph,
    sourceRoot.id
  )
  if (imageConflict) return { error: imageConflict }

  const clone = cloneSubtreeIntoGraph(
    options.sourceGraph,
    options.targetGraph,
    sourceRoot.id,
    parentId
  )
  if (!clone) return { error: `Failed to clone source component "${manifestEntry.key}"` }
  copyReferencedImages(options.sourceGraph, options.targetGraph, sourceRoot.id)
  applyLibraryComponentMetadata(options.targetGraph, clone.id, options.manifest, manifestEntry)

  const libraryRef = upsertImportedLibraryRef(
    options.targetGraph,
    options.manifest,
    source,
    manifestEntry,
    options.manifestSource
  )

  return { component: manifestEntry, importedNodeId: clone.id, libraryRef }
}

export function checkLibraryUpdates(options: CheckLibraryUpdatesOptions): LibraryUpdateCheck[] {
  const root = options.targetGraph.getNode(options.targetGraph.rootId)
  const libraryRef = root?.lowcodeLibraries?.find(
    (library) => library.libraryId === options.manifest.libraryId
  )
  if (!libraryRef) return []

  return libraryRef.importedComponents.map((imported) => {
    const manifestEntry = options.manifest.components.find(
      (component) => component.key === imported.key
    )
    if (!manifestEntry) {
      return {
        libraryId: options.manifest.libraryId,
        componentKey: imported.key,
        status: 'missing-manifest',
        currentVersion: imported.version
      }
    }

    const cachedMasterResult = findCachedLibraryMaster(
      options.targetGraph,
      options.manifest.libraryId,
      imported.key
    )
    const cachedMaster = cachedMasterResult.node
    if (!cachedMaster) {
      return {
        libraryId: options.manifest.libraryId,
        componentKey: imported.key,
        status: 'missing-cached-master',
        currentVersion: imported.version,
        latestVersion: manifestEntry.version
      }
    }

    const currentVersion = cachedMaster.libraryVersion ?? imported.version
    return {
      libraryId: options.manifest.libraryId,
      componentKey: imported.key,
      status: currentVersion === manifestEntry.version ? 'up-to-date' : 'outdated',
      cachedNodeId: cachedMaster.id,
      currentVersion,
      latestVersion: manifestEntry.version
    }
  })
}

export function acceptLibraryUpdate(
  options: AcceptLibraryUpdateOptions
): AcceptLibraryUpdateResult | { error: string } {
  const resolvedEntry = resolveLibraryOperationEntry(options)
  if ('error' in resolvedEntry) return resolvedEntry
  const manifestEntry = resolvedEntry

  const cachedMasterResult = findCachedLibraryMaster(
    options.targetGraph,
    options.manifest.libraryId,
    manifestEntry.key
  )
  if (cachedMasterResult.error) return { error: cachedMasterResult.error }
  const cachedMaster = cachedMasterResult.node
  if (!cachedMaster) {
    return { error: `Cached component "${manifestEntry.key}" not found in target graph` }
  }
  if (cachedMaster.type !== manifestEntry.type) {
    return {
      error: `Cached component "${manifestEntry.key}" type changed from ${cachedMaster.type} to ${manifestEntry.type}`
    }
  }

  const sourceRoot = resolveManifestComponent(options.sourceGraph, manifestEntry).node
  if (!sourceRoot) {
    return { error: `Source component "${manifestEntry.key}" not found in source graph` }
  }
  if (sourceRoot.type !== cachedMaster.type) {
    return {
      error: `Source component "${manifestEntry.key}" type changed from ${cachedMaster.type} to ${sourceRoot.type}`
    }
  }
  const source =
    options.manifest.source ?? findLibraryRefSource(options.targetGraph, options.manifest.libraryId)
  if (!source) return { error: 'library source is required to update imported components' }
  const imageConflict = findImageAssetConflict(
    options.sourceGraph,
    options.targetGraph,
    sourceRoot.id
  )
  if (imageConflict) return { error: imageConflict }

  const previousVersion = cachedMaster.libraryVersion
  const warnings =
    componentStructureSignature(options.targetGraph, cachedMaster.id) ===
    componentStructureSignature(options.sourceGraph, sourceRoot.id)
      ? []
      : ['Component structure changed; existing instance overrides were not remapped']

  replaceCachedMasterSubtree(options.sourceGraph, options.targetGraph, sourceRoot.id, cachedMaster)
  copyReferencedImages(options.sourceGraph, options.targetGraph, sourceRoot.id)
  applyLibraryComponentMetadata(
    options.targetGraph,
    cachedMaster.id,
    options.manifest,
    manifestEntry
  )
  const libraryRef = upsertImportedLibraryRef(
    options.targetGraph,
    options.manifest,
    source,
    manifestEntry,
    options.manifestSource
  )
  options.targetGraph.syncInstances(cachedMaster.id)

  return {
    component: manifestEntry,
    cachedNodeId: cachedMaster.id,
    previousVersion,
    libraryRef,
    warnings
  }
}

export function componentSubtreeVersion(graph: SceneGraph, componentId: string): string {
  const node = graph.getNode(componentId)
  if (!node) return 'v0-missing'
  return `v1-${hashString(stableStringify(normalizeNode(graph, node)))}`
}

function findManifestEntry(
  manifest: LibraryManifest,
  componentKey: string
): LibraryComponentManifestEntry | undefined {
  return manifest.components.find((component) => component.key === componentKey)
}

function missingManifestEntryError(componentKey: string): { error: string } {
  return { error: `Component key "${componentKey}" not found in library manifest` }
}

function applyLibraryComponentMetadata(
  graph: SceneGraph,
  nodeId: string,
  manifest: LibraryManifest,
  entry: LibraryComponentManifestEntry
): void {
  graph.updateNode(nodeId, {
    componentKey: entry.key,
    libraryComponentKey: entry.key,
    libraryId: manifest.libraryId,
    libraryVersion: entry.version,
    libraryReadonly: true
  })
}

function indexEmbeddedLibraryComponents(graph: SceneGraph): Map<string, SceneNode[]> {
  const index = new Map<string, SceneNode[]>()
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') continue
    const keys = new Set([node.libraryComponentKey, node.componentKey])
    for (const key of keys) {
      if (!key) continue
      const candidates = index.get(key) ?? []
      candidates.push(node)
      index.set(key, candidates)
    }
  }
  return index
}

function resolveManifestComponent(
  graph: SceneGraph,
  entry: LibraryComponentManifestEntry,
  embeddedComponentIndex?: ReadonlyMap<string, readonly SceneNode[]>
): { node?: SceneNode; ambiguous?: true } {
  const byId = graph.getNode(entry.nodeId)
  if (byId && (byId.type === 'COMPONENT' || byId.type === 'COMPONENT_SET')) {
    const embeddedKey = byId.libraryComponentKey ?? byId.componentKey
    // `.pen` preserves stable authored node ids but does not carry OpenPencil
    // publish metadata. Accept an exact id when no embedded key exists; if an
    // artifact does carry a key, it must agree with the manifest.
    if (!embeddedKey || embeddedKey === entry.key) return { node: byId }
  }
  const keyedCandidates = embeddedComponentIndex
    ? (embeddedComponentIndex.get(entry.key) ?? [])
    : [...graph.getAllNodes()].filter(
        (node) =>
          (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
          (node.libraryComponentKey === entry.key || node.componentKey === entry.key)
      )
  if (keyedCandidates.length === 1) return { node: keyedCandidates[0] }
  return keyedCandidates.length > 1 ? { ambiguous: true } : {}
}

function findCachedLibraryMaster(
  graph: SceneGraph,
  libraryId: string,
  componentKey: string
): { node?: SceneNode; error?: string } {
  const candidates = [...graph.getAllNodes()].filter(
    (node) =>
      (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
      node.libraryId === libraryId &&
      (node.libraryComponentKey === componentKey || node.componentKey === componentKey)
  )
  const cachePageIds = new Set(
    graph
      .getPages(true)
      .filter((page) => page.lowcodeLibraryCache === true && page.internalOnly)
      .map((page) => page.id)
  )
  const isUnderCachePage = (node: SceneNode): boolean => {
    let current: SceneNode | undefined = node
    const visited = new Set<string>()
    while (current?.parentId) {
      if (visited.has(current.id)) return false
      visited.add(current.id)
      if (cachePageIds.has(current.parentId)) return true
      current = graph.getNode(current.parentId)
    }
    return false
  }
  const cacheCandidates = candidates.filter(
    (node) => node.libraryReadonly === true && isUnderCachePage(node)
  )
  if (cacheCandidates.length === 1) return { node: cacheCandidates[0] }
  if (cacheCandidates.length > 1) {
    return {
      error: `Multiple cached components "${componentKey}" exist for library "${libraryId}"`
    }
  }
  // Legacy imports predate the hidden cache page. Preserve a unique old master,
  // but never guess when copied or duplicated metadata makes the identity ambiguous.
  if (candidates.length === 1) return { node: candidates[0] }
  if (candidates.length > 1) {
    return {
      error: `Multiple legacy components "${componentKey}" exist for library "${libraryId}"`
    }
  }
  return {}
}

function cloneSubtreeIntoGraph(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  sourceId: string,
  parentId: string
): SceneNode | null {
  const idMap = new Map<string, string>()
  const cloned = cloneSubtree(sourceGraph, targetGraph, sourceId, parentId, idMap)
  remapClonedComponentIds(sourceGraph, targetGraph, idMap)
  targetGraph.remapClonedNodeReferences(idMap)
  return cloned
}

function cloneSubtree(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  sourceId: string,
  parentId: string,
  idMap: Map<string, string>
): SceneNode | null {
  const source = sourceGraph.getNode(sourceId)
  if (!source) return null
  const props = cloneNodeProps(source, null)
  props.source = { ...(props.source as SourceMetadata), id: null, orderKey: null }
  props.componentId = null
  const clone = targetGraph.createNode(source.type, parentId, props)
  idMap.set(source.id, clone.id)
  for (const childId of source.childIds) {
    cloneSubtree(sourceGraph, targetGraph, childId, clone.id, idMap)
  }
  return clone
}

function replaceCachedMasterSubtree(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  sourceId: string,
  cachedMaster: SceneNode
): void {
  const source = sourceGraph.getNode(sourceId)
  if (!source) return
  if (
    componentStructureSignature(sourceGraph, source.id) ===
    componentStructureSignature(targetGraph, cachedMaster.id)
  ) {
    replaceMatchingSubtreeInPlace(sourceGraph, targetGraph, source, cachedMaster)
    return
  }
  const childIds = [...cachedMaster.childIds]
  for (const childId of childIds) targetGraph.deleteNode(childId)
  const props = cloneNodeProps(source, null)
  props.source = { ...(props.source as SourceMetadata), id: null, orderKey: null }
  props.componentId = null
  targetGraph.updateNode(cachedMaster.id, props)
  const idMap = new Map<string, string>([[source.id, cachedMaster.id]])
  for (const childId of source.childIds) {
    cloneSubtree(sourceGraph, targetGraph, childId, cachedMaster.id, idMap)
  }
  remapClonedComponentIds(sourceGraph, targetGraph, idMap)
  targetGraph.remapClonedNodeReferences(idMap)
}

function replaceMatchingSubtreeInPlace(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  sourceRoot: SceneNode,
  targetRoot: SceneNode
): void {
  const pairs: Array<{ source: SceneNode; target: SceneNode }> = []
  const idMap = new Map<string, string>()
  const collectPairs = (source: SceneNode, target: SceneNode): void => {
    pairs.push({ source, target })
    idMap.set(source.id, target.id)
    for (let i = 0; i < source.childIds.length; i++) {
      const sourceChild = sourceGraph.getNode(source.childIds[i] ?? '')
      const targetChild = targetGraph.getNode(target.childIds[i] ?? '')
      if (sourceChild && targetChild) collectPairs(sourceChild, targetChild)
    }
  }
  collectPairs(sourceRoot, targetRoot)

  for (const { source, target } of pairs) {
    const props = cloneNodeProps(source, null)
    props.source = { ...(props.source as SourceMetadata), id: null, orderKey: null }
    props.componentId = source.componentId ? (idMap.get(source.componentId) ?? null) : null
    targetGraph.updateNode(target.id, props)
  }
  targetGraph.remapClonedNodeReferences(idMap)
}

function remapClonedComponentIds(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  idMap: ReadonlyMap<string, string>
): void {
  for (const [sourceId, targetId] of idMap) {
    const source = sourceGraph.getNode(sourceId)
    if (!source?.componentId) continue
    targetGraph.updateNode(targetId, { componentId: idMap.get(source.componentId) ?? null })
  }
}

function copyReferencedImages(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  rootId: string
): void {
  for (const hash of collectImageHashes(sourceGraph, rootId)) {
    const data = sourceGraph.images.get(hash)
    if (data && !targetGraph.images.has(hash)) targetGraph.images.set(hash, data.slice())
  }
}

function findImageAssetConflict(
  sourceGraph: SceneGraph,
  targetGraph: SceneGraph,
  rootId: string
): string | undefined {
  for (const hash of collectImageHashes(sourceGraph, rootId)) {
    const sourceData = sourceGraph.images.get(hash)
    if (!sourceData) return `Source component references missing image "${hash}"`
    const targetData = targetGraph.images.get(hash)
    if (targetData && !equalBytes(sourceData, targetData)) {
      return `Image asset "${hash}" conflicts with existing target image data`
    }
  }
  return undefined
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  return a.every((value, index) => value === b[index])
}

function collectImageHashes(graph: SceneGraph, rootId: string): Set<string> {
  return collectImageHashesFromNodes(collectLibrarySubtreeNodes(graph, rootId))
}

function collectImageHashesFromNodes(nodes: readonly SceneNode[]): Set<string> {
  const hashes = new Set<string>()
  for (const node of nodes) {
    forEachLibraryPaint(node, (fill) => {
      if (fill.imageHash) hashes.add(fill.imageHash)
    })
  }
  return hashes
}

function forEachLibraryPaint(node: SceneNode, visit: (fill: Fill, field: string) => void): void {
  const visitFills = (fills: readonly Fill[] | undefined, field: string): void => {
    for (const [index, fill] of (fills ?? []).entries()) visit(fill, `${field}[${index}]`)
  }
  visitFills(node.fills, 'fills')
  visitFills(node.textDecorationFills, 'textDecorationFills')
  for (const [index, run] of node.styleRuns.entries()) {
    visitFills(run.style.fills, `styleRuns[${index}].fills`)
    visitFills(run.style.textDecorationFills, `styleRuns[${index}].textDecorationFills`)
  }
  for (const [index, path] of node.fillGeometry.entries()) {
    visitFills(path.fills, `fillGeometry[${index}].fills`)
  }
  for (const [index, path] of node.strokeGeometry.entries()) {
    visitFills(path.fills, `strokeGeometry[${index}].fills`)
  }
  for (const [state, override] of Object.entries(node.stateOverrides ?? {})) {
    visitFills(override.fills, `stateOverrides.${state}.fills`)
  }
}

interface LibrarySubtreeValidationContext {
  componentKey: string
  graph: SceneGraph
  issues: LibraryArtifactValidationIssue[]
  subtreeIds: ReadonlySet<string>
}

function reportExternalLibraryReference(
  context: LibrarySubtreeValidationContext,
  node: SceneNode,
  targetNodeId: string,
  field: string
): void {
  if (context.subtreeIds.has(targetNodeId)) return
  context.issues.push({
    code: 'external-node-reference',
    componentKey: context.componentKey,
    nodeId: node.id,
    message: `Component "${context.componentKey}" node "${node.id}" ${field} references node "${targetNodeId}" outside its subtree`
  })
}

function reportInvalidLibraryReference(
  context: LibrarySubtreeValidationContext,
  node: SceneNode,
  field: string
): void {
  context.issues.push({
    code: 'invalid-node-reference',
    componentKey: context.componentKey,
    nodeId: node.id,
    message: `Component "${context.componentKey}" node "${node.id}" contains an invalid ${field} reference payload`
  })
}

function inspectLibraryOverrideReference(
  context: LibrarySubtreeValidationContext,
  node: SceneNode,
  field: string,
  value: unknown,
  carrier: string
): void {
  if (field === 'componentId' || field === 'sourceComponentId') {
    if (value === null) return
    if (typeof value !== 'string' || value === '') {
      reportInvalidLibraryReference(context, node, `${carrier}.${field}`)
      return
    }
    if (field === 'componentId') {
      validateLibraryComponentTargetReference(context, node, value, `${carrier}.${field}`)
      return
    }
    reportExternalLibraryReference(context, node, value, `${carrier}.${field}`)
    return
  }
  if (field === 'motionScene') {
    const validated = validateMotionSceneSpec(value)
    if (!validated.success) throw new TypeError('invalid Motion scene override')
    for (const sequence of validated.value.sequences) {
      for (const cue of sequence.cues) {
        reportExternalLibraryReference(context, node, cue.targetNodeId, `${carrier}.${field}`)
      }
    }
    return
  }
  if (field === 'motionDrivers') {
    const validated = validateMotionDriverSpec(value)
    if (!validated.success) throw new TypeError('invalid Motion driver override')
    for (const reference of motionDriverNodeReferences(validated.value)) {
      reportExternalLibraryReference(context, node, reference, `${carrier}.${field}`)
    }
    return
  }
  if (field !== 'prototype') return
  const validated = validatePrototypeSpec(value)
  if (!validated.success) throw new TypeError('invalid prototype override')
  for (const reference of prototypeNodeReferences(validated.value)) {
    reportExternalLibraryReference(context, node, reference, `${carrier}.${field}`)
  }
}

function inspectLibraryOverrideReferences(
  context: LibrarySubtreeValidationContext,
  node: SceneNode,
  overrides: Readonly<Record<string, unknown>> | undefined,
  carrier: string
): void {
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const separator = key.lastIndexOf(':')
    const field = separator === -1 ? key : key.slice(separator + 1)
    if (separator !== -1) {
      reportExternalLibraryReference(context, node, key.slice(0, separator), `${carrier} key`)
    }
    try {
      inspectLibraryOverrideReference(context, node, field, value, carrier)
    } catch {
      reportInvalidLibraryReference(context, node, `${carrier}.${field}`)
    }
  }
}

const REMOTE_LIBRARY_VISUAL_INTERACTIVE_PROP_KEYS: Partial<Record<NodeType, ReadonlySet<string>>> =
  {
    BUTTON: new Set(['text', 'textColor']),
    INPUT: new Set(['placeholder', 'value', 'textColor', 'placeholderColor']),
    SELECT: new Set(['options', 'value']),
    CHECKBOX: new Set(['options', 'checked']),
    RADIO: new Set(['options', 'value', 'groupName']),
    TEXTAREA: new Set(['placeholder', 'value', 'textColor', 'placeholderColor']),
    DATEPICKER: new Set(['value', 'min', 'max']),
    SWITCH: new Set(['checked'])
  }

const REMOTE_LIBRARY_STRING_INTERACTIVE_PROP_KEYS = new Set([
  'text',
  'placeholder',
  'value',
  'groupName',
  'min',
  'max',
  'textColor',
  'placeholderColor'
])

function isRemoteLibraryVisualInteractivePropValue(key: string, value: unknown): boolean {
  if (REMOTE_LIBRARY_STRING_INTERACTIVE_PROP_KEYS.has(key)) return typeof value === 'string'
  if (key === 'checked') return typeof value === 'boolean'
  return (
    key === 'options' && Array.isArray(value) && value.every((item) => typeof item === 'string')
  )
}

function isRemoteLibraryRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUnsafeRemoteLibraryInteractiveProps(node: SceneNode): boolean {
  const interactiveProps: unknown = node.interactiveProps
  if (interactiveProps === undefined) return false
  if (!isRemoteLibraryRecord(interactiveProps)) return true
  const allowedKeys = REMOTE_LIBRARY_VISUAL_INTERACTIVE_PROP_KEYS[node.type]
  return Object.entries(interactiveProps).some(
    ([key, value]) =>
      allowedKeys?.has(key) !== true || !isRemoteLibraryVisualInteractivePropValue(key, value)
  )
}

function hasNonEmptyOrMalformedRemoteLibraryArray(value: unknown): boolean {
  return value !== undefined && (!Array.isArray(value) || value.length > 0)
}

function hasNonEmptyOrMalformedRemoteLibraryRecord(value: unknown): boolean {
  return value !== undefined && (!isRemoteLibraryRecord(value) || Object.keys(value).length > 0)
}

function hasRemoteLibraryStateDependency(node: SceneNode): boolean {
  const renderCondition: unknown = node.renderCondition
  return (
    hasNonEmptyOrMalformedRemoteLibraryArray(node.state) ||
    hasNonEmptyOrMalformedRemoteLibraryRecord(node.bindings) ||
    (renderCondition !== undefined &&
      (typeof renderCondition !== 'string' || renderCondition.length > 0))
  )
}

function hasRemoteLibraryApplicationConfig(node: SceneNode): boolean {
  return (
    node.lowcodeDocumentState !== undefined ||
    node.lowcodeSeoMetadata !== undefined ||
    node.lowcodeWorkflows !== undefined ||
    node.lowcodeServerWorkflows !== undefined ||
    node.lowcodeSupabaseConfig !== undefined ||
    node.lowcodeAnalyticsConfig !== undefined ||
    node.lowcodeHeadMetadata !== undefined ||
    node.lowcodeCustomCss !== undefined ||
    node.lowcodeTranslations !== undefined ||
    node.lowcodeRoutePattern !== undefined ||
    node.lowcodeRequiresAuth !== undefined ||
    node.lowcodeAuthRedirect !== undefined ||
    node.lowcodeLibraries !== undefined
  )
}

function hasActiveRemoteLibraryBehavior(node: SceneNode): boolean {
  const events: unknown = node.events
  const hasEventActions =
    events !== undefined &&
    (!isRemoteLibraryRecord(events) ||
      Object.values(events).some((actions) => !Array.isArray(actions) || actions.length > 0))
  return (
    hasRemoteLibraryStateDependency(node) ||
    hasEventActions ||
    hasUnsafeRemoteLibraryInteractiveProps(node) ||
    hasRemoteLibraryApplicationConfig(node)
  )
}

function validateLibraryNodeReferences(
  context: LibrarySubtreeValidationContext,
  node: SceneNode
): void {
  forEachLibraryPaint(node, (fill, field) => {
    const sourceNodeId: unknown = fill.sourceNodeId
    if (fill.type === 'PATTERN' && (typeof sourceNodeId !== 'string' || sourceNodeId === '')) {
      reportInvalidLibraryReference(context, node, `${field}.sourceNodeId`)
    } else if (typeof sourceNodeId === 'string') {
      reportExternalLibraryReference(context, node, sourceNodeId, `${field}.sourceNodeId`)
    }
  })
  validateLibraryComponentPropertyReferences(context, node)
  if (node.motionScene) {
    for (const sequence of node.motionScene.sequences) {
      for (const cue of sequence.cues) {
        reportExternalLibraryReference(context, node, cue.targetNodeId, 'motionScene')
      }
    }
  }
  if (node.motionDrivers) {
    for (const reference of motionDriverNodeReferences(node.motionDrivers)) {
      reportExternalLibraryReference(context, node, reference, 'motionDrivers')
    }
  }
  if (node.prototype) {
    for (const reference of prototypeNodeReferences(node.prototype)) {
      reportExternalLibraryReference(context, node, reference, 'prototype')
    }
  }
  inspectLibraryOverrideReferences(context, node, node.overrides, 'overrides')
  inspectLibraryOverrideReferences(
    context,
    node,
    node.pendingInstanceOverrides,
    'pendingInstanceOverrides'
  )
}

function validateLibraryComponentPropertyReferences(
  context: LibrarySubtreeValidationContext,
  node: SceneNode
): void {
  for (const [index, definition] of node.componentPropertyDefinitions.entries()) {
    if (definition.type !== 'INSTANCE_SWAP' || definition.defaultValue === '') continue
    validateLibraryComponentTargetReference(
      context,
      node,
      definition.defaultValue,
      `componentPropertyDefinitions[${index}].defaultValue`
    )
  }
  const swapPropertyIds = instanceSwapPropertyIds(context.graph, node)
  for (const [propertyId, value] of Object.entries(node.componentPropertyAssignments)) {
    if (!swapPropertyIds.has(propertyId) || value === '') continue
    validateLibraryComponentTargetReference(
      context,
      node,
      value,
      `componentPropertyAssignments.${propertyId}`
    )
  }
}

function instanceSwapPropertyIds(graph: SceneGraph, node: SceneNode): ReadonlySet<string> {
  if (node.type !== 'INSTANCE' || !node.componentId) return new Set()
  const component = graph.getNode(node.componentId)
  if (!component || (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET')) {
    return new Set()
  }
  const parent = component.parentId ? graph.getNode(component.parentId) : undefined
  const owners = parent?.type === 'COMPONENT_SET' ? [parent, component] : [component]
  return new Set(
    owners.flatMap((owner) =>
      owner.componentPropertyDefinitions
        .filter((definition) => definition.type === 'INSTANCE_SWAP')
        .map((definition) => definition.id)
    )
  )
}

function validateLibraryComponentTargetReference(
  context: LibrarySubtreeValidationContext,
  node: SceneNode,
  targetNodeId: string,
  field: string
): void {
  const target = context.graph.getNode(targetNodeId)
  if (target?.type !== 'COMPONENT') {
    reportInvalidLibraryReference(context, node, field)
    return
  }
  reportExternalLibraryReference(context, node, target.id, field)
}

function validateLibrarySubtree(
  graph: SceneGraph,
  componentKey: string,
  root: SceneNode,
  nodes: readonly SceneNode[],
  issues: LibraryArtifactValidationIssue[],
  imageValidationCache: Map<string, CachedLibraryImageValidationIssue | null>
): void {
  const subtreeIds = new Set(nodes.map((node) => node.id))
  const context = { componentKey, graph, issues, subtreeIds }

  for (const node of nodes) {
    if (node.internalOnly || node.lowcodeLibraryCache) {
      issues.push({
        code: 'internal-library-node',
        componentKey,
        nodeId: node.id,
        message: `Component "${componentKey}" node "${node.id}" carries target-document internal cache metadata`
      })
    }
    if (
      node.symbolLinks.length > 0 ||
      node.pluginRelaunchData.length > 0 ||
      node.pluginData.some((entry) => entry.pluginId !== 'open-pencil')
    ) {
      issues.push({
        code: 'unsafe-library-metadata',
        componentKey,
        nodeId: node.id,
        message: `Component "${componentKey}" node "${node.id}" contains external links, plugin relaunch commands, or third-party plugin data`
      })
    }
    if (Object.keys(node.boundVariables).length > 0) {
      issues.push({
        code: 'bound-variables',
        componentKey,
        nodeId: node.id,
        message: `Component "${componentKey}" node "${node.id}" contains bound variables`
      })
    }
    if (node.componentId && !subtreeIds.has(node.componentId)) {
      issues.push({
        code: 'external-component-reference',
        componentKey,
        nodeId: node.id,
        message: `Component "${componentKey}" node "${node.id}" references component "${node.componentId}" outside its subtree`
      })
    }
    if (hasActiveRemoteLibraryBehavior(node)) {
      issues.push({
        code: 'active-lowcode-behavior',
        componentKey,
        nodeId: node.id,
        message: `Component "${componentKey}" node "${node.id}" contains active lowcode behavior that remote design libraries do not accept`
      })
    }
    validateLibraryNodeReferences(context, node)
  }

  for (const imageHash of collectImageHashesFromNodes(nodes)) {
    const imageBytes = graph.images.get(imageHash)
    if (!imageBytes) {
      issues.push({
        code: 'missing-image',
        componentKey,
        nodeId: root.id,
        imageHash,
        message: `Component "${componentKey}" references missing image "${imageHash}"`
      })
      continue
    }
    let imageIssue = imageValidationCache.get(imageHash)
    if (imageIssue === undefined) {
      imageIssue = inspectRemoteLibraryImage(imageBytes)
      imageValidationCache.set(imageHash, imageIssue)
    }
    if (imageIssue) {
      issues.push({
        code: imageIssue.code,
        componentKey,
        nodeId: root.id,
        imageHash,
        message: `Component "${componentKey}" references image "${imageHash}" that ${imageIssue.message}`
      })
    }
  }
}

function inspectRemoteLibraryImage(bytes: Uint8Array): CachedLibraryImageValidationIssue | null {
  const inspection = inspectImageBytes(bytes)
  if (
    inspection.headerValidation !== 'valid' ||
    inspection.dimensionStatus !== 'parsed' ||
    !inspection.dimensions ||
    !inspection.mimeType ||
    !REMOTE_LIBRARY_IMAGE_MIME_TYPES.has(inspection.mimeType)
  ) {
    return {
      code: 'invalid-image',
      message: `is not a complete PNG, JPEG, or WebP image with parsed dimensions (${inspection.reason ?? 'unsupported image format'})`
    }
  }
  const { width, height } = inspection.dimensions
  const pixels = BigInt(width) * BigInt(height)
  if (
    width > REMOTE_LIBRARY_IMAGE_LIMITS.maxSide ||
    height > REMOTE_LIBRARY_IMAGE_LIMITS.maxSide ||
    pixels > BigInt(REMOTE_LIBRARY_IMAGE_LIMITS.maxPixels)
  ) {
    return {
      code: 'oversized-image',
      message: `declares ${width}x${height} pixels, exceeding ${REMOTE_LIBRARY_IMAGE_LIMITS.maxSide}px per side or ${REMOTE_LIBRARY_IMAGE_LIMITS.maxPixels} total pixels`
    }
  }
  return null
}

type ManifestComponentSubtreeCollection =
  | { ok: true; nodes: SceneNode[] }
  | {
      ok: false
      reason: 'overlap'
      nodeId: string
      ownerComponentKey: string
    }
  | { ok: false; reason: 'work-limit' }

function collectManifestComponentSubtreeNodes(
  graph: SceneGraph,
  rootId: string,
  componentKey: string,
  claimedNodeIds: Map<string, string>,
  budget: LibraryValidationBudget
): ManifestComponentSubtreeCollection {
  const nodes: SceneNode[] = []
  const visited = new Set<string>()
  const pending = [rootId]
  while (pending.length > 0) {
    const nodeId = pending.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    budget.subtreeNodeVisits += 1
    if (budget.subtreeNodeVisits > REMOTE_LIBRARY_VALIDATION_LIMITS.maxSubtreeNodeVisits) {
      return { ok: false, reason: 'work-limit' }
    }
    const ownerComponentKey = claimedNodeIds.get(nodeId)
    if (ownerComponentKey) {
      return { ok: false, reason: 'overlap', nodeId, ownerComponentKey }
    }
    const node = graph.getNode(nodeId)
    if (!node) continue
    nodes.push(node)
    for (const childId of node.childIds) pending.push(childId)
  }
  for (const node of nodes) claimedNodeIds.set(node.id, componentKey)
  return { ok: true, nodes }
}

function consumeLibraryCanonicalWork(
  nodes: readonly SceneNode[],
  budget: LibraryValidationBudget
): string | null {
  const visiting = new WeakSet<object>()
  const consume = (value: unknown, depth: number): string | null => {
    if (depth > REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalValueDepth) {
      return `value depth exceeds ${REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalValueDepth}`
    }
    budget.canonicalValueVisits += 1
    if (budget.canonicalValueVisits > REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalValueVisits) {
      return `value visits exceed ${REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalValueVisits}`
    }
    if (typeof value === 'string') {
      budget.canonicalCodeUnits += value.length
      return budget.canonicalCodeUnits > REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalCodeUnits
        ? `string data exceeds ${REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalCodeUnits} code units`
        : null
    }
    if (value instanceof Uint8Array) {
      budget.canonicalBinaryBytes += value.byteLength
      return budget.canonicalBinaryBytes > REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalBinaryBytes
        ? `binary data exceeds ${REMOTE_LIBRARY_VALIDATION_LIMITS.maxCanonicalBinaryBytes} bytes`
        : null
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      return `value contains unsupported ${typeof value} data`
    }
    if (value === null || typeof value !== 'object') return null
    if (visiting.has(value)) return 'value contains a cycle'
    visiting.add(value)
    let failure: string | null = null

    if (Array.isArray(value)) {
      for (const item of value) {
        const reason = consume(item, depth + 1)
        if (reason) {
          failure = reason
          break
        }
      }
    } else {
      for (const [key, item] of Object.entries(value)) {
        const keyReason = consume(key, depth + 1)
        if (keyReason) {
          failure = keyReason
          break
        }
        if (item === undefined) continue
        const itemReason = consume(item, depth + 1)
        if (itemReason) {
          failure = itemReason
          break
        }
      }
    }
    visiting.delete(value)
    return failure
  }

  for (const node of nodes) {
    for (const key of Object.keys(node).sort() as Array<keyof SceneNode>) {
      if (VERSION_HASH_EXCLUDED_KEYS.has(key)) continue
      const value = node[key]
      if (value === undefined) continue
      const keyReason = consume(key, 0)
      if (keyReason) return keyReason
      const reason = consume(value, 0)
      if (reason) return reason
    }
    const childrenKeyReason = consume('children', 0)
    if (childrenKeyReason) return childrenKeyReason
  }
  return null
}

function collectLibrarySubtreeNodes(graph: SceneGraph, rootId: string): SceneNode[] {
  const nodes: SceneNode[] = []
  const visited = new Set<string>()
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const node = graph.getNode(nodeId)
    if (!node) return
    nodes.push(node)
    for (const childId of node.childIds) visit(childId)
  }
  visit(rootId)
  return nodes
}

function resolveLibraryOperationEntry(options: {
  componentKey: string
  manifest: LibraryManifest
  manifestSource?: LibrarySource
  targetGraph: SceneGraph
}): LibraryComponentManifestEntry | { error: string } {
  const manifestEntry = findManifestEntry(options.manifest, options.componentKey)
  if (!manifestEntry) return missingManifestEntryError(options.componentKey)
  return (
    findManifestSourceConflict(
      options.targetGraph,
      options.manifest.libraryId,
      options.manifestSource
    ) ?? manifestEntry
  )
}

function upsertImportedLibraryRef(
  targetGraph: SceneGraph,
  manifest: LibraryManifest,
  source: LibraryRef['source'],
  component: LibraryComponentManifestEntry,
  manifestSource?: LibrarySource
): LibraryRef {
  const root = targetGraph.getNode(targetGraph.rootId)
  const libraries = root?.lowcodeLibraries ? structuredClone(root.lowcodeLibraries) : []
  const existing = libraries.find((library) => library.libraryId === manifest.libraryId)
  const imported = { key: component.key, version: component.version }
  const libraryRef: LibraryRef =
    existing ??
    ({
      libraryId: manifest.libraryId,
      name: manifest.name,
      source: { ...source },
      ...(manifestSource ? { manifestSource: { ...manifestSource } } : {}),
      importedComponents: []
    } satisfies LibraryRef)
  libraryRef.name = manifest.name
  libraryRef.source = { ...source }
  if (manifestSource) libraryRef.manifestSource = { ...manifestSource }
  const current = libraryRef.importedComponents.find((item) => item.key === component.key)
  if (current) current.version = component.version
  else libraryRef.importedComponents.push(imported)
  if (!existing) libraries.push(libraryRef)
  targetGraph.updateNode(targetGraph.rootId, { lowcodeLibraries: libraries })
  return libraryRef
}

function findLibraryRefSource(
  targetGraph: SceneGraph,
  libraryId: string
): LibraryRef['source'] | undefined {
  const root = targetGraph.getNode(targetGraph.rootId)
  return root?.lowcodeLibraries?.find((library) => library.libraryId === libraryId)?.source
}

function findManifestSourceConflict(
  targetGraph: SceneGraph,
  libraryId: string,
  manifestSource: LibrarySource | undefined
): { error: string } | null {
  if (!manifestSource) return null
  const existingManifestSource = targetGraph
    .getNode(targetGraph.rootId)
    ?.lowcodeLibraries?.filter((library) => library.libraryId === libraryId)
    .map((library) => library.manifestSource)
    .find(
      (source): source is LibrarySource =>
        source !== undefined && !librarySourcesEqual(source, manifestSource)
    )
  if (!existingManifestSource) return null
  return {
    error: `Library "${libraryId}" is already bound to manifest source "${formatLibrarySource(existingManifestSource)}"; refusing to rebind to "${formatLibrarySource(manifestSource)}"`
  }
}

function librarySourcesEqual(a: LibrarySource, b: LibrarySource): boolean {
  return a.kind === b.kind && a.ref === b.ref
}

function formatLibrarySource(source: LibrarySource): string {
  return `${source.kind}:${source.ref}`
}

function componentStructureSignature(graph: SceneGraph, rootId: string): string {
  const node = graph.getNode(rootId)
  if (!node) return ''
  return stableStringify(structureSignature(graph, node))
}

function structureSignature(graph: SceneGraph, node: SceneNode): unknown {
  return {
    type: node.type,
    children: node.childIds
      .map((childId) => graph.getNode(childId))
      .filter((child): child is SceneNode => child !== undefined)
      .map((child) => structureSignature(graph, child))
  }
}

function normalizeNode(graph: SceneGraph, node: SceneNode): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(node).sort() as Array<keyof SceneNode>) {
    if (VERSION_HASH_EXCLUDED_KEYS.has(key)) continue
    const value = node[key]
    if (value !== undefined) out[key] = normalizeValue(value)
  }
  out.children = node.childIds
    .map((childId) => graph.getNode(childId))
    .filter((child): child is SceneNode => child !== undefined)
    .map((child) => normalizeNode(graph, child))
  return out
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      if (item !== undefined) out[key] = normalizeValue(item)
    }
    return out
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function hashString(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mod = 0xffffffffffffffffn
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i))
    hash = (hash * prime) & mod
  }
  return hash.toString(16).padStart(16, '0')
}
