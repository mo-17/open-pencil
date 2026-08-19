import type {
  CompilerInput,
  CompilerOptions,
  CompilerOutput,
  CompilerRouter,
  MiniProgramCompilerTarget
} from '@open-pencil/compiler'
import type { PortableSceneGraphData } from '@open-pencil/core/io/formats/fig'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { assertVueCompilerOutputWithinLimits } from '@/app/plugins/host/vue/compiler/output'
import {
  createVueCompilerGraphSnapshot,
  estimateVueSourceWorkerCloneBytes,
  restoreVueCompilerGraph
} from '@/app/plugins/host/vue/compiler/protocol'
import {
  assertExactPrototype,
  assertUnextendedCollection,
  ownDataDescriptors
} from '@/app/plugins/host/vue/worker/clone-safety'

import {
  assertMiniProgramCompilerOutputSafe,
  assertMiniProgramWorkerDiagnosticSafe
} from '../artifact-security'
import { MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS } from './limits'
import {
  MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  MINIPROGRAM_SOURCE_COMPILER_WORKER_STAGES,
  type MiniProgramSourceCompilerWorkerStage
} from './worker-bootstrap-protocol'

export { MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS } from './limits'
export {
  MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
  MINIPROGRAM_SOURCE_COMPILER_WORKER_STAGES,
  type MiniProgramSourceCompilerWorkerStage
} from './worker-bootstrap-protocol'

export type MiniProgramCompilerGraphSnapshot = PortableSceneGraphData

export interface MiniProgramSourceCompilerWorkerRequest {
  version: typeof MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
  type: 'compile-miniprogram-source'
  requestId: string
  graph: MiniProgramCompilerGraphSnapshot
  pageIds: string[]
  options: CompilerOptions
}

export type MiniProgramSourceCompilerWorkerResponse =
  | {
      version: typeof MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
      type: 'progress'
      requestId: string
      stage: MiniProgramSourceCompilerWorkerStage
      elapsedMs: number
    }
  | {
      version: typeof MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
      type: 'result'
      requestId: string
      output: CompilerOutput
    }
  | {
      version: typeof MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION
      type: 'error'
      requestId: string
      error: string
    }

const REQUEST_KEYS = Object.freeze([
  'version',
  'type',
  'requestId',
  'graph',
  'pageIds',
  'options'
] as const)
const GRAPH_KEYS = Object.freeze([
  'activeMode',
  'documentColorSpace',
  'images',
  'nodes',
  'rootId',
  'variableCollections',
  'variables'
] as const)
const OPTION_KEYS = Object.freeze([
  'packageName',
  'productName',
  'target',
  'reactVersion',
  'router',
  'typescript',
  'devMode',
  'i18n'
] as const)
const OUTPUT_KEYS = Object.freeze(['files', 'warnings'] as const)
const WARNING_KEYS = Object.freeze(['code', 'message', 'nodeId'] as const)
const WORKER_STAGES = new Set<string>(MINIPROGRAM_SOURCE_COMPILER_WORKER_STAGES)

const TARGET_ROUTERS: Readonly<Record<MiniProgramCompilerTarget, CompilerRouter>> = Object.freeze({
  'wechat-miniprogram': 'wechat-native',
  taro: 'taro-router',
  'uni-app': 'uni-pages',
  mpx: 'mpx-router'
})

interface MiniProgramWorkerRecord {
  [key: string]: unknown
}

function requestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
}

function record(value: unknown, label: string): MiniProgramWorkerRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a record`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use a plain prototype`)
  }
  ownDataDescriptors(value, label)
  return value as MiniProgramWorkerRecord
}

function exactKeys(
  value: MiniProgramWorkerRecord,
  allowed: readonly string[],
  label: string
): void {
  const descriptors = ownDataDescriptors(value, label)
  const keys = Object.keys(descriptors)
  if (
    keys.length !== allowed.length ||
    keys.some((key) => !allowed.includes(key) || descriptors[key]?.enumerable !== true)
  ) {
    throw new TypeError(`${label} contains unexpected fields`)
  }
}

