import type {
  CompilerFontManifest,
  CompilerInput,
  CompilerOptions,
  CompilerOutput
} from '@open-pencil/compiler'
import type { PortableSceneGraphData } from '@open-pencil/core'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  assertExactPrototype,
  assertUnextendedCollection,
  intrinsicMethod,
  intrinsicNumber,
  ownDataDescriptors
} from '../worker/clone-safety'
import { VUE_SOURCE_COMPILER_WORKER_LIMITS } from './limits'
import {
  arrayBufferByteLength,
  assertVueCompilerOutputWithinLimits,
  uint8ArrayBackingBuffer
} from './output'

export { VUE_SOURCE_COMPILER_WORKER_LIMITS } from './limits'
export { assertVueCompilerOutputWithinLimits } from './output'

export const VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION = 1

const MAP_SIZE_DESCRIPTOR = Object.getOwnPropertyDescriptor(Map.prototype, 'size')
const SET_SIZE_DESCRIPTOR = Object.getOwnPropertyDescriptor(Set.prototype, 'size')
const DATE_GET_TIME_DESCRIPTOR = Object.getOwnPropertyDescriptor(Date.prototype, 'getTime')
const MAP_ENTRIES_DESCRIPTOR = Object.getOwnPropertyDescriptor(Map.prototype, 'entries')
const SET_VALUES_DESCRIPTOR = Object.getOwnPropertyDescriptor(Set.prototype, 'values')

export type VueCompilerGraphSnapshot = PortableSceneGraphData

export interface VueSourceCompilerWorkerRequest {
  version: typeof VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
  type: 'compile-vue'
  requestId: string
  graph: VueCompilerGraphSnapshot
  pageIds: string[]
  options: CompilerOptions
  fontManifest?: CompilerFontManifest
}

export type VueSourceCompilerWorkerResponse =
  | {
      version: typeof VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
      type: 'result'
      requestId: string
      output: CompilerOutput
    }
  | {
      version: typeof VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
      type: 'error'
      requestId: string
      error: string
    }

interface CloneMeasurement {
  bytes: number
  values: number
}

function addCloneBytes(measurement: CloneMeasurement, bytes: number, maximum: number): void {
  measurement.bytes += bytes
  if (measurement.bytes > maximum) {
    throw new Error(`Vue compiler Worker input exceeds ${maximum} bytes`)
  }
}

function measureCloneScalar(
  value: unknown,
  measurement: CloneMeasurement,
  maximum: number
): boolean {
  if (value === null || value === undefined) {
    addCloneBytes(measurement, 4, maximum)
    return true
  }
  switch (typeof value) {
    case 'boolean':
      addCloneBytes(measurement, 4, maximum)
      return true
    case 'number':
    case 'bigint':
      addCloneBytes(measurement, 8, maximum)
      return true
    case 'string':
      addCloneBytes(measurement, 16 + value.length * 2, maximum)
      return true
    case 'function':
    case 'symbol':
      throw new TypeError('Vue compiler Worker input must be structured-cloneable')
    case 'object':
      return false
  }
  return false
}

function measureCloneArray(
  value: unknown[],
  pending: unknown[],
  measurement: CloneMeasurement,
  maximum: number
): void {
  assertExactPrototype(value, Array.prototype, 'array')
  const descriptors = ownDataDescriptors(value, 'array')
  const length = descriptors.length.value
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new TypeError('Vue compiler Worker input array length is invalid')
  }
  addCloneBytes(measurement, 24 + length * 8, maximum)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === 'length' || !descriptor.enumerable) continue
    addCloneBytes(measurement, 16 + key.length * 2, maximum)
    pending.push(descriptor.value)
  }
}

