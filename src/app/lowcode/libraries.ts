import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import {
  checkLibraryUpdates,
  type LibraryComponentManifestEntry,
  type LibraryManifest,
  type LibraryRef,
  type LibraryUpdateStatus,
  type SceneGraph
} from '@open-pencil/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

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

function sourceLabel(library: LibraryRef): string {
  return `${library.source.kind}:${library.source.ref}`
}
