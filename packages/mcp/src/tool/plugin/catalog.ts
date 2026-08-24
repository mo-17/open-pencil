import { createHash } from 'node:crypto'

import type {
  McpServer as MCPServer,
  RegisteredTool
} from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, getDomainFailure, ok } from '#mcp/result'
import type { MCPResult } from '#mcp/result'
import {
  PLUGIN_MCP_CATALOG_LIMITS,
  type PluginMCPCatalogSnapshot,
  type PluginMCPToolAuthority,
  type PluginMCPToolCallDescriptor,
  type PluginMCPToolCallRequest,
  type PluginMCPToolDescriptor,
  type PluginMCPToolKind
} from '#mcp/tool/plugin/contract'
import { parsePluginMCPInputSchema } from '#mcp/tool/plugin/schema'
import type { RPCSender, ToolRequestExtra } from '#mcp/tool/registration'

export { PLUGIN_MCP_CATALOG_LIMITS }
export type {
  PluginMCPCatalogSnapshot,
  PluginMCPToolAuthority,
  PluginMCPToolCallDescriptor,
  PluginMCPToolCallRequest,
  PluginMCPToolDescriptor,
  PluginMCPToolKind
}

interface CatalogRecord {
  [key: string]: unknown
}

type CatalogListener = (snapshot: PluginMCPCatalogSnapshot) => void

const EMPTY_SNAPSHOT: PluginMCPCatalogSnapshot = Object.freeze({
  revision: '',
  tools: Object.freeze([])
})

const DESCRIPTOR_REQUIRED_KEYS = Object.freeze([
  'name',
  'description',
  'inputSchema',
  'pluginId',
  'kind',
  'contributionId',
  'authority'
])
const DESCRIPTOR_OPTIONAL_KEYS = Object.freeze(['title'])
const AUTHORITY_KEYS = Object.freeze([
  'trustSource',
  'packageDigest',
  'pluginVersion',
  'publisherId',
  'publisherKeyId',
  'adapterId'
])
const PLUGIN_TOOL_NAME = /^plugin__[a-z0-9_]+__(add|run|export|query)_[a-z0-9_]+_([a-f0-9]{64})$/
const IDENTITY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA_256_BASE64URL = /^[A-Za-z0-9_-]{43}$/
const APP_BUNDLE_SHA_256 = /^app-bundle-sha256:[A-Za-z0-9_-]{43}$/
const AUTOMATION_TARGET_PROPERTIES = Object.freeze({
  document_id: Object.freeze({
    type: 'string',
    description: 'Optional OpenPencil document/tab ID to target'
  }),
  page_id: Object.freeze({
    type: 'string',
    description: 'Optional page ID to target within the document'
  })
})

function JSONBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function record(value: unknown, path: string): CatalogRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new TypeError(`${path} must not contain symbol properties`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}.${key} must be an enumerable data property`)
    }
  }
  return value as CatalogRecord
}

function boundedArray(value: unknown, path: string, maximumLength: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new TypeError(`${path} must be an array with at most ${maximumLength} entries`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== value.length + 1 ||
    keys.some((key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))
  ) {
    throw new TypeError(`${path} must be a dense array without custom properties`)
  }
  return Object.freeze(
    Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${path}[${index}] must be an enumerable data property`)
      }
      return descriptor.value
    })
  )
}

