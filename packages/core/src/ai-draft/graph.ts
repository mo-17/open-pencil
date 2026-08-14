import {
  canonicalManifestBytes,
  digestCanonicalManifest,
  encodeBase64URL,
  type SceneGraph
} from '@open-pencil/scene-graph'

import {
  clearLazyFigImportContext,
  getLazyFigImportContext,
  setLazyFigImportContext
} from '#core/kiwi/fig/lazy-import'
import {
  deserializeSceneGraph,
  serializeSceneGraph,
  type SerializedSceneGraph
} from '#core/kiwi/fig/parse/transfer'

import type { AIShadowDraftLimits } from './types'

export const DEFAULT_AI_SHADOW_DRAFT_LIMITS: Readonly<AIShadowDraftLimits> = Object.freeze({
  maxNodes: 100_000,
  maxImageBytes: 128 * 1024 * 1024,
  maxCanonicalBytes: 64 * 1024 * 1024
})

export interface DetachedGraphSnapshot {
  readonly data: SerializedSceneGraph
  readonly nodeCount: number
  readonly imageBytes: number
}

function positiveSafeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value
}

export function resolveAIShadowDraftLimits(
  value: Partial<AIShadowDraftLimits> = {}
): Readonly<AIShadowDraftLimits> {
  return Object.freeze({
    maxNodes: positiveSafeInteger(
      value.maxNodes ?? DEFAULT_AI_SHADOW_DRAFT_LIMITS.maxNodes,
      'limits.maxNodes'
    ),
    maxImageBytes: positiveSafeInteger(
      value.maxImageBytes ?? DEFAULT_AI_SHADOW_DRAFT_LIMITS.maxImageBytes,
      'limits.maxImageBytes'
    ),
    maxCanonicalBytes: positiveSafeInteger(
      value.maxCanonicalBytes ?? DEFAULT_AI_SHADOW_DRAFT_LIMITS.maxCanonicalBytes,
      'limits.maxCanonicalBytes'
    )
  })
}

function totalBinaryBytes(data: SerializedSceneGraph): number {
  let total = data.figSchemaDeflated?.byteLength ?? 0
  for (const [, bytes] of data.images) total += bytes.byteLength
  for (const bytes of data.lazyFigImport?.blobs ?? []) total += bytes.byteLength
  return total
}

function assertFiniteSnapshotNumbers(value: unknown): void {
  const pending: unknown[] = [value]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new TypeError('Shadow draft content contains a non-finite number')
      }
      continue
    }
    if (!current || typeof current !== 'object' || ArrayBuffer.isView(current)) continue
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...Object.values(current))
  }
}

function checkSnapshotLimits(
  data: SerializedSceneGraph,
  limits: Readonly<AIShadowDraftLimits>
): DetachedGraphSnapshot {
  const nodeCount = data.nodes.length
  const imageBytes = totalBinaryBytes(data)
  if (nodeCount > limits.maxNodes) {
    throw new RangeError(`Shadow draft has ${nodeCount} nodes; limit is ${limits.maxNodes}`)
  }
  if (imageBytes > limits.maxImageBytes) {
    throw new RangeError(
      `Shadow draft has ${imageBytes} binary image bytes; limit is ${limits.maxImageBytes}`
    )
  }
  return { data, nodeCount, imageBytes }
}

export function snapshotDetachedGraph(
  graph: SceneGraph,
  limits: Readonly<AIShadowDraftLimits>
): DetachedGraphSnapshot {
  if (graph.getNodeCount() > limits.maxNodes) {
    throw new RangeError(
      `Shadow draft has ${graph.getNodeCount()} nodes; limit is ${limits.maxNodes}`
    )
  }
  const serialized = serializeSceneGraph(graph)
  if (totalBinaryBytes(serialized) > limits.maxImageBytes) {
    throw new RangeError(`Shadow draft binary content exceeds ${limits.maxImageBytes} bytes`)
  }
  const cloned = structuredClone({
    ...serialized,
    // CanvasKit-backed text pictures are an ephemeral render cache, not document content.
    nodes: serialized.nodes.map(([id, node]) => [id, { ...node, textPicture: null }])
  } satisfies SerializedSceneGraph)
  assertFiniteSnapshotNumbers(cloned)
  return checkSnapshotLimits(cloned, limits)
}

