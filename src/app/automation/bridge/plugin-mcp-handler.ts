import type {
  PluginMCPToolAuthority,
  PluginMCPToolCallDescriptor,
  PluginMCPToolCallRequest
} from '@open-pencil/mcp/plugin-contract'
import {
  parsePluginObjectParameterValue,
  type DeclarativeCommandContributionV2,
  type DeclarativeExporterContributionV2,
  type PluginConnectorOperationV1
} from '@open-pencil/plugin-contracts'
import { canonicalManifestValue } from '@open-pencil/scene-graph'
import type { JSONObject, JSONValue } from '@open-pencil/scene-graph/primitives'

import type { AutomationRequestContext } from '@/app/automation/bridge/request-context'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import type { EditorStore } from '@/app/editor/active-store'
import type { ThirdPartyPluginAIContributionGrant } from '@/app/plugins/ai-authorization'
import {
  appPluginAIAuthorization,
  appPluginStore,
  checkpointAppPluginMarketplacePrivilegeClock,
  withAppPluginPublisherPrivilege
} from '@/app/plugins/app'
import {
  executeInstalledAppConnector,
  isAppConnectorMCPExposed,
  isAppConnectorMCPRefreshEligible,
  refreshAppConnectorCredentialReadiness
} from '@/app/plugins/connectors/app'
import type { ConnectorParameterObject } from '@/app/plugins/connectors/types'
import {
  runInstalledPluginCommand,
  runInstalledPluginExporter,
  type AppPluginHostExecutionResult
} from '@/app/plugins/host'
import {
  isAppPluginMCPConnectorCall,
  listAppPluginMCPTools,
  PLUGIN_MCP_LIMITS,
  resolveAppPluginMCPTool,
  type AppPluginMCPOptions,
  type AppPluginMCPStore,
  type AppPluginMCPToolCatalog,
  type AppPluginMCPToolDescriptor,
  type ResolvedAppPluginMCPTool
} from '@/app/plugins/mcp'
import { inspectInstalledPluginModuleCompatibility } from '@/app/plugins/modules'
import type {
  AppPluginCommandContribution,
  AppPluginExporterContribution,
  InstalledAppPlugin,
  InstalledPluginCommand,
  InstalledPluginConnector,
  InstalledPluginExporter
} from '@/app/plugins/types'

const REQUEST_KEYS = new Set([
  'name',
  'pluginId',
  'expectedCatalogRevision',
  'expectedDescriptor',
  'args'
])
const EXPECTED_DESCRIPTOR_KEYS = new Set([
  'name',
  'title',
  'pluginId',
  'kind',
  'contributionId',
  'authority'
])
const EXPECTED_AUTHORITY_KEYS = new Set([
  'trustSource',
  'packageDigest',
  'pluginVersion',
  'publisherId',
  'publisherKeyId',
  'adapterId'
])
const MODULE_ARGUMENT_KEYS = new Set(['config', 'x', 'y', 'width', 'height', 'name', 'parent_id'])
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const PLUGIN_IDENTITY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA_256_BASE64URL = /^[A-Za-z0-9_-]{43}$/
const APP_BUNDLE_SHA_256 = /^app-bundle-sha256:[A-Za-z0-9_-]{43}$/
const MAX_JSON_DEPTH = 16
const MAX_JSON_VALUES = 4_096
const MAX_CATALOG_REVISION_LENGTH = 256
const MAX_PACKAGE_DIGEST_LENGTH = 128
const MAX_PLUGIN_VERSION_LENGTH = 64

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
  publisherPrivilegeBoundary?<T>(operation: () => Promise<T>): Promise<T>
  checkpointPublisherTrust?(): Promise<unknown>
  /** Readiness-independent host authorization for deciding whether connector status may refresh. */
  connectorRefreshEligibility?: NonNullable<AppPluginMCPOptions['connectorExposure']>
  refreshConnectorCredentialReadiness?(): Promise<void>
  resolvePublisherAIGrant?(
    resolved: Extract<ResolvedAppPluginMCPTool, { kind: 'command' | 'connector' }>
  ): ThirdPartyPluginAIContributionGrant | null
}