function hasExactKeys(
  value: MiniProgramWorkerRecord,
  allowed: readonly string[],
  label: string
): boolean {
  const descriptors = ownDataDescriptors(value, label)
  const keys = Object.keys(descriptors)
  return (
    keys.length === allowed.length &&
    keys.every((key) => allowed.includes(key) && descriptors[key]?.enumerable === true)
  )
}

function allowedKeys(
  value: MiniProgramWorkerRecord,
  allowed: readonly string[],
  label: string
): void {
  const descriptors = ownDataDescriptors(value, label)
  if (
    Object.keys(descriptors).some(
      (key) => !allowed.includes(key) || descriptors[key]?.enumerable !== true
    )
  ) {
    throw new TypeError(`${label} contains unexpected fields`)
  }
}

function miniProgramTarget(value: unknown): value is MiniProgramCompilerTarget {
  return (
    value === 'wechat-miniprogram' || value === 'taro' || value === 'uni-app' || value === 'mpx'
  )
}

function validOptions(value: unknown): value is CompilerOptions {
  const options = record(value, 'Mini-program compiler Worker options')
  allowedKeys(options, OPTION_KEYS, 'Mini-program compiler Worker options')
  if (!miniProgramTarget(options.target)) return false
  const expectedRouter = TARGET_ROUTERS[options.target]
  const productName = options.productName
  return (
    typeof options.packageName === 'string' &&
    /^[a-z0-9][a-z0-9._-]{0,127}$/.test(options.packageName) &&
    (productName === undefined ||
      (typeof productName === 'string' &&
        productName.length > 0 &&
        productName.length <= 128 &&
        !/[\p{Cc}\p{Cf}]/u.test(productName))) &&
    (options.reactVersion === '18' || options.reactVersion === '19') &&
    options.router === expectedRouter &&
    options.typescript === true &&
    options.devMode === false &&
    (options.i18n === false || options.i18n === undefined)
  )
}

function validNodeEntry(entry: unknown): entry is [string, SceneNode] {
  if (!Array.isArray(entry) || entry.length !== 2) return false
  const [id, node] = entry
  if (typeof id !== 'string' || id.length === 0) return false
  return node !== null && typeof node === 'object'
}

function validImageEntry(entry: unknown): entry is [string, Uint8Array] {
  if (!Array.isArray(entry) || entry.length !== 2) return false
  const [hash, bytes] = entry
  return typeof hash === 'string' && hash.length > 0 && bytes instanceof Uint8Array
}

function validateGraph(value: unknown): asserts value is MiniProgramCompilerGraphSnapshot {
  const graph = record(value, 'Mini-program compiler Worker graph')
  exactKeys(graph, GRAPH_KEYS, 'Mini-program compiler Worker graph')
  if (
    typeof graph.rootId !== 'string' ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.images) ||
    !Array.isArray(graph.variables) ||
    !Array.isArray(graph.variableCollections) ||
    !Array.isArray(graph.activeMode)
  ) {
    throw new TypeError('Mini-program compiler Worker graph snapshot is invalid')
  }
  if (graph.nodes.length > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxNodes) {
    throw new Error(
      `Mini-program compiler Worker input exceeds ${MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxNodes} nodes`
    )
  }
  if (graph.images.length > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxImages) {
    throw new Error(
      `Mini-program compiler Worker input exceeds ${MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxImages} images`
    )
  }
  if (graph.nodes.some((entry) => !validNodeEntry(entry))) {
    throw new TypeError('Mini-program compiler Worker graph contains an invalid node')
  }
  if (graph.images.some((entry) => !validImageEntry(entry))) {
    throw new TypeError('Mini-program compiler Worker graph contains an invalid image')
  }
  const nodeIds = new Set(graph.nodes.map(([id]) => id))
  if (nodeIds.size !== graph.nodes.length || !nodeIds.has(graph.rootId)) {
    throw new TypeError('Mini-program compiler Worker graph node identities are invalid')
  }
  const imageIds = new Set(graph.images.map(([id]) => id))
  if (imageIds.size !== graph.images.length) {
    throw new TypeError('Mini-program compiler Worker graph image identities are invalid')
  }
}

