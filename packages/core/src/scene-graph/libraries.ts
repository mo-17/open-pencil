import { randomHex } from '#core/random'

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
  const manifestEntry = options.manifest.components.find(
    (component) => component.key === options.componentKey
  )
  if (!manifestEntry) {
    return { error: `Component key "${options.componentKey}" not found in library manifest` }
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
  options.targetGraph.updateNode(clone.id, {
    componentKey: manifestEntry.key,
    libraryComponentKey: manifestEntry.key,
    libraryId: options.manifest.libraryId,
    libraryVersion: manifestEntry.version,
    libraryReadonly: true
  })

  const libraryRef = upsertImportedLibraryRef(
    options.targetGraph,
    options.manifest,
    source,
    manifestEntry
  )

  return { component: manifestEntry, importedNodeId: clone.id, libraryRef }
}

export function componentSubtreeVersion(graph: SceneGraph, componentId: string): string {
  const node = graph.getNode(componentId)
  if (!node) return 'v0-missing'
  return `v1-${hashString(stableStringify(normalizeNode(graph, node)))}`
}

function resolveManifestComponent(
  graph: SceneGraph,
  entry: LibraryComponentManifestEntry
): SceneNode | undefined {
  const byId = graph.getNode(entry.nodeId)
  if (byId) return byId
  return [...graph.getAllNodes()].find(
    (node) =>
      (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
      (node.libraryComponentKey === entry.key || node.componentKey === entry.key)
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
