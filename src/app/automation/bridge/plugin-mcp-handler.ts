import {
  parsePluginObjectParameterValue,
  type DeclarativeCommandContributionV2,
  type DeclarativeExporterContributionV2,
  type PluginConnectorOperationV1
} from '@open-pencil/core/plugins'
import { canonicalManifestValue } from '@open-pencil/scene-graph'
import type { JSONObject, JSONValue } from '@open-pencil/scene-graph/primitives'

import type { AutomationRequestContext } from '@/app/automation/bridge/request-context'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import type { EditorStore } from '@/app/editor/active-store'
import { appPluginStore } from '@/app/plugins/app'
import {
  executeInstalledAppConnector,
  isAppConnectorMCPExposed,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import type { ConnectorParameterObject } from '@/app/plugins/connectors/types'
import {
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  type AppPluginHostExecutionResult
} from '@/app/plugins/host'
import {
  listAppPluginMCPTools,
  PLUGIN_MCP_LIMITS,
  resolveAppPluginMCPTool,
  type AppPluginMCPOptions,
  type AppPluginMCPStore
} from '@/app/plugins/mcp'
import { inspectInstalledPluginModuleCompatibility } from '@/app/plugins/modules'
import type {
  AppPluginCommandContribution,
  AppPluginExporterContribution,
  InstalledPluginCommand,
  InstalledPluginConnector,
  InstalledPluginExporter
} from '@/app/plugins/types'

const REQUEST_KEYS = new Set(['name', 'pluginId', 'args'])
const MODULE_ARGUMENT_KEYS = new Set(['config', 'x', 'y', 'width', 'height', 'name', 'parent_id'])
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_JSON_DEPTH = 16
const MAX_JSON_VALUES = 4_096

type AutomationToolHandler = (
  target: AutomationTarget,
  args: unknown,
  context?: AutomationRequestContext
) => Promise<unknown>

export interface AutomationPluginMCPDependencies {
  store: AppPluginMCPStore
  mcpOptions?: AppPluginMCPOptions
  runCommand(
    editor: EditorStore,
    plugin: InstalledPluginCommand['plugin'],
    contribution: InstalledPluginCommand['contribution'],
    args: JSONObject,
    signal?: AbortSignal
  ): Promise<AppPluginHostExecutionResult>
  runExporter(
    editor: EditorStore,
    plugin: InstalledPluginExporter['plugin'],
    contribution: InstalledPluginExporter['contribution'],
    signal?: AbortSignal,
    args?: JSONObject
  ): Promise<AppPluginHostExecutionResult>
  runConnector?(
    connector: InstalledPluginConnector,
    operation: PluginConnectorOperationV1,
    args: ConnectorParameterObject,
    signal?: AbortSignal
  ): ReturnType<typeof executeInstalledAppConnector>
  refreshConnectorCredentialReadiness?(): Promise<void>
}

const runDefaultExporter: AutomationPluginMCPDependencies['runExporter'] = (
  editor,
  plugin,
  contribution,
  signal,
  args
) => runInstalledPluginExporter(editor, plugin, contribution, undefined, signal, args)

const runDefaultCommand: AutomationPluginMCPDependencies['runCommand'] = (
  editor,
  plugin,
  contribution,
  args,
  signal
) => runInstalledPluginCommand(editor, plugin, contribution, undefined, args, signal)

const runDefaultConnector: NonNullable<AutomationPluginMCPDependencies['runConnector']> = (
  connector,
  operation,
  args,
  signal
) => executeInstalledAppConnector(connector, operation.operationId, args, { signal })

const DEFAULT_DEPENDENCIES: AutomationPluginMCPDependencies = Object.freeze({
  store: appPluginStore,
  mcpOptions: Object.freeze({
    connectorExposure: isAppConnectorMCPExposed,
    connectorNonGetReadOnlyExposure: isAppConnectorMCPExposed
  }),
  runCommand: runDefaultCommand,
  runExporter: runDefaultExporter,
  runConnector: runDefaultConnector,
  refreshConnectorCredentialReadiness: () =>
    refreshAppConnectorCredentialReadiness(appPluginStore.installedConnectors()).then(
      () => undefined
    )
})

interface PluginMCPRequestRecord {
  [key: string]: unknown
}

function exactRecord(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>
): PluginMCPRequestRecord {
  if (!isUnknownRecord(value)) throw new TypeError(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${label} must not contain symbol fields`)
  }
  const normalized = Object.create(null) as PluginMCPRequestRecord
  for (const key of keys as string[]) {
    if (!allowedKeys.has(key)) throw new TypeError(`${label} contains unsupported field: ${key}`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}.${key} must be an enumerable data field`)
    }
    normalized[key] = descriptor.value
  }
  return Object.freeze(normalized)
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  const normalized = value.normalize('NFC').trim()
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new TypeError(`${label} must contain between 1 and ${maximum} characters`)
  }
  for (const character of normalized) {
    const point = character.codePointAt(0) ?? 0
    if (point <= 31 || point === 127) throw new TypeError(`${label} contains control characters`)
  }
  return normalized
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function jsonValue(value: unknown, state: { count: number }, depth = 0): JSONValue {
  state.count += 1
  if (state.count > MAX_JSON_VALUES) throw new TypeError('Plugin MCP config is too complex')
  if (depth > MAX_JSON_DEPTH) throw new TypeError('Plugin MCP config is too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Plugin MCP config numbers must be finite')
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, state, depth + 1))
  if (!isUnknownRecord(value)) throw new TypeError('Plugin MCP config must contain JSON values')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Plugin MCP config must contain plain objects')
  }
  const result: JSONObject = {}
  for (const [key, nested] of Object.entries(value)) {
    if (UNSAFE_JSON_KEYS.has(key))
      throw new TypeError(`Plugin MCP config contains unsafe key: ${key}`)
    result[key] = jsonValue(nested, state, depth + 1)
  }
  return result
}