function validatePageIds(
  value: unknown,
  nodes: ReadonlyMap<string, SceneNode>,
  rootId: string
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxPageIds ||
    value.some((pageId) => {
      if (typeof pageId !== 'string') return true
      const page = nodes.get(pageId)
      return page?.type !== 'CANVAS' || page.parentId !== rootId || Boolean(page.internalOnly)
    }) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError('Mini-program compiler Worker page ids are invalid')
  }
}

export function createMiniProgramSourceCompilerWorkerRequest(
  input: CompilerInput,
  requestIdValue: string
): MiniProgramSourceCompilerWorkerRequest {
  if (!requestId(requestIdValue)) {
    throw new TypeError('Mini-program compiler Worker request id is invalid')
  }
  if (!miniProgramTarget(input.options.target)) {
    throw new TypeError('Mini-program compiler Worker accepts only mini-program targets')
  }
  const request: MiniProgramSourceCompilerWorkerRequest = {
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'compile-miniprogram-source',
    requestId: requestIdValue,
    graph: createVueCompilerGraphSnapshot(input.graph),
    pageIds: [...input.pageIds],
    options: input.options
  }
  validateMiniProgramSourceCompilerWorkerRequest(request)
  return request
}

export function validateMiniProgramSourceCompilerWorkerRequest(
  value: unknown
): asserts value is MiniProgramSourceCompilerWorkerRequest {
  const request = record(value, 'Mini-program compiler Worker request')
  exactKeys(request, REQUEST_KEYS, 'Mini-program compiler Worker request')
  if (
    request.version !== MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION ||
    request.type !== 'compile-miniprogram-source' ||
    !requestId(request.requestId) ||
    !validOptions(request.options)
  ) {
    throw new TypeError('Mini-program compiler Worker request is invalid')
  }
  validateGraph(request.graph)
  const graph = request.graph
  validatePageIds(request.pageIds, new Map(graph.nodes), graph.rootId)
  estimateVueSourceWorkerCloneBytes(
    request,
    MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxSnapshotBytes
  )
}

export function restoreMiniProgramCompilerGraph(
  snapshot: MiniProgramCompilerGraphSnapshot
): SceneGraph {
  validateGraph(snapshot)
  return restoreVueCompilerGraph(snapshot)
}

function validateWarning(value: unknown): void {
  const warning = record(value, 'Mini-program compiler Worker warning')
  allowedKeys(warning, WARNING_KEYS, 'Mini-program compiler Worker warning')
  if (
    !Object.hasOwn(warning, 'code') ||
    !Object.hasOwn(warning, 'message') ||
    typeof warning.code !== 'string' ||
    typeof warning.message !== 'string' ||
    (warning.nodeId !== undefined && typeof warning.nodeId !== 'string')
  ) {
    throw new TypeError('Mini-program compiler Worker warning is invalid')
  }
}

function validateWarnings(value: unknown): asserts value is CompilerOutput['warnings'] {
  if (!Array.isArray(value)) {
    throw new TypeError('Mini-program compiler Worker warnings are invalid')
  }
  assertExactPrototype(value, Array.prototype, 'mini-program warning array')
  const descriptors = ownDataDescriptors(value, 'Mini-program compiler Worker warning array')
  const keys = Object.keys(descriptors)
  if (
    value.length > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxWarnings ||
    keys.length !== value.length + 1 ||
    !Object.hasOwn(descriptors, 'length') ||
    keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key))
  ) {
    throw new TypeError('Mini-program compiler Worker warning array is invalid')
  }
  for (const warning of value) validateWarning(warning)
}

function validateOutputShape(value: unknown): asserts value is CompilerOutput {
  const output = record(value, 'Mini-program compiler Worker output')
  exactKeys(output, OUTPUT_KEYS, 'Mini-program compiler Worker output')
  if (!(output.files instanceof Map)) {
    throw new TypeError('Mini-program compiler Worker output files are invalid')
  }
  assertExactPrototype(output.files, Map.prototype, 'mini-program output file map')
  assertUnextendedCollection(output.files, 'mini-program output file map')
  validateWarnings(output.warnings)
}

