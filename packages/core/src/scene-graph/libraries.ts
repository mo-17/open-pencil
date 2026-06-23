import { randomHex } from '#core/random'

import type { SceneGraph } from './index'
import type { LibraryRef, NodeType, SceneNode } from './types'

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

export function componentSubtreeVersion(graph: SceneGraph, componentId: string): string {
  const node = graph.getNode(componentId)
  if (!node) return 'v0-missing'
  return `v1-${hashString(stableStringify(normalizeNode(graph, node)))}`
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
