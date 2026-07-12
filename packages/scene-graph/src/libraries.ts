import { cloneNodeProps } from './copy'
import type { SceneGraph } from './index'
import type { Fill, LibraryRef, NodeType, SceneNode, SourceMetadata } from './types'

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
}

export interface AcceptLibraryUpdateResult {
  component: LibraryComponentManifestEntry
  cachedNodeId: string
  previousVersion?: string
  libraryRef: LibraryRef
  warnings: string[]
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
  const manifestEntry = findManifestEntry(options.manifest, options.componentKey)
  if (!manifestEntry) {
    return missingManifestEntryError(options.componentKey)
  }
  const source = options.source ?? options.manifest.source
  if (!source) return { error: 'library source is required to register imported components' }
  const parentId = options.parentId ?? options.targetGraph.getPages()[0]?.id
  if (!parentId || !options.targetGraph.getNode(parentId)) {
    return { error: `Target parent "${parentId}" not found` }
  }

  const sourceRoot = resolveManifestComponent(options.sourceGraph, manifestEntry)
  if (!sourceRoot) {
    return { error: `Source component "${manifestEntry.key}" not found in source graph` }
  }
  if (sourceRoot.type !== 'COMPONENT' && sourceRoot.type !== 'COMPONENT_SET') {
    return { error: `Source node "${sourceRoot.id}" is not a COMPONENT or COMPONENT_SET` }
  }

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
    manifestEntry
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

    const cachedMaster = findCachedLibraryMaster(
      options.targetGraph,
      options.manifest.libraryId,
      imported.key
    )
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
  const manifestEntry = findManifestEntry(options.manifest, options.componentKey)
  if (!manifestEntry) {
    return missingManifestEntryError(options.componentKey)
  }

  const cachedMaster = findCachedLibraryMaster(
    options.targetGraph,
    options.manifest.libraryId,
    manifestEntry.key
  )
  if (!cachedMaster) {
    return { error: `Cached component "${manifestEntry.key}" not found in target graph` }
  }
  if (cachedMaster.type !== manifestEntry.type) {
    return {
      error: `Cached component "${manifestEntry.key}" type changed from ${cachedMaster.type} to ${manifestEntry.type}`
    }
  }

  const sourceRoot = resolveManifestComponent(options.sourceGraph, manifestEntry)
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
    manifestEntry
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

function resolveManifestComponent(
  graph: SceneGraph,
  entry: LibraryComponentManifestEntry
): SceneNode | undefined {
  const byId = graph.getNode(entry.nodeId)
  if (
    byId &&
    (byId.type === 'COMPONENT' || byId.type === 'COMPONENT_SET') &&
    (byId.libraryComponentKey === entry.key ||
      byId.componentKey === entry.key ||
      byId.name === entry.name)
  ) {
    return byId
  }
  return [...graph.getAllNodes()].find(
    (node) =>
      (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
      (node.libraryComponentKey === entry.key || node.componentKey === entry.key)
  )
}

function findCachedLibraryMaster(
  graph: SceneGraph,
  libraryId: string,
  componentKey: string
): SceneNode | undefined {
  return [...graph.getAllNodes()].find(
    (node) =>
      (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
      node.libraryId === libraryId &&
      (node.libraryComponentKey === componentKey || node.componentKey === componentKey)
  )
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
    if (data) targetGraph.images.set(hash, data.slice())
  }
}

function collectImageHashes(graph: SceneGraph, rootId: string): Set<string> {
  const hashes = new Set<string>()
  const visit = (id: string): void => {
    const node = graph.getNode(id)
    if (!node) return
    collectImageHashesFromFills(node.fills, hashes)
    collectImageHashesFromFills(node.textDecorationFills, hashes)
    for (const run of node.styleRuns) {
      collectImageHashesFromFills(run.style.fills, hashes)
      collectImageHashesFromFills(run.style.textDecorationFills, hashes)
    }
    for (const childId of node.childIds) visit(childId)
  }
  visit(rootId)
  return hashes
}

function collectImageHashesFromFills(fills: Fill[] | undefined, hashes: Set<string>): void {
  for (const fill of fills ?? []) {
    if (fill.imageHash) hashes.add(fill.imageHash)
  }
}

function upsertImportedLibraryRef(
  targetGraph: SceneGraph,
  manifest: LibraryManifest,
  source: LibraryRef['source'],
  component: LibraryComponentManifestEntry
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
      source,
      importedComponents: []
    } satisfies LibraryRef)
  libraryRef.name = manifest.name
  libraryRef.source = source
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