export function assertMiniProgramCompilerOutputWithinLimits(output: CompilerOutput): void {
  validateOutputShape(output)
  assertVueCompilerOutputWithinLimits(output)
  if (
    output.files.size > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxOutputFiles ||
    output.warnings.length > MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxWarnings
  ) {
    throw new Error('Mini-program compiler Worker output exceeds its collection limit')
  }
  estimateVueSourceWorkerCloneBytes(
    output,
    MINIPROGRAM_SOURCE_COMPILER_WORKER_LIMITS.maxOutputBytes
  )
}

export function assertMiniProgramCompilerOutputForTransfer(output: CompilerOutput): void {
  assertMiniProgramCompilerOutputWithinLimits(output)
  assertMiniProgramCompilerOutputSafe(output)
}

function parseWorkerErrorResponse(
  response: MiniProgramWorkerRecord,
  requestIdValue: string
): MiniProgramSourceCompilerWorkerResponse | null {
  if (
    !hasExactKeys(
      response,
      ['version', 'type', 'requestId', 'error'],
      'Mini-program compiler Worker error response'
    )
  ) {
    return null
  }
  const error = Object.getOwnPropertyDescriptor(response, 'error')?.value
  if (typeof error !== 'string' || error.length > 2_048) return null
  assertMiniProgramWorkerDiagnosticSafe(error)
  return {
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'error',
    requestId: requestIdValue,
    error
  }
}

function parseWorkerProgressResponse(
  response: MiniProgramWorkerRecord,
  requestIdValue: string
): MiniProgramSourceCompilerWorkerResponse | null {
  if (
    !hasExactKeys(
      response,
      ['version', 'type', 'requestId', 'stage', 'elapsedMs'],
      'Mini-program compiler Worker progress response'
    )
  ) {
    return null
  }
  const stage = Object.getOwnPropertyDescriptor(response, 'stage')?.value
  const elapsedMs = Object.getOwnPropertyDescriptor(response, 'elapsedMs')?.value
  if (
    typeof stage !== 'string' ||
    !WORKER_STAGES.has(stage) ||
    typeof elapsedMs !== 'number' ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0
  ) {
    throw new TypeError('Mini-program compiler Worker progress is invalid')
  }
  return {
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'progress',
    requestId: requestIdValue,
    stage: stage as MiniProgramSourceCompilerWorkerStage,
    elapsedMs
  }
}

function parseWorkerResultResponse(
  response: MiniProgramWorkerRecord,
  requestIdValue: string
): MiniProgramSourceCompilerWorkerResponse | null {
  if (
    !hasExactKeys(
      response,
      ['version', 'type', 'requestId', 'output'],
      'Mini-program compiler Worker result response'
    )
  ) {
    return null
  }
  const output = Object.getOwnPropertyDescriptor(response, 'output')?.value
  if (!output) return null
  assertMiniProgramCompilerOutputForTransfer(output as CompilerOutput)
  return {
    version: MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION,
    type: 'result',
    requestId: requestIdValue,
    output: output as CompilerOutput
  }
}

export function parseMiniProgramSourceCompilerWorkerResponse(
  value: unknown,
  expectedRequestId: string
): MiniProgramSourceCompilerWorkerResponse | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const version = Object.getOwnPropertyDescriptor(value, 'version')?.value
  const correlatedRequestId = Object.getOwnPropertyDescriptor(value, 'requestId')?.value
  if (
    version !== MINIPROGRAM_SOURCE_COMPILER_WORKER_PROTOCOL_VERSION ||
    correlatedRequestId !== expectedRequestId
  ) {
    return null
  }
  const response = record(value, 'Mini-program compiler Worker response')
  const responseType = Object.getOwnPropertyDescriptor(response, 'type')?.value
  if (responseType === 'error') return parseWorkerErrorResponse(response, expectedRequestId)
  if (responseType === 'progress') return parseWorkerProgressResponse(response, expectedRequestId)
  if (responseType === 'result') return parseWorkerResultResponse(response, expectedRequestId)
  return null
}