function exactRecord(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): CatalogRecord {
  const source = record(value, path)
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not supported`)
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(source, key)) throw new TypeError(`${path}.${key} is required`)
  }
  return source
}

function boundedString(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new TypeError(`${path} must be a non-empty string of at most ${maximumLength} characters`)
  }
  let hasControlCharacter = false
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) {
      hasControlCharacter = true
      break
    }
  }
  if (value.trim() !== value || hasControlCharacter) {
    throw new TypeError(`${path} must not contain surrounding whitespace or control characters`)
  }
  return value
}

function identity(value: unknown, path: string): string {
  const parsed = boundedString(value, path, PLUGIN_MCP_CATALOG_LIMITS.maxIdentityLength)
  if (!IDENTITY.test(parsed)) throw new TypeError(`${path} is not a valid identity`)
  return parsed
}

function parseAuthority(value: unknown, path: string): PluginMCPToolAuthority {
  const source = exactRecord(value, path, AUTHORITY_KEYS)
  const trustSource = source.trustSource
  if (trustSource !== 'app-bundle' && trustSource !== 'publisher-signature') {
    throw new TypeError(`${path}.trustSource is not supported`)
  }
  const packageDigest = boundedString(
    source.packageDigest,
    `${path}.packageDigest`,
    PLUGIN_MCP_CATALOG_LIMITS.maxPackageDigestLength
  )
  const digestPattern = trustSource === 'app-bundle' ? APP_BUNDLE_SHA_256 : SHA_256_BASE64URL
  if (!digestPattern.test(packageDigest)) {
    throw new TypeError(`${path}.packageDigest does not match ${path}.trustSource`)
  }
  const pluginVersion = boundedString(
    source.pluginVersion,
    `${path}.pluginVersion`,
    PLUGIN_MCP_CATALOG_LIMITS.maxPluginVersionLength
  )
  const versionMatch = STABLE_SEMVER.exec(pluginVersion)
  if (!versionMatch || !versionMatch.slice(1).every((part) => Number.isSafeInteger(Number(part)))) {
    throw new TypeError(`${path}.pluginVersion must be a stable semantic version`)
  }
  return Object.freeze({
    trustSource,
    packageDigest,
    pluginVersion,
    publisherId: identity(source.publisherId, `${path}.publisherId`),
    publisherKeyId: identity(source.publisherKeyId, `${path}.publisherKeyId`),
    adapterId: identity(source.adapterId, `${path}.adapterId`)
  })
}

function pluginToolIdentityDigest(
  pluginId: string,
  kind: PluginMCPToolKind,
  contributionId: string
): string {
  return createHash('sha256')
    .update(`${kind}\0${pluginId}\0${contributionId}`, 'utf8')
    .digest('hex')
}

function parseDescriptor(value: unknown, index: number): PluginMCPToolDescriptor {
  const path = `pluginMcpCatalog.tools[${index}]`
  const source = exactRecord(value, path, DESCRIPTOR_REQUIRED_KEYS, DESCRIPTOR_OPTIONAL_KEYS)
  const kind = source.kind
  if (kind !== 'module' && kind !== 'command' && kind !== 'exporter' && kind !== 'connector') {
    throw new TypeError(`${path}.kind is not supported`)
  }
  const pluginId = identity(source.pluginId, `${path}.pluginId`)
  const contributionId = identity(source.contributionId, `${path}.contributionId`)
  const name = boundedString(source.name, `${path}.name`, PLUGIN_MCP_CATALOG_LIMITS.maxNameLength)
  const nameMatch = PLUGIN_TOOL_NAME.exec(name)
  if (!nameMatch) {
    throw new TypeError(
      `${path}.name must use the reserved plugin tool namespace with a SHA-256 identity suffix`
    )
  }
  const expectedAction = {
    module: 'add',
    command: 'run',
    exporter: 'export',
    connector: 'query'
  }[kind]
  if (nameMatch[1] !== expectedAction) {
    throw new TypeError(`${path}.name action does not match ${path}.kind`)
  }
  if (nameMatch[2] !== pluginToolIdentityDigest(pluginId, kind, contributionId)) {
    throw new TypeError(`${path}.name identity suffix does not match its canonical contribution`)
  }
  const authority = parseAuthority(source.authority, `${path}.authority`)
  return Object.freeze({
    name,
    ...(source.title === undefined
      ? {}
      : {
          title: boundedString(
            source.title,
            `${path}.title`,
            PLUGIN_MCP_CATALOG_LIMITS.maxTitleLength
          )
        }),
    description: boundedString(
      source.description,
      `${path}.description`,
      PLUGIN_MCP_CATALOG_LIMITS.maxDescriptionLength
    ),
    inputSchema: parsePluginMCPInputSchema(source.inputSchema, `${path}.inputSchema`, kind),
    pluginId,
    kind,
    contributionId,
    authority
  })
}

export function parsePluginMCPCatalogResponse(value: unknown): PluginMCPCatalogSnapshot {
  const envelope = exactRecord(value, 'pluginMcpCatalog', ['ok', 'result'], ['error'])
  if (envelope.ok !== true) {
    const message =
      typeof envelope.error === 'string' ? envelope.error : 'Plugin MCP catalog failed'
    throw new Error(message)
  }
  if (envelope.error !== undefined) {
    throw new TypeError('pluginMcpCatalog.error is not supported on a successful response')
  }
  const result = exactRecord(envelope.result, 'pluginMcpCatalog.result', ['revision', 'tools'])
  const revision = boundedString(
    result.revision,
    'pluginMcpCatalog.result.revision',
    PLUGIN_MCP_CATALOG_LIMITS.maxRevisionLength
  )
  const tools = boundedArray(
    result.tools,
    'pluginMcpCatalog.result.tools',
    PLUGIN_MCP_CATALOG_LIMITS.maxTools
  )
    .map(parseDescriptor)
    .sort((left, right) => left.name.localeCompare(right.name))
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new TypeError('pluginMcpCatalog.result.tools names must be unique')
  }
  const snapshot = Object.freeze({ revision, tools: Object.freeze(tools) })
  if (JSONBytes({ ok: true, result: snapshot }) > PLUGIN_MCP_CATALOG_LIMITS.maxCatalogBytes) {
    throw new TypeError('pluginMcpCatalog exceeds the catalog byte limit')
  }
  return snapshot
}

function snapshotFingerprint(snapshot: PluginMCPCatalogSnapshot): string {
  return JSON.stringify(snapshot)
}

export function createPluginMCPCatalog() {
  let snapshot = EMPTY_SNAPSHOT
  let fingerprint = snapshotFingerprint(snapshot)
  const listeners = new Set<CatalogListener>()

  function current(): PluginMCPCatalogSnapshot {
    return snapshot
  }

  function replace(value: unknown): boolean {
    const next = parsePluginMCPCatalogResponse(value)
    const nextFingerprint = snapshotFingerprint(next)
    if (nextFingerprint === fingerprint) return false
    snapshot = next
    fingerprint = nextFingerprint
    for (const listener of listeners) listener(snapshot)
    return true
  }

  function clear(): boolean {
    if (snapshot.tools.length === 0 && snapshot.revision === '') return false
    snapshot = EMPTY_SNAPSHOT
    fingerprint = snapshotFingerprint(snapshot)
    for (const listener of listeners) listener(snapshot)
    return true
  }

  function get(name: string): PluginMCPToolDescriptor | undefined {
    return snapshot.tools.find((tool) => tool.name === name)
  }

  function subscribe(listener: CatalogListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { clear, current, get, replace, subscribe }
}

export type PluginMCPCatalog = ReturnType<typeof createPluginMCPCatalog>

export function createPluginMCPController(options: {
  sendRPC: RPCSender
  pollIntervalMs?: number
}) {
  const catalog = createPluginMCPCatalog()
  const pollIntervalMs = options.pollIntervalMs ?? 2_000
  let refreshGeneration = 0
  let inFlight: Promise<boolean> | null = null
  let refreshPending = false
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let closed = false

  function refresh(): Promise<boolean> {
    if (closed) return Promise.resolve(false)
    if (inFlight) {
      refreshPending = true
      const current = inFlight
      return current.then(() => {
        const queued = inFlight
        return queued && queued !== current ? queued : false
      })
    }
    const generation = ++refreshGeneration
    const task = options
      .sendRPC({ command: 'plugin_mcp_tools', args: {} })
      .then((response) => {
        if (generation !== refreshGeneration) return false
        return catalog.replace(response)
      })
      .catch(() => {
        if (generation !== refreshGeneration) return false
        return catalog.clear()
      })
      .finally(() => {
        if (inFlight !== task) return
        inFlight = null
        if (refreshPending && !closed) {
          refreshPending = false
          void refresh()
        }
      })
    inFlight = task
    return inFlight
  }

  function clear(): boolean {
    refreshGeneration += 1
    refreshPending = false
    inFlight = null
    return catalog.clear()
  }

  function startPolling(): void {
    if (closed || pollTimer) return
    pollTimer = setInterval(() => {
      void refresh()
    }, pollIntervalMs)
    pollTimer.unref()
  }

  function stopPolling(): void {
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  function close(): void {
    closed = true
    stopPolling()
    clear()
  }

  return { catalog, clear, close, refresh, startPolling, stopPolling }
}

function toolInputSchema(descriptor: PluginMCPToolDescriptor): z.ZodType {
  const properties = record(
    descriptor.inputSchema.properties ?? {},
    'pluginTool.inputSchema.properties'
  )
  return z.fromJSONSchema({
    ...descriptor.inputSchema,
    properties: {
      ...properties,
      ...AUTOMATION_TARGET_PROPERTIES
    }
  })
}

function splitAutomationTarget(args: Record<string, unknown>): {
  target: { document_id?: string; page_id?: string }
  args: Record<string, unknown>
} {
  const { document_id, page_id, ...rest } = args
  return {
    target: {
      ...(typeof document_id === 'string' ? { document_id } : {}),
      ...(typeof page_id === 'string' ? { page_id } : {})
    },
    args: rest
  }
}

function pluginCallMeta(
  descriptor: PluginMCPToolDescriptor,
  target: { document_id?: string; page_id?: string }
): Record<string, unknown> {
  return {
    openpencil: {
      tool: descriptor.name,
      pluginId: descriptor.pluginId,
      contributionId: descriptor.contributionId,
      kind: descriptor.kind,
      authority: descriptor.authority,
      requestedTarget: target
    }
  }
}

function callDescriptor(descriptor: PluginMCPToolDescriptor): PluginMCPToolCallDescriptor {
  return Object.freeze({
    name: descriptor.name,
    ...(descriptor.title === undefined ? {} : { title: descriptor.title }),
    pluginId: descriptor.pluginId,
    kind: descriptor.kind,
    contributionId: descriptor.contributionId,
    authority: descriptor.authority
  })
}

function sameCallDescriptor(
  left: PluginMCPToolCallDescriptor,
  right: PluginMCPToolCallDescriptor
): boolean {
  return (
    left.name === right.name &&
    left.title === right.title &&
    left.pluginId === right.pluginId &&
    left.kind === right.kind &&
    left.contributionId === right.contributionId &&
    left.authority.trustSource === right.authority.trustSource &&
    left.authority.packageDigest === right.authority.packageDigest &&
    left.authority.pluginVersion === right.authority.pluginVersion &&
    left.authority.publisherId === right.authority.publisherId &&
    left.authority.publisherKeyId === right.authority.publisherKeyId &&
    left.authority.adapterId === right.authority.adapterId
  )
}

async function callPluginTool(
  catalog: PluginMCPCatalog,
  sendRPC: RPCSender,
  expectedCatalogRevision: string,
  expectedDescriptor: PluginMCPToolCallDescriptor,
  args: Record<string, unknown>,
  extra?: ToolRequestExtra
): Promise<MCPResult> {
  const snapshot = catalog.current()
  const descriptor = catalog.get(expectedDescriptor.name)
  if (
    snapshot.revision !== expectedCatalogRevision ||
    !descriptor ||
    !sameCallDescriptor(callDescriptor(descriptor), expectedDescriptor)
  ) {
    return fail(
      `Plugin tool "${expectedDescriptor.name}" catalog authority changed; refresh tools/list before calling it`
    )
  }
  const { target, args: toolArgs } = splitAutomationTarget(args)
  const meta = pluginCallMeta(descriptor, target)
  try {
    // The app resolves the installed/enabled contribution again immediately before
    // execution. This closes the uninstall/disable race between tools/list and tools/call.
    const request: PluginMCPToolCallRequest<Record<string, unknown>> = {
      name: expectedDescriptor.name,
      pluginId: expectedDescriptor.pluginId,
      expectedCatalogRevision,
      expectedDescriptor,
      args: toolArgs
    }
    const response = (await sendRPC(
      {
        command: 'plugin_mcp_tool',
        args: {
          ...target,
          ...request
        }
      },
      { signal: extra?.signal }
    )) as { ok?: boolean; result?: unknown; error?: string }
    if (response.ok === false) return fail(response.error ?? 'Plugin MCP tool failed', meta)
    const domainFailure = getDomainFailure(response.result)
    if (domainFailure) return fail(domainFailure.error, meta)
    return ok(response.result, descriptor.name, meta)
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw error
    }
    return fail(error, meta)
  }
}

export function registerPluginMCPTools(
  mcpServer: MCPServer,
  options: { catalog: PluginMCPCatalog; sendRPC: RPCSender }
): { dispose: () => void } {
  const registered = new Map<string, { fingerprint: string; tool: RegisteredTool }>()

  function reconcile(snapshot: PluginMCPCatalogSnapshot): void {
    const nextNames = new Set(snapshot.tools.map((tool) => tool.name))
    for (const [name, registration] of registered) {
      if (nextNames.has(name)) continue
      registration.tool.remove()
      registered.delete(name)
    }
    for (const descriptor of snapshot.tools) {
      const expectedDescriptor = callDescriptor(descriptor)
      const fingerprint = JSON.stringify([snapshot.revision, descriptor])
      const previous = registered.get(descriptor.name)
      if (previous?.fingerprint === fingerprint) continue
      if (previous) {
        // A catalog replacement may keep the stable tool name while changing its
        // schema or ownership metadata. Remove and re-register so no stale callback
        // or input validator survives the revision change.
        previous.tool.remove()
        registered.delete(descriptor.name)
      }
      const tool = mcpServer.registerTool(
        descriptor.name,
        {
          ...(descriptor.title ? { title: descriptor.title } : {}),
          description: descriptor.description,
          inputSchema: toolInputSchema(descriptor),
          outputSchema: z.looseObject({}),
          _meta: {
            openpencil: {
              pluginId: descriptor.pluginId,
              contributionId: descriptor.contributionId,
              kind: descriptor.kind,
              authority: descriptor.authority,
              catalogRevision: snapshot.revision
            }
          }
        },
        (args, extra) =>
          callPluginTool(
            options.catalog,
            options.sendRPC,
            snapshot.revision,
            expectedDescriptor,
            record(args, `pluginTool.${descriptor.name}.args`),
            { signal: extra.signal }
          )
      )
      registered.set(descriptor.name, { fingerprint, tool })
    }
  }

  reconcile(options.catalog.current())
  const unsubscribe = options.catalog.subscribe(reconcile)
  return {
    dispose() {
      unsubscribe()
      for (const registration of registered.values()) registration.tool.remove()
      registered.clear()
    }
  }
}
