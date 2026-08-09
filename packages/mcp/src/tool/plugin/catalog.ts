import { createHash } from 'node:crypto'

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, getDomainFailure, ok } from '#mcp/result'
import type { MCPResult } from '#mcp/result'
import {
  PLUGIN_MCP_CATALOG_LIMITS,
  type PluginMcpCatalogSnapshot,
  type PluginMcpToolDescriptor,
  type PluginMcpToolKind
} from '#mcp/tool/plugin/contract'
import { parsePluginMcpInputSchema } from '#mcp/tool/plugin/schema'
import type { RpcSender, ToolRequestExtra } from '#mcp/tool/registration'

export { PLUGIN_MCP_CATALOG_LIMITS }
export type { PluginMcpCatalogSnapshot, PluginMcpToolDescriptor, PluginMcpToolKind }

interface CatalogRecord {
  [key: string]: unknown
}

type CatalogListener = (snapshot: PluginMcpCatalogSnapshot) => void

const EMPTY_SNAPSHOT: PluginMcpCatalogSnapshot = Object.freeze({
  revision: '',
  tools: Object.freeze([])
})

const DESCRIPTOR_REQUIRED_KEYS = Object.freeze([
  'name',
  'description',
  'inputSchema',
  'pluginId',
  'kind',
  'contributionId'
])
const DESCRIPTOR_OPTIONAL_KEYS = Object.freeze(['title'])
const PLUGIN_TOOL_NAME = /^plugin__[a-z0-9_]+__(add|run|export|query)_[a-z0-9_]+_([a-f0-9]{64})$/
const IDENTITY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i
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

function jsonBytes(value: unknown): number {
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
  return value as CatalogRecord
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

function pluginToolIdentityDigest(
  pluginId: string,
  kind: PluginMcpToolKind,
  contributionId: string
): string {
  return createHash('sha256')
    .update(`${kind}\0${pluginId}\0${contributionId}`, 'utf8')
    .digest('hex')
}

function parseDescriptor(value: unknown, index: number): PluginMcpToolDescriptor {
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
    inputSchema: parsePluginMcpInputSchema(source.inputSchema, `${path}.inputSchema`, kind),
    pluginId,
    kind,
    contributionId
  })
}

export function parsePluginMcpCatalogResponse(value: unknown): PluginMcpCatalogSnapshot {
  if (jsonBytes(value) > PLUGIN_MCP_CATALOG_LIMITS.maxCatalogBytes) {
    throw new TypeError('pluginMcpCatalog exceeds the catalog byte limit')
  }
  const envelope = exactRecord(value, 'pluginMcpCatalog', ['ok', 'result'], ['error'])
  if (envelope.ok !== true) {
    const message =
      typeof envelope.error === 'string' ? envelope.error : 'Plugin MCP catalog failed'
    throw new Error(message)
  }
  const result = exactRecord(envelope.result, 'pluginMcpCatalog.result', ['revision', 'tools'])
  const revision = boundedString(
    result.revision,
    'pluginMcpCatalog.result.revision',
    PLUGIN_MCP_CATALOG_LIMITS.maxRevisionLength
  )
  if (!Array.isArray(result.tools) || result.tools.length > PLUGIN_MCP_CATALOG_LIMITS.maxTools) {
    throw new TypeError(
      `pluginMcpCatalog.result.tools must be an array with at most ${PLUGIN_MCP_CATALOG_LIMITS.maxTools} entries`
    )
  }
  const tools = result.tools
    .map(parseDescriptor)
    .sort((left, right) => left.name.localeCompare(right.name))
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new TypeError('pluginMcpCatalog.result.tools names must be unique')
  }
  return Object.freeze({ revision, tools: Object.freeze(tools) })
}

function snapshotFingerprint(snapshot: PluginMcpCatalogSnapshot): string {
  return JSON.stringify(snapshot)
}

export function createPluginMcpCatalog() {
  let snapshot = EMPTY_SNAPSHOT
  let fingerprint = snapshotFingerprint(snapshot)
  const listeners = new Set<CatalogListener>()

  function current(): PluginMcpCatalogSnapshot {
    return snapshot
  }

  function replace(value: unknown): boolean {
    const next = parsePluginMcpCatalogResponse(value)
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

  function get(name: string): PluginMcpToolDescriptor | undefined {
    return snapshot.tools.find((tool) => tool.name === name)
  }

  function subscribe(listener: CatalogListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { clear, current, get, replace, subscribe }
}

export type PluginMcpCatalog = ReturnType<typeof createPluginMcpCatalog>

export function createPluginMcpController(options: {
  sendRpc: RpcSender
  pollIntervalMs?: number
}) {
  const catalog = createPluginMcpCatalog()
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
      .sendRpc({ command: 'plugin_mcp_tools', args: {} })
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

function toolInputSchema(descriptor: PluginMcpToolDescriptor): z.ZodType {
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
  descriptor: PluginMcpToolDescriptor,
  target: { document_id?: string; page_id?: string }
): Record<string, unknown> {
  return {
    openpencil: {
      tool: descriptor.name,
      pluginId: descriptor.pluginId,
      contributionId: descriptor.contributionId,
      kind: descriptor.kind,
      requestedTarget: target
    }
  }
}

async function callPluginTool(
  catalog: PluginMcpCatalog,
  sendRpc: RpcSender,
  registeredName: string,
  args: Record<string, unknown>,
  extra?: ToolRequestExtra
): Promise<MCPResult> {
  const descriptor = catalog.get(registeredName)
  if (!descriptor) {
    return fail(`Plugin tool "${registeredName}" is no longer installed and enabled`)
  }
  const { target, args: toolArgs } = splitAutomationTarget(args)
  const meta = pluginCallMeta(descriptor, target)
  try {
    // The app resolves the installed/enabled contribution again immediately before
    // execution. This closes the uninstall/disable race between tools/list and tools/call.
    const response = (await sendRpc(
      {
        command: 'plugin_mcp_tool',
        args: {
          ...target,
          name: descriptor.name,
          pluginId: descriptor.pluginId,
          args: toolArgs
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

export function registerPluginMcpTools(
  mcpServer: McpServer,
  options: { catalog: PluginMcpCatalog; sendRpc: RpcSender }
): { dispose: () => void } {
  const registered = new Map<string, { fingerprint: string; tool: RegisteredTool }>()

  function reconcile(snapshot: PluginMcpCatalogSnapshot): void {
    const nextNames = new Set(snapshot.tools.map((tool) => tool.name))
    for (const [name, registration] of registered) {
      if (nextNames.has(name)) continue
      registration.tool.remove()
      registered.delete(name)
    }
    for (const descriptor of snapshot.tools) {
      const fingerprint = JSON.stringify(descriptor)
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
              kind: descriptor.kind
            }
          }
        },
        (args, extra) =>
          callPluginTool(
            options.catalog,
            options.sendRpc,
            descriptor.name,
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