function boundedConfig(value: unknown): JSONObject {
  const normalized = jsonValue(value, { count: 0 })
  if (!isUnknownRecord(normalized)) throw new TypeError('Plugin MCP config must be an object')
  const canonical = canonicalManifestValue(normalized) as JSONObject
  const bytes = new TextEncoder().encode(JSON.stringify(canonical)).byteLength
  if (bytes > PLUGIN_MCP_LIMITS.maxConfigBytes) {
    throw new TypeError(
      `Plugin MCP config exceeds the ${PLUGIN_MCP_LIMITS.maxConfigBytes} byte limit`
    )
  }
  return canonical
}

function moduleArguments(value: unknown): Record<string, unknown> {
  const args = exactRecord(value ?? {}, 'Plugin MCP module arguments', MODULE_ARGUMENT_KEYS)
  return {
    ...(args.config === undefined ? {} : { config: boundedConfig(args.config) }),
    ...(args.x === undefined
      ? {}
      : {
          x: boundedNumber(
            args.x,
            'Plugin MCP x',
            -PLUGIN_MCP_LIMITS.maxCoordinate,
            PLUGIN_MCP_LIMITS.maxCoordinate
          )
        }),
    ...(args.y === undefined
      ? {}
      : {
          y: boundedNumber(
            args.y,
            'Plugin MCP y',
            -PLUGIN_MCP_LIMITS.maxCoordinate,
            PLUGIN_MCP_LIMITS.maxCoordinate
          )
        }),
    ...(args.width === undefined
      ? {}
      : {
          width: boundedNumber(args.width, 'Plugin MCP width', 1, PLUGIN_MCP_LIMITS.maxDimension)
        }),
    ...(args.height === undefined
      ? {}
      : {
          height: boundedNumber(args.height, 'Plugin MCP height', 1, PLUGIN_MCP_LIMITS.maxDimension)
        }),
    ...(args.name === undefined
      ? {}
      : {
          name: boundedString(args.name, 'Plugin MCP layer name', PLUGIN_MCP_LIMITS.maxNameLength)
        }),
    ...(args.parent_id === undefined
      ? {}
      : {
          parent_id: boundedString(
            args.parent_id,
            'Plugin MCP parent id',
            PLUGIN_MCP_LIMITS.maxParentIdLength
          )
        })
  }
}

function emptyArguments(value: unknown): void {
  exactRecord(value ?? {}, 'Plugin MCP tool arguments', new Set())
}

function contributionArguments(
  contribution: AppPluginCommandContribution | AppPluginExporterContribution,
  value: unknown
): JSONObject {
  if (!isV2Contribution(contribution)) {
    emptyArguments(value)
    return {}
  }
  return parsePluginObjectParameterValue(
    value,
    contribution.parameters.schema,
    contribution.parameters.maxBytes,
    'Plugin MCP contribution arguments'
  ) as JSONObject
}