function measureCloneCollection(
  value: object,
  pending: unknown[],
  seen: WeakSet<object>,
  measurement: CloneMeasurement,
  maximum: number
): boolean {
  if (value instanceof ArrayBuffer) {
    assertExactPrototype(value, ArrayBuffer.prototype, 'ArrayBuffer')
    assertUnextendedCollection(value, 'ArrayBuffer')
    addCloneBytes(measurement, 32 + arrayBufferByteLength(value), maximum)
    return true
  }
  if (value instanceof Uint8Array) {
    const backing = uint8ArrayBackingBuffer(value)
    // structured clone copies the complete backing ArrayBuffer even when the
    // Uint8Array is a tiny slice. Count shared backings once, like the clone.
    if (seen.has(backing)) addCloneBytes(measurement, 8, maximum)
    else {
      seen.add(backing)
      addCloneBytes(measurement, 32 + arrayBufferByteLength(backing), maximum)
    }
    return true
  }
  if (ArrayBuffer.isView(value)) {
    throw new TypeError('Vue compiler Worker input contains an unsupported binary view')
  }
  if (value instanceof Date) {
    assertExactPrototype(value, Date.prototype, 'Date')
    assertUnextendedCollection(value, 'Date')
    intrinsicMethod(DATE_GET_TIME_DESCRIPTOR, value)
    addCloneBytes(measurement, 16, maximum)
    return true
  }
  if (Array.isArray(value)) {
    measureCloneArray(value, pending, measurement, maximum)
    return true
  }
  if (value instanceof Map) {
    assertExactPrototype(value, Map.prototype, 'Map')
    assertUnextendedCollection(value, 'Map')
    const size = intrinsicNumber(MAP_SIZE_DESCRIPTOR, value)
    addCloneBytes(measurement, 32 + size * 16, maximum)
    const entries = intrinsicMethod(MAP_ENTRIES_DESCRIPTOR, value) as Iterable<[unknown, unknown]>
    for (const [key, entry] of entries) {
      pending.push(key, entry)
    }
    return true
  }
  if (value instanceof Set) {
    assertExactPrototype(value, Set.prototype, 'Set')
    assertUnextendedCollection(value, 'Set')
    const size = intrinsicNumber(SET_SIZE_DESCRIPTOR, value)
    addCloneBytes(measurement, 32 + size * 8, maximum)
    const entries = intrinsicMethod(SET_VALUES_DESCRIPTOR, value) as Iterable<unknown>
    for (const entry of entries) pending.push(entry)
    return true
  }
  return false
}

function measureCloneRecord(
  value: object,
  pending: unknown[],
  measurement: CloneMeasurement,
  maximum: number
): void {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Vue compiler Worker input must contain only plain records')
  }
  const descriptors = ownDataDescriptors(value, 'record')
  const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable)
  addCloneBytes(measurement, 32 + entries.length * 16, maximum)
  for (const [key, descriptor] of entries) {
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid record descriptor')
    addCloneBytes(measurement, 16 + key.length * 2, maximum)
    pending.push(descriptor.value)
  }
}

function estimateCloneBytes(value: unknown, maximum: number): number {
  const measurement: CloneMeasurement = { bytes: 0, values: 0 }
  const seen = new WeakSet<object>()
  const pending: unknown[] = [value]

  while (pending.length > 0) {
    measurement.values += 1
    if (measurement.values > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxTraversedValues) {
      throw new Error('Vue compiler Worker input exceeds its traversal limit')
    }
    const current = pending.pop()
    if (measureCloneScalar(current, measurement, maximum)) continue

    // Scalar handling above proves this is a non-null object.
    const object = current as object
    if (seen.has(object)) {
      addCloneBytes(measurement, 8, maximum)
      continue
    }
    seen.add(object)
    if (measureCloneCollection(object, pending, seen, measurement, maximum)) continue
    measureCloneRecord(object, pending, measurement, maximum)
  }

  return measurement.bytes
}

function requestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasSnapshotCollections(value: unknown): value is VueCompilerGraphSnapshot {
  if (!isRecord(value)) return false
  return (
    typeof value.rootId === 'string' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.images) &&
    Array.isArray(value.variables) &&
    Array.isArray(value.variableCollections) &&
    Array.isArray(value.activeMode)
  )
}

function validNodeEntry(entry: unknown): entry is [string, SceneNode] {
  return (
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'string' &&
    entry[1] !== null &&
    typeof entry[1] === 'object'
  )
}

function validImageEntry(entry: unknown): entry is [string, Uint8Array] {
  return (
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'string' &&
    entry[1] instanceof Uint8Array
  )
}

function validVueRequestEnvelope(
  value: Record<string, unknown>
): value is Record<string, unknown> & VueSourceCompilerWorkerRequest {
  if (!hasSnapshotCollections(value.graph) || !isRecord(value.options)) return false
  return (
    value.version === VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION &&
    value.type === 'compile-vue' &&
    requestId(value.requestId) &&
    Array.isArray(value.pageIds) &&
    value.pageIds.length > 0 &&
    value.pageIds.every((pageId) => typeof pageId === 'string') &&
    value.options.target === 'vue' &&
    (value.options.router === 'none' || value.options.router === 'vue-router-v4')
  )
}

