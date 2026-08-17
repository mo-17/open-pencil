/* oxlint-disable eslint/max-lines -- One strict protocol validator keeps the complete clone and response trust boundary auditable. */

import type { CompilerOptions } from '@open-pencil/compiler'
import type { PortableSceneGraphData } from '@open-pencil/core/io/formats/fig'
import type {
  DocumentColorSpace,
  SceneGraph,
  SceneNode,
  Variable,
  VariableCollection
} from '@open-pencil/scene-graph'

import {
  createVueCompilerGraphSnapshot,
  estimateVueSourceWorkerCloneBytes
} from '@/app/plugins/host/vue/compiler/protocol'
import {
  assertExactPrototype,
  ownDataDescriptors
} from '@/app/plugins/host/vue/worker/clone-safety'

import type { PreviewDiagnostic, PreviewHostBuildMetrics } from '../host/types'
import { BROWSER_PREVIEW_WORKER_LIMITS } from './limits'
import {
  BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
  BROWSER_PREVIEW_WORKER_STAGES,
  type BrowserPreviewWorkerStage
} from './worker-bootstrap-protocol'

export {
  BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
  BROWSER_PREVIEW_WORKER_STAGES,
  type BrowserPreviewWorkerStage
} from './worker-bootstrap-protocol'
export const BROWSER_PREVIEW_FONT_PROVIDER_IDS = [
  'google',
  'fontsource',
  'bunny',
  'fontshare'
] as const
export type BrowserPreviewFontProvider = (typeof BROWSER_PREVIEW_FONT_PROVIDER_IDS)[number]
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const GRAPH_KEYS = new Set([
  'rootId',
  'nodes',
  'images',
  'variables',
  'variableCollections',
  'activeMode',
  'documentColorSpace'
])
const REQUEST_KEYS = new Set([
  'version',
  'type',
  'requestId',
  'generation',
  'channelId',
  'graph',
  'pageIds',
  'options',
  'fontProviders',
  'refreshFonts'
])
const FONT_PROVIDER_IDS = new Set<string>(BROWSER_PREVIEW_FONT_PROVIDER_IDS)
const WORKER_STAGES = new Set<string>(BROWSER_PREVIEW_WORKER_STAGES)
const OPTION_KEYS = new Set([
  'packageName',
  'target',
  'reactVersion',
  'router',
  'typescript',
  'devMode',
  'i18n',
  'locales',
  'uiKit'
])
const DIAGNOSTIC_KEYS = new Set(['code', 'severity', 'message', 'nodeId', 'path', 'line', 'column'])
const METRIC_KEYS = new Set([
  'compileMs',
  'bundleMs',
  'totalMs',
  'inputBytes',
  'outputBytes',
  'fileCount',
  'dependencyCount'
])
export type BrowserPreviewGraphSnapshot = PortableSceneGraphData
export interface BrowserPreviewWorkerRequest {
  version: typeof BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION
  type: 'build-browser-preview'
  requestId: string
  generation: number
  channelId: string
  graph: BrowserPreviewGraphSnapshot
  pageIds: string[]
  options: CompilerOptions
  fontProviders: BrowserPreviewFontProvider[]
  refreshFonts: boolean
}
interface BrowserPreviewWorkerResultBase {
  diagnostics: PreviewDiagnostic[]
  metrics: PreviewHostBuildMetrics
}
export type BrowserPreviewWorkerBuildResult =
  | (BrowserPreviewWorkerResultBase & { status: 'ready'; html: string })
  | (BrowserPreviewWorkerResultBase & { status: 'error' })
  | (BrowserPreviewWorkerResultBase & { status: 'unsupported'; reason: string })
export type BrowserPreviewWorkerResponse =
  | {
      version: typeof BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION
      type: 'progress'
      requestId: string
      generation: number
      stage: BrowserPreviewWorkerStage
      elapsedMs: number
    }
  | {
      version: typeof BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION
      type: 'result'
      requestId: string
      generation: number
      result: BrowserPreviewWorkerBuildResult
    }
  | {
      version: typeof BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION
      type: 'error'
      requestId: string
      generation: number
      error: string
    }