function isV2Contribution(
  contribution: AppPluginCommandContribution | AppPluginExporterContribution
): contribution is DeclarativeCommandContributionV2 | DeclarativeExporterContributionV2 {
  return Object.hasOwn(contribution, 'parameters')
}

function request(value: unknown): { name: string; pluginId: string; args: unknown } {
  const candidate = exactRecord(value, 'Plugin MCP request', REQUEST_KEYS)
  return {
    name: boundedString(
      candidate.name,
      'Plugin MCP tool name',
      PLUGIN_MCP_LIMITS.maxToolNameLength
    ),
    pluginId: boundedString(candidate.pluginId, 'Plugin MCP plugin id', 128),
    args: candidate.args === undefined ? {} : candidate.args
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Automation request cancelled')
  error.name = 'AbortError'
  throw error
}

export function createAutomationPluginMCPHandlers(
  handleAutomationTool: AutomationToolHandler,
  dependencies: AutomationPluginMCPDependencies = DEFAULT_DEPENDENCIES
) {
  async function handleList(): Promise<{
    ok: true
    result: ReturnType<typeof listAppPluginMCPTools>
  }> {
    await dependencies.refreshConnectorCredentialReadiness?.()
    return {
      ok: true,
      result: listAppPluginMCPTools(dependencies.store, dependencies.mcpOptions)
    }
  }

  async function handleCall(
    target: AutomationTarget,
    rawRequest: unknown,
    context?: AutomationRequestContext
  ): Promise<unknown> {
    throwIfAborted(context?.signal)
    const call = request(rawRequest)
    await dependencies.refreshConnectorCredentialReadiness?.()
    throwIfAborted(context?.signal)
    // Rebuild and resolve from current installed state for every invocation. A descriptor cached by
    // an MCP client cannot outlive disable/uninstall or a trust/compatibility change.
    const resolved = resolveAppPluginMCPTool(
      dependencies.store,
      call.name,
      call.pluginId,
      dependencies.mcpOptions
    )
    if (resolved.kind === 'module') {
      const args = moduleArguments(call.args)
      if (args.config !== undefined) {
        const compatibility = inspectInstalledPluginModuleCompatibility(resolved.value)
        if (!compatibility.ok) throw new Error(compatibility.reason)
        compatibility.definition.createInstance(args.config)
      }
      return handleAutomationTool(
        target,
        {
          name: 'create_module',
          args: {
            ...args,
            plugin_id: resolved.descriptor.pluginId,
            module_type: resolved.descriptor.contributionId
          }
        },
        context
      )
    }

    if (resolved.kind === 'connector') {
      if (!dependencies.runConnector) {
        throw new Error('Plugin connector MCP execution is unavailable')
      }
      const args = parsePluginObjectParameterValue(
        call.args,
        resolved.operation.parameters.schema,
        resolved.operation.parameters.maxBytes,
        'Plugin MCP connector arguments'
      )
      const execution = await dependencies.runConnector(
        resolved.value,
        resolved.operation,
        args,
        context?.signal
      )
      throwIfAborted(context?.signal)
      return {
        ok: true,
        result: {
          pluginId: resolved.descriptor.pluginId,
          kind: resolved.kind,
          contributionId: resolved.descriptor.contributionId,
          ...execution
        }
      }
    }

    const args = contributionArguments(resolved.value.contribution, call.args)
    const execution =
      resolved.kind === 'command'
        ? await dependencies.runCommand(
            target.store,
            resolved.value.plugin,
            resolved.value.contribution,
            args,
            context?.signal
          )
        : await dependencies.runExporter(
            target.store,
            resolved.value.plugin,
            resolved.value.contribution,
            context?.signal,
            args
          )
    // Exporters own the last cancellation check before their atomic/durable
    // write boundary. A generic post-write check could report failure after a
    // file was already committed. Commands have no such deferred side effect.
    if (resolved.kind === 'command') throwIfAborted(context?.signal)
    return {
      ok: true,
      result: {
        pluginId: resolved.descriptor.pluginId,
        kind: resolved.kind,
        contributionId: resolved.descriptor.contributionId,
        ...execution
      }
    }
  }

  return { handleList, handleCall }
}