function graphSnapshot(graph: SceneGraph): VueCompilerGraphSnapshot {
  if (graph.nodes.size > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxNodes) {
    throw new Error(
      `Vue compiler Worker input exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxNodes} nodes`
    )
  }
  if (graph.images.size > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxImages) {
    throw new Error(
      `Vue compiler Worker input exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxImages} images`
    )
  }
  return {
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    images: [...graph.images],
    nodes: [...graph.nodes],
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables]
  }
}

export function createVueSourceCompilerWorkerRequest(
  input: CompilerInput,
  requestIdValue: string
): VueSourceCompilerWorkerRequest {
  if (!requestId(requestIdValue)) throw new TypeError('Vue compiler Worker request id is invalid')
  if (input.options.target !== 'vue') {
    throw new TypeError('Vue compiler Worker accepts only the Vue compiler target')
  }
  if (input.options.router !== 'none' && input.options.router !== 'vue-router-v4') {
    throw new TypeError('Vue compiler Worker accepts only the Vue Router v4 strategy')
  }
  const request: VueSourceCompilerWorkerRequest = {
    version: VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'compile-vue',
    requestId: requestIdValue,
    graph: graphSnapshot(input.graph),
    pageIds: [...input.pageIds],
    options: input.options,
    fontManifest: input.fontManifest
  }
  validateVueSourceCompilerWorkerRequest(request)
  return request
}

export function validateVueSourceCompilerWorkerRequest(
  value: unknown
): asserts value is VueSourceCompilerWorkerRequest {
  if (!isRecord(value) || !validVueRequestEnvelope(value)) {
    throw new TypeError('Vue compiler Worker request is invalid')
  }
  const request = value
  if (request.graph.nodes.length > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxNodes) {
    throw new Error(
      `Vue compiler Worker input exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxNodes} nodes`
    )
  }
  if (request.graph.images.length > VUE_SOURCE_COMPILER_WORKER_LIMITS.maxImages) {
    throw new Error(
      `Vue compiler Worker input exceeds ${VUE_SOURCE_COMPILER_WORKER_LIMITS.maxImages} images`
    )
  }
  if (
    request.graph.nodes.some((entry) => !validNodeEntry(entry)) ||
    request.graph.images.some((entry) => !validImageEntry(entry))
  ) {
    throw new TypeError('Vue compiler Worker graph snapshot is invalid')
  }
  const nodeIds = new Set(request.graph.nodes.map(([id]) => id))
  if (
    typeof request.graph.rootId !== 'string' ||
    !nodeIds.has(request.graph.rootId) ||
    request.pageIds.some((pageId) => !nodeIds.has(pageId))
  ) {
    throw new TypeError('Vue compiler Worker graph snapshot is incomplete')
  }
  estimateCloneBytes(request, VUE_SOURCE_COMPILER_WORKER_LIMITS.maxSnapshotBytes)
}

export function restoreVueCompilerGraph(snapshot: VueCompilerGraphSnapshot): SceneGraph {
  const graph = new SceneGraph()
  graph.nodes = new Map(snapshot.nodes)
  graph.images = new Map(snapshot.images)
  graph.variables = new Map(snapshot.variables)
  graph.variableCollections = new Map(snapshot.variableCollections)
  graph.activeMode = new Map(snapshot.activeMode)
  graph.rootId = snapshot.rootId
  graph.documentColorSpace = snapshot.documentColorSpace
  graph.instanceIndex = new Map()
  for (const node of graph.nodes.values()) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    const instances = graph.instanceIndex.get(node.componentId) ?? new Set<string>()
    instances.add(node.id)
    graph.instanceIndex.set(node.componentId, instances)
  }
  graph.clearAbsPosCache()
  return graph
}

export function parseVueSourceCompilerWorkerResponse(
  value: unknown,
  expectedRequestId: string
): VueSourceCompilerWorkerResponse | null {
  if (value === null || typeof value !== 'object') return null
  const response = value as Partial<VueSourceCompilerWorkerResponse>
  if (
    response.version !== VUE_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION ||
    response.requestId !== expectedRequestId
  ) {
    return null
  }
  if (
    response.type === 'error' &&
    typeof response.error === 'string' &&
    response.error.length <= 2_048
  ) {
    return response as VueSourceCompilerWorkerResponse
  }
  if (response.type !== 'result' || !response.output) return null
  assertVueCompilerOutputWithinLimits(response.output)
  return response as VueSourceCompilerWorkerResponse
}