export interface AutomationPluginMCPCallOptions {
  /** Require the catalog revision and executable authority on the cross-process MCP boundary. */
  requireExpectedAuthority?: boolean
  /** Synchronous host policy check after live resolution and immediately before dispatch. */
  beforeExecute?: (resolved: ResolvedAppPluginMCPTool) => void
  /** Optional approved AI mutation-lane executor for the normalized core create_module call. */
  executeModule?: (args: Record<string, unknown>) => Promise<unknown>
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

function publisherAIGrant(
  plugin: InstalledAppPlugin,
  kind: 'command' | 'connector',
  contributionId: string,
  adapterId: string
): ThirdPartyPluginAIContributionGrant | null {
  const pluginPackage = plugin.package
  const pluginId = pluginPackage.manifest.plugin.id
  const publisherKeyId =
    pluginPackage.verifiedPackage?.verifiedKeyId ?? pluginPackage.manifest.publisher.keyId
  const grant = appPluginAIAuthorization
    .snapshot()
    .find(
      (candidate) =>
        candidate.pluginId === pluginId &&
        candidate.kind === kind &&
        candidate.contributionId === contributionId &&
        candidate.adapterId === adapterId &&
        candidate.packageDigest === pluginPackage.digest &&
        candidate.pluginVersion === pluginPackage.manifest.plugin.version &&
        candidate.publisherId === pluginPackage.manifest.publisher.id &&
        candidate.publisherKeyId === publisherKeyId
    )
  if (!grant) return null
  try {
    return appPluginAIAuthorization.requireGrant(grant, grant.grantId)
  } catch {
    return null
  }
}

const publisherContributionExposure: NonNullable<
  AppPluginMCPOptions['publisherContributionExposure']
> = (plugin, kind, contributionId, adapterId) =>
  publisherAIGrant(plugin, kind, contributionId, adapterId) !== null

function resolvedPublisherAIGrant(
  resolved: Extract<ResolvedAppPluginMCPTool, { kind: 'command' | 'connector' }>
): ThirdPartyPluginAIContributionGrant | null {
  return publisherAIGrant(
    resolved.value.plugin,
    resolved.kind,
    resolved.descriptor.contributionId,
    resolved.descriptor.authority.adapterId
  )
}

function publisherGrantIdForCall(
  resolved: ResolvedAppPluginMCPTool,
  dependencies: Pick<AutomationPluginMCPDependencies, 'resolvePublisherAIGrant'>
): string | null {
  const descriptor = resolved.descriptor
  if (descriptor.authority.trustSource !== 'publisher-signature') return null
  if (resolved.kind !== 'command' && resolved.kind !== 'connector') {
    throw new Error('Publisher plugin contribution kind is unavailable to MCP')
  }
  const grant = dependencies.resolvePublisherAIGrant?.(resolved)
  if (
    !grant ||
    grant.pluginId !== descriptor.pluginId ||
    grant.kind !== resolved.kind ||
    grant.contributionId !== descriptor.contributionId ||
    grant.adapterId !== descriptor.authority.adapterId ||
    grant.packageDigest !== descriptor.authority.packageDigest ||
    grant.pluginVersion !== descriptor.authority.pluginVersion ||
    grant.publisherId !== descriptor.authority.publisherId ||
    grant.publisherKeyId !== descriptor.authority.publisherKeyId
  ) {
    throw new Error('Third-party plugin AI grant authority changed; review and grant it again')
  }
  return grant.grantId
}

export const DEFAULT_APP_PLUGIN_MCP_OPTIONS: AppPluginMCPOptions = Object.freeze({
  connectorExposure: isAppConnectorMCPExposed,
  connectorNonGetReadOnlyExposure: isAppConnectorMCPExposed,
  publisherContributionExposure
})

const DEFAULT_DEPENDENCIES: AutomationPluginMCPDependencies = Object.freeze({
  store: appPluginStore,
  mcpOptions: DEFAULT_APP_PLUGIN_MCP_OPTIONS,
  runCommand: runDefaultCommand,
  runExporter: runDefaultExporter,
  runConnector: runDefaultConnector,
  publisherPrivilegeBoundary: withAppPluginPublisherPrivilege,
  checkpointPublisherTrust: checkpointAppPluginMarketplacePrivilegeClock,
  connectorRefreshEligibility: isAppConnectorMCPRefreshEligible,
  refreshConnectorCredentialReadiness: () =>
    refreshAppConnectorCredentialReadiness(appPluginStore.installedConnectors()).then(
      () => undefined
    ),
  resolvePublisherAIGrant: resolvedPublisherAIGrant
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

function pluginIdentity(value: unknown, label: string): string {
  const parsed = boundedString(value, label, 128)
  if (!PLUGIN_IDENTITY.test(parsed)) throw new TypeError(`${label} is not a valid identity`)
  return parsed
}

function expectedAuthority(value: unknown): PluginMCPToolAuthority {
  const candidate = exactRecord(
    value,
    'Plugin MCP expected descriptor authority',
    EXPECTED_AUTHORITY_KEYS
  )
  const trustSource = candidate.trustSource
  if (trustSource !== 'app-bundle' && trustSource !== 'publisher-signature') {
    throw new TypeError('Plugin MCP expected descriptor authority trustSource is not supported')
  }
  const packageDigest = boundedString(
    candidate.packageDigest,
    'Plugin MCP expected descriptor package digest',
    MAX_PACKAGE_DIGEST_LENGTH
  )
  const digestPattern = trustSource === 'app-bundle' ? APP_BUNDLE_SHA_256 : SHA_256_BASE64URL
  if (!digestPattern.test(packageDigest)) {
    throw new TypeError('Plugin MCP expected descriptor package digest does not match trustSource')
  }
  const pluginVersion = boundedString(
    candidate.pluginVersion,
    'Plugin MCP expected descriptor plugin version',
    MAX_PLUGIN_VERSION_LENGTH
  )
  const versionMatch = STABLE_SEMVER.exec(pluginVersion)
  if (!versionMatch || !versionMatch.slice(1).every((part) => Number.isSafeInteger(Number(part)))) {
    throw new TypeError('Plugin MCP expected descriptor plugin version must be stable semver')
  }
  return Object.freeze({
    trustSource,
    packageDigest,
    pluginVersion,
    publisherId: pluginIdentity(
      candidate.publisherId,
      'Plugin MCP expected descriptor publisher id'
    ),
    publisherKeyId: pluginIdentity(
      candidate.publisherKeyId,
      'Plugin MCP expected descriptor publisher key id'
    ),
    adapterId: pluginIdentity(candidate.adapterId, 'Plugin MCP expected descriptor adapter id')
  })
}

function expectedCallDescriptor(value: unknown): PluginMCPToolCallDescriptor {
  const candidate = exactRecord(value, 'Plugin MCP expected descriptor', EXPECTED_DESCRIPTOR_KEYS)
  for (const required of ['name', 'pluginId', 'kind', 'contributionId', 'authority']) {
    if (!Object.hasOwn(candidate, required)) {
      throw new TypeError(`Plugin MCP expected descriptor.${required} is required`)
    }
  }
  const kind = candidate.kind
  if (kind !== 'module' && kind !== 'command' && kind !== 'exporter' && kind !== 'connector') {
    throw new TypeError('Plugin MCP expected descriptor kind is not supported')
  }
  return Object.freeze({
    name: boundedString(
      candidate.name,
      'Plugin MCP expected descriptor tool name',
      PLUGIN_MCP_LIMITS.maxToolNameLength
    ),
    ...(candidate.title === undefined
      ? {}
      : {
          title: boundedString(
            candidate.title,
            'Plugin MCP expected descriptor title',
            PLUGIN_MCP_LIMITS.maxTitleLength
          )
        }),
    pluginId: pluginIdentity(candidate.pluginId, 'Plugin MCP expected descriptor plugin id'),
    kind,
    contributionId: pluginIdentity(
      candidate.contributionId,
      'Plugin MCP expected descriptor contribution id'
    ),
    authority: expectedAuthority(candidate.authority)
  })
}

type ParsedPluginMCPRequest = Readonly<
  Omit<PluginMCPToolCallRequest, 'expectedCatalogRevision' | 'expectedDescriptor'> & {
    expectedCatalogRevision?: string
    expectedDescriptor?: PluginMCPToolCallDescriptor
  }
>

function request(value: unknown, requireExpectedAuthority: boolean): ParsedPluginMCPRequest {
  const candidate = exactRecord(value, 'Plugin MCP request', REQUEST_KEYS)
  const name = boundedString(
    candidate.name,
    'Plugin MCP tool name',
    PLUGIN_MCP_LIMITS.maxToolNameLength
  )
  const pluginId = pluginIdentity(candidate.pluginId, 'Plugin MCP plugin id')
  const hasRevision = candidate.expectedCatalogRevision !== undefined
  const hasDescriptor = candidate.expectedDescriptor !== undefined
  if (hasRevision !== hasDescriptor || (requireExpectedAuthority && !hasRevision)) {
    throw new TypeError(
      'Plugin MCP request must include expectedCatalogRevision and expectedDescriptor'
    )
  }
  const expectedCatalogRevision = hasRevision
    ? boundedString(
        candidate.expectedCatalogRevision,
        'Plugin MCP expected catalog revision',
        MAX_CATALOG_REVISION_LENGTH
      )
    : undefined
  const descriptor = hasDescriptor
    ? expectedCallDescriptor(candidate.expectedDescriptor)
    : undefined
  if (descriptor && (descriptor.name !== name || descriptor.pluginId !== pluginId)) {
    throw new TypeError('Plugin MCP expected descriptor does not match the requested tool identity')
  }
  return Object.freeze({
    name,
    pluginId,
    ...(expectedCatalogRevision === undefined
      ? {}
      : { expectedCatalogRevision, expectedDescriptor: descriptor }),
    args: candidate.args === undefined ? {} : candidate.args
  })
}

function callDescriptor(descriptor: AppPluginMCPToolDescriptor): PluginMCPToolCallDescriptor {
  return Object.freeze({
    name: descriptor.name,
    title: descriptor.title,
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

function validateExpectedAuthority(
  call: ParsedPluginMCPRequest,
  liveCatalog: AppPluginMCPToolCatalog,
  resolved: ResolvedAppPluginMCPTool
): void {
  if (!call.expectedCatalogRevision || !call.expectedDescriptor) return
  const liveDescriptor = liveCatalog.tools.find(({ name }) => name === call.name)
  const matchesLive =
    liveCatalog.revision === call.expectedCatalogRevision &&
    liveDescriptor !== undefined &&
    sameCallDescriptor(callDescriptor(liveDescriptor), call.expectedDescriptor)
  const matchesResolved = sameCallDescriptor(
    callDescriptor(resolved.descriptor),
    call.expectedDescriptor
  )
  if (!matchesLive || !matchesResolved) {
    throw new Error(
      `Plugin MCP tool "${call.name}" catalog authority changed; refresh tools/list before calling it`
    )
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
  function withPublisherPrivilege<T>(operation: () => Promise<T>): Promise<T> {
    if (dependencies.publisherPrivilegeBoundary) {
      return dependencies.publisherPrivilegeBoundary(operation)
    }
    return (async () => {
      await dependencies.checkpointPublisherTrust?.()
      return operation()
    })()
  }

  async function handleList(): Promise<{
    ok: true
    result: ReturnType<typeof listAppPluginMCPTools>
  }> {
    return withPublisherPrivilege(async () => {
      await dependencies.refreshConnectorCredentialReadiness?.()
      return {
        ok: true,
        result: listAppPluginMCPTools(dependencies.store, dependencies.mcpOptions)
      }
    })
  }

  type LiveCall = {
    liveCatalog: AppPluginMCPToolCatalog
    resolved: ResolvedAppPluginMCPTool
  }

  function resolveLiveCall(
    call: ParsedPluginMCPRequest,
    context?: AutomationRequestContext
  ): LiveCall | Promise<LiveCall> {
    const refreshEligibility = dependencies.connectorRefreshEligibility
    const classificationOptions = refreshEligibility
      ? {
          ...dependencies.mcpOptions,
          connectorExposure: refreshEligibility,
          connectorNonGetReadOnlyExposure: refreshEligibility
        }
      : dependencies.mcpOptions
    // Classify only the exact installed connector identity through a readiness-independent,
    // host-owned authorization gate. Non-connectors remain synchronous, and unauthorized
    // connectors cannot cause the credential manager to be inspected.
    const connectorCall = isAppPluginMCPConnectorCall(
      dependencies.store,
      call.name,
      call.pluginId,
      classificationOptions
    )
    if (!connectorCall) {
      const liveCatalog = listAppPluginMCPTools(dependencies.store, dependencies.mcpOptions)
      const resolved = resolveAppPluginMCPTool(
        dependencies.store,
        call.name,
        call.pluginId,
        dependencies.mcpOptions
      )
      if (resolved.kind === 'connector') {
        throw new Error('Plugin connector MCP refresh authorization is unavailable')
      }
      return { liveCatalog, resolved }
    }
    return (async () => {
      await dependencies.refreshConnectorCredentialReadiness?.()
      throwIfAborted(context?.signal)
      const refreshedCatalog = listAppPluginMCPTools(dependencies.store, dependencies.mcpOptions)
      const refreshed = resolveAppPluginMCPTool(
        dependencies.store,
        call.name,
        call.pluginId,
        dependencies.mcpOptions
      )
      if (refreshed.kind !== 'connector') {
        throw new Error('Plugin MCP connector authority changed during credential refresh')
      }
      return { liveCatalog: refreshedCatalog, resolved: refreshed }
    })()
  }

  async function executeResolvedCall(
    target: AutomationTarget,
    call: ParsedPluginMCPRequest,
    context: AutomationRequestContext | undefined,
    options: AutomationPluginMCPCallOptions,
    { liveCatalog, resolved }: LiveCall
  ): Promise<unknown> {
    throwIfAborted(context?.signal)
    // The stable tool name intentionally excludes package revision. Bind the cross-process call to
    // the exact catalog and executable authority after live resolution, immediately before policy
    // checks and dispatch, so a digest/key/version/adapter replacement fails closed.
    validateExpectedAuthority(call, liveCatalog, resolved)
    const resolvedDescriptor = callDescriptor(resolved.descriptor)
    const publisherGrantId = publisherGrantIdForCall(resolved, dependencies)
    context?.onPluginMCPResolved?.(resolvedDescriptor, publisherGrantId)
    options.beforeExecute?.(resolved)
    if (resolved.kind === 'module') {
      const args = moduleArguments(call.args)
      if (args.config !== undefined) {
        const compatibility = inspectInstalledPluginModuleCompatibility(resolved.value)
        if (!compatibility.ok) throw new Error(compatibility.reason)
        compatibility.definition.createInstance(args.config)
      }
      const createArgs = {
        ...args,
        plugin_id: resolved.descriptor.pluginId,
        module_type: resolved.descriptor.contributionId
      }
      return options.executeModule
        ? options.executeModule(createArgs)
        : handleAutomationTool(target, { name: 'create_module', args: createArgs }, context)
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

  async function handleCall(
    target: AutomationTarget,
    rawRequest: unknown,
    context?: AutomationRequestContext,
    options: AutomationPluginMCPCallOptions = {}
  ): Promise<unknown> {
    throwIfAborted(context?.signal)
    const call = request(rawRequest, options.requireExpectedAuthority === true)
    return withPublisherPrivilege(async () => {
      throwIfAborted(context?.signal)
      // Rebuild and resolve from current installed state for every invocation. A descriptor cached by
      // an MCP client cannot outlive disable/uninstall or a trust/compatibility change.
      const live = resolveLiveCall(call, context)
      return live instanceof Promise
        ? live.then((resolved) => executeResolvedCall(target, call, context, options, resolved))
        : executeResolvedCall(target, call, context, options, live)
    })
  }

  return { handleList, handleCall }
}
