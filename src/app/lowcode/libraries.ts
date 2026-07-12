import { toRaw } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import {
  checkLibraryUpdates,
  SceneGraph,
  type LibraryComponentManifestEntry,
  type LibraryManifest,
  type LibraryRef,
  type LibraryUpdateStatus
} from '@open-pencil/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

type RawObject = {
  [key: string]: unknown
}

export type LibraryPanelStatus = LibraryUpdateStatus | 'unknown'

export interface LibraryPanelRow {
  libraryId: string
  libraryName: string
  sourceRef: string
  componentKey: string
  currentVersion?: string
  latestVersion?: string
  cachedNodeId?: string
  status: LibraryPanelStatus
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function assertSourceKind(value: unknown): 'file' | 'url' {
  const kind = assertString(value, 'manifest.source.kind')
  if (kind !== 'file' && kind !== 'url') {
    throw new Error('manifest.source.kind must be file or url')
  }
  return kind
}

export function parseLibraryManifestText(text: string): LibraryManifest {
  const value = JSON.parse(text) as unknown
  if (!isRecord(value)) throw new Error('Manifest must be a JSON object')
  const libraryId = assertString(value.libraryId, 'manifest.libraryId')
  const name = assertString(value.name, 'manifest.name')
  if (!Array.isArray(value.components)) {
    throw new TypeError('manifest.components must be an array')
  }
  const components = value.components.map((component, index) => {
    if (!isRecord(component)) throw new Error(`manifest.components[${index}] must be an object`)
    const componentTypeRaw = assertString(component.type, `manifest.components[${index}].type`)
    if (componentTypeRaw !== 'COMPONENT' && componentTypeRaw !== 'COMPONENT_SET') {
      throw new Error(`manifest.components[${index}].type must be COMPONENT or COMPONENT_SET`)
    }
    const componentType: LibraryComponentManifestEntry['type'] = componentTypeRaw
    return {
      key: assertString(component.key, `manifest.components[${index}].key`),
      name: assertString(component.name, `manifest.components[${index}].name`),
      version: assertString(component.version, `manifest.components[${index}].version`),
      nodeId: assertString(component.nodeId, `manifest.components[${index}].nodeId`),
      type: componentType
    }
  })

  return {
    libraryId,
    name,
    ...(isRecord(value.source)
      ? {
          source: {
            kind: assertSourceKind(value.source.kind),
            ref: assertString(value.source.ref, 'manifest.source.ref')
          }
        }
      : {}),
    components
  }
}

export function libraryPanelRows(
  graph: SceneGraph,
  manifest?: LibraryManifest | null
): LibraryPanelRow[] {
  const root = graph.getNode(graph.rootId)
  const libraries = root?.lowcodeLibraries ?? []
  const checksByKey = manifest
    ? new Map(
        checkLibraryUpdates({ targetGraph: graph, manifest }).map((check) => [
          check.componentKey,
          check
        ])
      )
    : new Map()

  return libraries.flatMap((library) => {
    const matchingManifest = manifest?.libraryId === library.libraryId ? manifest : undefined
    return library.importedComponents.map((imported) => {
      const check = checksByKey.get(imported.key)
      return {
        libraryId: library.libraryId,
        libraryName: library.name,
        sourceRef: sourceLabel(library),
        componentKey: imported.key,
        currentVersion: check?.currentVersion ?? imported.version,
        latestVersion:
          check?.latestVersion ??
          matchingManifest?.components.find((component) => component.key === imported.key)?.version,
        cachedNodeId: check?.cachedNodeId,
        status: check?.status ?? 'unknown'
      }
    })
  })
}

export async function readLibraryGraphFile(file: File): Promise<SceneGraph> {
  const data = new Uint8Array(await file.arrayBuffer())
  const { graph } = await io.readDocument({ name: file.name, mimeType: file.type, data })
  return graph
}

export function cloneSceneGraphForLibraryUndo(graph: SceneGraph): SceneGraph {
  const rawGraph = toRaw(graph)
  const clone = new SceneGraph()
  clone.nodes = new Map([...rawGraph.nodes].map(([id, node]) => [id, cloneRaw(node)]))
  clone.images = new Map(
    [...rawGraph.images].map(([id, data]) => [id, new Uint8Array(toRaw(data))])
  )
  clone.variables = new Map(
    [...rawGraph.variables].map(([id, variable]) => [id, cloneRaw(variable)])
  )
  clone.variableCollections = new Map(
    [...rawGraph.variableCollections].map(([id, collection]) => [id, cloneRaw(collection)])
  )
  clone.activeMode = new Map(rawGraph.activeMode)
  clone.rootId = rawGraph.rootId
  clone.figKiwiVersion = rawGraph.figKiwiVersion
  clone.figSchemaDeflated = rawGraph.figSchemaDeflated
    ? new Uint8Array(toRaw(rawGraph.figSchemaDeflated))
    : null
  clone.documentColorSpace = rawGraph.documentColorSpace
  clone.instanceIndex = new Map()
  for (const node of clone.nodes.values()) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    const ids = clone.instanceIndex.get(node.componentId) ?? new Set<string>()
    ids.add(node.id)
    clone.instanceIndex.set(node.componentId, ids)
  }
  return clone
}

function cloneRaw<T>(value: T): T {
  return structuredClone(deepToRaw(value)) as T
}

function deepToRaw(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value

  const raw = toRaw(value)
  if (raw instanceof Uint8Array) return new Uint8Array(raw)
  if (Array.isArray(raw)) return raw.map(deepToRaw)

  if (!isRawObject(raw)) return raw

  const copy: RawObject = {}
  for (const [key, child] of Object.entries(raw)) {
    copy[key] = deepToRaw(child)
  }
  return copy
}

function isRawObject(value: object): value is RawObject {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function sourceLabel(library: LibraryRef): string {
  return `${library.source.kind}:${library.source.ref}`
}