export function graphFromDetachedSnapshot(snapshot: DetachedGraphSnapshot): SceneGraph {
  return deserializeSceneGraph(structuredClone(snapshot.data))
}

/** Replace a shadow graph in place after an isolated async repair succeeds. */
export function adoptDetachedGraphSnapshot(
  target: SceneGraph,
  snapshot: DetachedGraphSnapshot
): void {
  const source = graphFromDetachedSnapshot(snapshot)
  target.rootId = source.rootId
  target.nodes = source.nodes
  target.images = source.images
  target.variables = source.variables
  target.variableCollections = source.variableCollections
  target.activeMode = source.activeMode
  target.instanceIndex = source.instanceIndex
  target.figKiwiVersion = source.figKiwiVersion
  target.figSchemaDeflated = source.figSchemaDeflated
  target.figMessageObjectAnimations = source.figMessageObjectAnimations
  target.documentColorSpace = source.documentColorSpace
  target.positionPreviewVersion = source.positionPreviewVersion
  const lazy = getLazyFigImportContext(source)
  if (lazy) setLazyFigImportContext(target, lazy)
  else clearLazyFigImportContext(target)
  target.clearAbsPosCache()
}

function sortedEntries<T>(entries: readonly [string, T][]): Array<[string, T]> {
  return [...entries].sort(([left], [right]) => left.localeCompare(right))
}

async function binaryDigest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return encodeBase64URL(new Uint8Array(digest))
}

async function binaryEntries(
  entries: readonly [string, Uint8Array][]
): Promise<Array<[string, { byteLength: number; digest: string }]>> {
  return Promise.all(
    sortedEntries(entries).map(async ([id, bytes]) => [
      id,
      { byteLength: bytes.byteLength, digest: await binaryDigest(bytes) }
    ])
  )
}

async function digestPayload(data: SerializedSceneGraph): Promise<unknown> {
  const lazy = data.lazyFigImport
  return {
    rootId: data.rootId,
    nodes: sortedEntries(data.nodes),
    images: await binaryEntries(data.images),
    variables: sortedEntries(data.variables),
    variableCollections: sortedEntries(data.variableCollections),
    activeMode: sortedEntries(data.activeMode),
    instanceIndex: sortedEntries(data.instanceIndex).map(([id, ids]) => [id, [...ids].sort()]),
    figKiwiVersion: data.figKiwiVersion,
    figSchemaDeflated: data.figSchemaDeflated
      ? {
          byteLength: data.figSchemaDeflated.byteLength,
          digest: await binaryDigest(data.figSchemaDeflated)
        }
      : null,
    figMessageObjectAnimations: data.figMessageObjectAnimations,
    documentColorSpace: data.documentColorSpace,
    lazyFigImport: lazy
      ? {
          changeMap: sortedEntries(lazy.changeMap),
          guidToNodeId: sortedEntries(lazy.guidToNodeId),
          blobs: await Promise.all(
            lazy.blobs.map(async (bytes) => ({
              byteLength: bytes.byteLength,
              digest: await binaryDigest(bytes)
            }))
          ),
          populatedRootIds: [...lazy.populatedRootIds].sort()
        }
      : null
  }
}

export async function digestDetachedGraph(
  snapshot: DetachedGraphSnapshot,
  limits: Readonly<AIShadowDraftLimits>
): Promise<string> {
  const payload = await digestPayload(snapshot.data)
  const canonicalBytes = canonicalManifestBytes(payload)
  if (canonicalBytes.byteLength > limits.maxCanonicalBytes) {
    throw new RangeError(
      `Shadow draft canonical content has ${canonicalBytes.byteLength} bytes; limit is ${limits.maxCanonicalBytes}`
    )
  }
  // Reuse the shared canonical digest implementation after enforcing its exact byte budget.
  return digestCanonicalManifest(payload)
}