export interface CreateBrowserPreviewWorkerRequestInput {
  generation: number
  graph: SceneGraph
  pageIds: string[]
  options: CompilerOptions
  fontProviders: BrowserPreviewFontProvider[]
  refreshFonts: boolean
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isSceneNodeRecord(value: unknown, id: string): value is SceneNode {
  return isRecord(value) && Object.getOwnPropertyDescriptor(value, 'id')?.value === id
}
function isVariableRecord(value: unknown, id: string): value is Variable {
  return isRecord(value) && Object.getOwnPropertyDescriptor(value, 'id')?.value === id
}
function isVariableCollectionRecord(value: unknown, id: string): value is VariableCollection {
  return isRecord(value) && Object.getOwnPropertyDescriptor(value, 'id')?.value === id
}
function exactRecord(
  value: unknown,
  keys: ReadonlySet<string>,
  required: readonly string[],
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record`)
  }
  const descriptors = ownDataDescriptors(value, label)
  const names = Object.keys(descriptors)
  if (
    names.some((key) => !keys.has(key)) ||
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    names.some((key) => descriptors[key]?.enumerable !== true)
  ) {
    throw new TypeError(`${label} fields are invalid`)
  }
  return Object.fromEntries(names.map((key) => [key, descriptors[key]?.value]))
}
function boundedId(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}
function validGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
function parseTupleArray<T>(
  value: unknown,
  label: string,
  parse: (key: string, item: unknown) => T
): Array<[string, T]> {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  assertExactPrototype(value, Array.prototype, label)
  const result: Array<[string, T]> = []
  const keys = new Set<string>()
  for (const candidate of value) {
    if (!Array.isArray(candidate) || candidate.length !== 2 || typeof candidate[0] !== 'string') {
      throw new TypeError(`${label} contains an invalid entry`)
    }
    if (keys.has(candidate[0])) {
      throw new TypeError(`${label} contains a duplicate key`)
    }
    keys.add(candidate[0])
    result.push([candidate[0], parse(candidate[0], candidate[1])])
  }
  return result
}
function validateGraphSnapshot(
  value: unknown,
  pageIds: readonly string[]
): BrowserPreviewGraphSnapshot {
  const graph = exactRecord(
    value,
    GRAPH_KEYS,
    [...GRAPH_KEYS],
    'Browser preview Worker graph snapshot'
  )
  if (
    typeof graph.rootId !== 'string' ||
    (graph.documentColorSpace !== 'srgb' && graph.documentColorSpace !== 'display-p3')
  ) {
    throw new TypeError('Browser preview Worker graph identity is invalid')
  }
  const nodes = parseTupleArray(graph.nodes, 'Browser preview Worker nodes', (key, node) => {
    if (!isSceneNodeRecord(node, key)) {
      throw new TypeError('Browser preview Worker nodes contains an invalid node')
    }
    return node
  })
  const images = parseTupleArray(graph.images, 'Browser preview Worker images', (_key, image) => {
    if (!(image instanceof Uint8Array)) {
      throw new TypeError('Browser preview Worker images contains invalid bytes')
    }
    return image
  })
  const variables = parseTupleArray(
    graph.variables,
    'Browser preview Worker variables',
    (key, variable) => {
      if (!isVariableRecord(variable, key)) {
        throw new TypeError('Browser preview Worker variables contains an invalid variable')
      }
      return variable
    }
  )
  const variableCollections = parseTupleArray(
    graph.variableCollections,
    'Browser preview Worker variable collections',
    (key, collection) => {
      if (!isVariableCollectionRecord(collection, key)) {
        throw new TypeError(
          'Browser preview Worker variable collections contains an invalid collection'
        )
      }
      return collection
    }
  )
  const activeMode = parseTupleArray(
    graph.activeMode,
    'Browser preview Worker active modes',
    (_key, mode) => {
      if (typeof mode !== 'string') {
        throw new TypeError('Browser preview Worker active modes contains an invalid mode')
      }
      return mode
    }
  )
  if (nodes.length > BROWSER_PREVIEW_WORKER_LIMITS.maxNodes) {
    throw new Error(
      `Browser preview Worker input exceeds ${BROWSER_PREVIEW_WORKER_LIMITS.maxNodes} nodes`
    )
  }
  if (images.length > BROWSER_PREVIEW_WORKER_LIMITS.maxImages) {
    throw new Error(
      `Browser preview Worker input exceeds ${BROWSER_PREVIEW_WORKER_LIMITS.maxImages} images`
    )
  }
  const nodeIds = new Set(nodes.map(([id]) => id))
  if (
    nodeIds.size !== nodes.length ||
    !nodeIds.has(graph.rootId) ||
    pageIds.some((pageId) => !nodeIds.has(pageId))
  ) {
    throw new TypeError('Browser preview Worker graph snapshot is incomplete')
  }
  return {
    rootId: graph.rootId,
    nodes,
    images,
    variables,
    variableCollections,
    activeMode,
    documentColorSpace: graph.documentColorSpace as DocumentColorSpace
  }
}
function validatePageIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > BROWSER_PREVIEW_WORKER_LIMITS.maxPageIds ||
    value.some(
      (pageId) =>
        typeof pageId !== 'string' ||
        pageId.length === 0 ||
        pageId.length > BROWSER_PREVIEW_WORKER_LIMITS.maxPageIdLength
    )
  ) {
    throw new TypeError('Browser preview Worker page ids are invalid')
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError('Browser preview Worker page ids must be unique')
  }
  return value as string[]
}
function validateFontProviders(value: unknown): BrowserPreviewFontProvider[] {
  if (!Array.isArray(value) || value.length > BROWSER_PREVIEW_FONT_PROVIDER_IDS.length) {
    throw new TypeError('Browser preview Worker font providers are invalid')
  }
  assertExactPrototype(value, Array.prototype, 'Browser preview Worker font providers')
  if (value.some((provider) => typeof provider !== 'string' || !FONT_PROVIDER_IDS.has(provider))) {
    throw new TypeError('Browser preview Worker font providers are invalid')
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError('Browser preview Worker font providers must be unique')
  }
  return value as BrowserPreviewFontProvider[]
}
function validateLocales(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError('Browser preview Worker locales are invalid')
  }
  const locales: string[] = []
  for (const locale of value) {
    if (
      typeof locale !== 'string' ||
      locale.length === 0 ||
      locale.length > 35 ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)
    ) {
      throw new TypeError('Browser preview Worker locales are invalid')
    }
    locales.push(locale)
  }
  if (new Set(locales).size !== locales.length) {
    throw new TypeError('Browser preview Worker locales must be unique')
  }
  return locales
}
function invalidBrowserOptions(): never {
  throw new TypeError('Browser preview Worker accepts only dev-mode React or Vue web targets')
}
function browserTarget(value: unknown): 'react' | 'vue' {
  if (value !== 'react' && value !== 'vue') invalidBrowserOptions()
  return value
}
function browserReactVersion(value: unknown): '18' | '19' {
  if (value !== '18' && value !== '19') invalidBrowserOptions()
  return value
}
function browserRouter(target: 'react' | 'vue', value: unknown): CompilerOptions['router'] {
  if (target === 'react' && (value === 'none' || value === 'react-router-v6')) return value
  if (target === 'vue' && (value === 'none' || value === 'vue-router-v4')) return value
  return invalidBrowserOptions()
}
function browserUIKit(value: unknown): 'shadcn' | undefined {
  if (value === undefined || value === 'shadcn') return value
  return invalidBrowserOptions()
}
function browserI18n(value: unknown): boolean {
  if (typeof value !== 'boolean') invalidBrowserOptions()
  return value
}
function validateOptions(value: unknown): CompilerOptions {
  const options = exactRecord(
    value,
    OPTION_KEYS,
    ['packageName', 'target', 'reactVersion', 'router', 'typescript', 'devMode', 'i18n'],
    'Browser preview Worker options'
  )
  const locales = validateLocales(options.locales)
  if (options.packageName !== 'openpencil-preview') invalidBrowserOptions()
  if (options.typescript !== true || options.devMode !== true) invalidBrowserOptions()
  const target = browserTarget(options.target)
  const reactVersion = browserReactVersion(options.reactVersion)
  const router = browserRouter(target, options.router)
  const i18n = browserI18n(options.i18n)
  const uiKit = browserUIKit(options.uiKit)
  if (target === 'vue' && (i18n || locales !== undefined || uiKit !== undefined)) {
    invalidBrowserOptions()
  }
  return {
    packageName: options.packageName,
    target,
    reactVersion,
    router,
    typescript: true,
    devMode: true,
    i18n,
    ...(locales ? { locales } : {}),
    ...(uiKit ? { uiKit } : {})
  }
}
export function createBrowserPreviewWorkerRequest(
  input: CreateBrowserPreviewWorkerRequestInput,
  requestId: string,
  channelId: string
): BrowserPreviewWorkerRequest {
  if (!boundedId(requestId, REQUEST_ID_PATTERN)) {
    throw new TypeError('Browser preview Worker request id is invalid')
  }
  if (!boundedId(channelId, CHANNEL_ID_PATTERN)) {
    throw new TypeError('Browser preview Worker channel id is invalid')
  }
  if (!validGeneration(input.generation)) {
    throw new TypeError('Browser preview Worker generation is invalid')
  }
  const request: BrowserPreviewWorkerRequest = {
    version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
    type: 'build-browser-preview',
    requestId,
    generation: input.generation,
    channelId,
    graph: createVueCompilerGraphSnapshot(input.graph),
    pageIds: [...input.pageIds],
    options: input.options,
    fontProviders: [...input.fontProviders],
    refreshFonts: input.refreshFonts
  }
  validateBrowserPreviewWorkerRequest(request)
  return request
}
export function validateBrowserPreviewWorkerRequest(
  value: unknown
): asserts value is BrowserPreviewWorkerRequest {
  const request = exactRecord(
    value,
    REQUEST_KEYS,
    [...REQUEST_KEYS],
    'Browser preview Worker request'
  )
  if (
    request.version !== BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION ||
    request.type !== 'build-browser-preview' ||
    !boundedId(request.requestId, REQUEST_ID_PATTERN) ||
    !boundedId(request.channelId, CHANNEL_ID_PATTERN) ||
    !validGeneration(request.generation)
  ) {
    throw new TypeError('Browser preview Worker request envelope is invalid')
  }
  // Reject accessors, exotic prototypes, symbols, oversized backing buffers,
  // and traversal bombs before reading nested request fields.
  estimateVueSourceWorkerCloneBytes(value, BROWSER_PREVIEW_WORKER_LIMITS.maxSnapshotBytes)
  const pageIds = validatePageIds(request.pageIds)
  validateGraphSnapshot(request.graph, pageIds)
  validateOptions(request.options)
  validateFontProviders(request.fontProviders)
  if (typeof request.refreshFonts !== 'boolean') {
    throw new TypeError('Browser preview Worker refresh fonts flag is invalid')
  }
}
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}
function validateDiagnostic(value: unknown): PreviewDiagnostic {
  const diagnostic = exactRecord(
    value,
    DIAGNOSTIC_KEYS,
    ['code', 'severity', 'message'],
    'Browser preview Worker diagnostic'
  )
  const { code, severity, message, nodeId, path, line, column } = diagnostic
  if (!boundedText(code, 128)) {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  if (severity !== 'warning' && severity !== 'error') {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  if (!boundedText(message, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnosticTextLength)) {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  if (nodeId !== undefined && !boundedText(nodeId, 256)) {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  if (path !== undefined && !boundedText(path, 1_024)) {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  if (line !== undefined && !validGeneration(line)) {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  if (column !== undefined && !validGeneration(column)) {
    throw new TypeError('Browser preview Worker diagnostic is invalid')
  }
  return {
    code,
    severity,
    message,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(path === undefined ? {} : { path }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column })
  }
}
function validateMetrics(value: unknown): PreviewHostBuildMetrics {
  const metrics = exactRecord(
    value,
    METRIC_KEYS,
    [...METRIC_KEYS],
    'Browser preview Worker metrics'
  )
  const values = [...METRIC_KEYS].map((key) => metrics[key])
  if (
    values.some((metric) => typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0)
  ) {
    throw new TypeError('Browser preview Worker metrics are invalid')
  }
  const [compileMs, bundleMs, totalMs, inputBytes, outputBytes, fileCount, dependencyCount] =
    values as number[]
  return { compileMs, bundleMs, totalMs, inputBytes, outputBytes, fileCount, dependencyCount }
}
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
export function validateBrowserPreviewWorkerBuildResult(
  value: unknown
): BrowserPreviewWorkerBuildResult {
  if (!isRecord(value)) throw new TypeError('Browser preview Worker result is invalid')
  const status = Object.getOwnPropertyDescriptor(value, 'status')?.value
  let keys = new Set(['status', 'diagnostics', 'metrics'])
  if (status === 'ready') keys = new Set([...keys, 'html'])
  else if (status === 'unsupported') keys = new Set([...keys, 'reason'])
  const result = exactRecord(value, keys, [...keys], 'Browser preview Worker build result')
  if (status !== 'ready' && status !== 'error' && status !== 'unsupported') {
    throw new TypeError('Browser preview Worker result status is invalid')
  }
  if (
    !Array.isArray(result.diagnostics) ||
    result.diagnostics.length > BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnostics
  ) {
    throw new Error('Browser preview Worker returned too many diagnostics')
  }
  const diagnostics = result.diagnostics.map(validateDiagnostic)
  const metrics = validateMetrics(result.metrics)
  if (status === 'ready') {
    if (
      typeof result.html !== 'string' ||
      utf8ByteLength(result.html) > BROWSER_PREVIEW_WORKER_LIMITS.maxHtmlBytes
    ) {
      throw new Error('Browser preview Worker HTML exceeds its output limit')
    }
    return { status, html: result.html, diagnostics, metrics }
  }
  if (status === 'unsupported') {
    if (!boundedText(result.reason, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnosticTextLength)) {
      throw new TypeError('Browser preview Worker unsupported reason is invalid')
    }
    return { status, reason: result.reason, diagnostics, metrics }
  }
  return { status, diagnostics, metrics }
}
export function parseBrowserPreviewWorkerResponse(
  value: unknown,
  expectedRequestId: string,
  expectedGeneration: number
): BrowserPreviewWorkerResponse | null {
  if (!isRecord(value)) return null
  const requestId = Object.getOwnPropertyDescriptor(value, 'requestId')?.value
  const generation = Object.getOwnPropertyDescriptor(value, 'generation')?.value
  const version = Object.getOwnPropertyDescriptor(value, 'version')?.value
  const type = Object.getOwnPropertyDescriptor(value, 'type')?.value
  if (
    version !== BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION ||
    requestId !== expectedRequestId ||
    generation !== expectedGeneration
  ) {
    return null
  }
  if (type === 'error') {
    const response = exactRecord(
      value,
      new Set(['version', 'type', 'requestId', 'generation', 'error']),
      ['version', 'type', 'requestId', 'generation', 'error'],
      'Browser preview Worker error response'
    )
    if (!boundedText(response.error, BROWSER_PREVIEW_WORKER_LIMITS.maxDiagnosticTextLength)) {
      return null
    }
    return {
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      type: 'error',
      requestId: expectedRequestId,
      generation: expectedGeneration,
      error: response.error
    }
  }
  if (type === 'progress') {
    const response = exactRecord(
      value,
      new Set(['version', 'type', 'requestId', 'generation', 'stage', 'elapsedMs']),
      ['version', 'type', 'requestId', 'generation', 'stage', 'elapsedMs'],
      'Browser preview Worker progress response'
    )
    if (
      typeof response.stage !== 'string' ||
      !WORKER_STAGES.has(response.stage) ||
      typeof response.elapsedMs !== 'number' ||
      !Number.isFinite(response.elapsedMs) ||
      response.elapsedMs < 0
    ) {
      throw new TypeError('Browser preview Worker progress is invalid')
    }
    return {
      version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
      type: 'progress',
      requestId: expectedRequestId,
      generation: expectedGeneration,
      stage: response.stage as BrowserPreviewWorkerStage,
      elapsedMs: response.elapsedMs
    }
  }
  if (type !== 'result') return null
  const response = exactRecord(
    value,
    new Set(['version', 'type', 'requestId', 'generation', 'result']),
    ['version', 'type', 'requestId', 'generation', 'result'],
    'Browser preview Worker response'
  )
  return {
    version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
    type: 'result',
    requestId: expectedRequestId,
    generation: expectedGeneration,
    result: validateBrowserPreviewWorkerBuildResult(response.result)
  }
}
// Correlate nested validation failures; leave uncorrelated garbage silent.
export function createCorrelatedBrowserPreviewWorkerResponse(
  request: unknown,
  result: BrowserPreviewWorkerBuildResult
): BrowserPreviewWorkerResponse | null {
  if (!isRecord(request)) return null
  const requestId = Object.getOwnPropertyDescriptor(request, 'requestId')?.value
  const generation = Object.getOwnPropertyDescriptor(request, 'generation')?.value
  if (!boundedId(requestId, REQUEST_ID_PATTERN) || !validGeneration(generation)) return null
  return {
    version: BROWSER_PREVIEW_WORKER_PROTOCOL_VERSION,
    type: 'result',
    requestId,
    generation,
    result: validateBrowserPreviewWorkerBuildResult(result)
  }
}
