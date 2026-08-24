import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_LIMITS,
  PLUGIN_RUNTIME_CAPABILITIES,
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_PACKAGE_LIMITS,
  type PluginConnectorContractV1,
  type PluginManifest,
  type SignedPluginRuntimePackageV1,
  type VerifiedPluginRuntimePackage
} from '@open-pencil/plugin-contracts'
import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  parseStableSemver
} from '@open-pencil/scene-graph'

import { MARKETPLACE_ARTIFACT_LIMITS } from './artifacts'
import { MARKETPLACE_CONTROL_SCHEMA_VERSION } from './control-contract'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplaceIdentity,
  parseMarketplaceReleaseCoordinate,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceSubmissionV1
} from './types'

export interface MarketplaceConnectorPresentationV1 {
  readonly connectorId: string
  readonly name: string
  readonly kind: 'data-source' | 'action' | 'asset-provider'
  readonly adapterId: string
  readonly origins: readonly string[]
  readonly originTemplates: readonly string[]
  readonly methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  readonly credentialKinds: readonly ('api-key' | 'bearer-token' | 'oauth2')[]
  readonly operationIds: readonly string[]
}

export interface MarketplaceManifestPresentationV1 {
  readonly format: typeof PLUGIN_MANIFEST_FORMAT
  readonly schemaVersion: 1 | 2
  readonly plugin: Readonly<{ id: string; name: string; version: string }>
  readonly publisher: Readonly<{ id: string; name: string; keyId: string }>
  readonly engineRange: string
  readonly permissions: readonly string[]
  readonly moduleTypes: readonly string[]
  readonly commandIds: readonly string[]
  readonly exporterIds: readonly string[]
  readonly storageProviderIds: readonly string[]
  readonly connectors: readonly MarketplaceConnectorPresentationV1[]
}

export interface MarketplaceRuntimePresentationV1 {
  readonly packageDigest: string
  readonly artifactDigest: string
  readonly byteLength: number
  readonly kind: 'wasm' | 'javascript'
  readonly abi: string
  readonly capabilities: readonly string[]
  readonly limits: Readonly<{
    timeoutMs: number
    maxInputBytes: number
    maxOutputBytes: number
    maxMemoryPages: number
  }>
  readonly asset: Readonly<{
    mediaType: 'application/wasm' | 'text/javascript'
    byteLength: number
    digest: string
  }>
  readonly executionStatus: 'eligible' | 'runtime-unavailable'
  readonly executionReason: string | null
}

export interface MarketplaceSubmissionPresentationV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly submissionId: string
  readonly publisherId: string
  readonly revision: number
  readonly coordinate: MarketplaceReleaseCoordinateV1
  readonly manifest: MarketplaceManifestPresentationV1
  readonly runtime: MarketplaceRuntimePresentationV1 | null
}

export interface VerifiedMarketplaceRuntimePresentationInput {
  readonly artifactDigest: string
  readonly byteLength: number
  readonly runtimePackage: SignedPluginRuntimePackageV1
  readonly verification: VerifiedPluginRuntimePackage
}

const ROOT_KEYS = new Set([
  'schemaVersion',
  'submissionId',
  'publisherId',
  'revision',
  'coordinate',
  'manifest',
  'runtime'
])
const MANIFEST_KEYS = new Set([
  'format',
  'schemaVersion',
  'plugin',
  'publisher',
  'engineRange',
  'permissions',
  'moduleTypes',
  'commandIds',
  'exporterIds',
  'storageProviderIds',
  'connectors'
])
const PLUGIN_KEYS = new Set(['id', 'name', 'version'])
const PUBLISHER_KEYS = new Set(['id', 'name', 'keyId'])
const CONNECTOR_KEYS = new Set([
  'connectorId',
  'name',
  'kind',
  'adapterId',
  'origins',
  'originTemplates',
  'methods',
  'credentialKinds',
  'operationIds'
])
const RUNTIME_KEYS = new Set([
  'packageDigest',
  'artifactDigest',
  'byteLength',
  'kind',
  'abi',
  'capabilities',
  'limits',
  'asset',
  'executionStatus',
  'executionReason'
])
const LIMIT_KEYS = new Set(['timeoutMs', 'maxInputBytes', 'maxOutputBytes', 'maxMemoryPages'])
const ASSET_KEYS = new Set(['mediaType', 'byteLength', 'digest'])
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const CREDENTIAL_KINDS = new Set(['api-key', 'bearer-token', 'oauth2'])
const CONNECTOR_KINDS = new Set(['data-source', 'action', 'asset-provider'])
const PERMISSIONS = new Set([
  'document.read',
  'document.selection.read',
  'document.variables.read',
  'file.save'
])
const RUNTIME_CAPABILITIES = new Set<string>(PLUGIN_RUNTIME_CAPABILITIES)

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort())
}

function text(value: unknown, path: string, maximum = 2_048): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    new TextEncoder().encode(value).byteLength > maximum ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)
      return code !== undefined && (code <= 0x1f || code === 0x7f)
    })
  ) {
    throw new TypeError(`${path} must be bounded text without control characters`)
  }
  return value
}

function positive(value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

function stringArray(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, path: string) => string
): readonly string[] {
  const entries = parseBoundedManifestArray(value, path, maximum).map((entry, index) =>
    parse(entry, `${path}[${index}]`)
  )
  if (
    new Set(entries).size !== entries.length ||
    [...entries].sort().join('\0') !== entries.join('\0')
  ) {
    throw new TypeError(`${path} must be sorted and unique`)
  }
  return Object.freeze(entries)
}

function identityArray(value: unknown, path: string, maximum: number): readonly string[] {
  return stringArray(value, path, maximum, parseMarketplaceIdentity)
}

function enumArray(
  value: unknown,
  path: string,
  maximum: number,
  allowed: ReadonlySet<string>
): readonly string[] {
  return stringArray(value, path, maximum, (entry, entryPath) => {
    if (typeof entry !== 'string' || !allowed.has(entry)) {
      throw new TypeError(`${entryPath} is not supported`)
    }
    return entry
  })
}

function connectorProjection(
  contract: PluginConnectorContractV1
): MarketplaceConnectorPresentationV1 {
  return Object.freeze({
    connectorId: contract.connectorId,
    name: contract.name,
    kind: contract.kind,
    adapterId: contract.adapterId,
    origins: sortedUnique(contract.network.origins),
    originTemplates: sortedUnique(contract.network.originTemplates ?? []),
    methods: sortedUnique(
      contract.network.methods
    ) as MarketplaceConnectorPresentationV1['methods'],
    credentialKinds: sortedUnique(
      contract.credentialSlots.map(({ kind }) => kind)
    ) as MarketplaceConnectorPresentationV1['credentialKinds'],
    operationIds: sortedUnique(contract.operations.map(({ operationId }) => operationId))
  })
}

function manifestProjection(manifest: PluginManifest): MarketplaceManifestPresentationV1 {
  const commands = manifest.contributions.commands ?? []
  const exporters = manifest.contributions.exporters ?? []
  const version2 = manifest.schemaVersion === 2 ? manifest : null
  return Object.freeze({
    format: manifest.format,
    schemaVersion: manifest.schemaVersion,
    plugin: Object.freeze({ ...manifest.plugin }),
    publisher: Object.freeze({ ...manifest.publisher }),
    engineRange: manifest.engineRange,
    permissions: sortedUnique([
      ...(version2?.contributions.commands ?? []).flatMap(({ permissions }) => permissions),
      ...(version2?.contributions.exporters ?? []).flatMap(({ permissions }) => permissions)
    ]),
    moduleTypes: sortedUnique(manifest.contributions.modules.map(({ moduleType }) => moduleType)),
    commandIds: sortedUnique(commands.map(({ commandId }) => commandId)),
    exporterIds: sortedUnique(exporters.map(({ exporterId }) => exporterId)),
    storageProviderIds: sortedUnique(
      (version2?.contributions.storageProviders ?? []).map(({ providerId }) => providerId)
    ),
    connectors: Object.freeze(
      (version2?.contributions.connectors ?? [])
        .map(connectorProjection)
        .sort((left, right) => left.connectorId.localeCompare(right.connectorId))
    )
  })
}

function runtimeProjection(
  input: VerifiedMarketplaceRuntimePresentationInput
): MarketplaceRuntimePresentationV1 {
  const { runtime } = input.runtimePackage
  return Object.freeze({
    packageDigest: input.verification.verifiedDigest,
    artifactDigest: input.artifactDigest,
    byteLength: input.byteLength,
    kind: runtime.kind,
    abi: runtime.abi,
    capabilities: sortedUnique(runtime.capabilities),
    limits: Object.freeze({ ...runtime.limits }),
    asset: Object.freeze({
      mediaType: runtime.asset.mediaType,
      byteLength: runtime.asset.byteLength,
      digest: runtime.asset.digest
    }),
    executionStatus: input.verification.executionStatus,
    executionReason: input.verification.executionReason
  })
}

export function createMarketplaceSubmissionPresentation(
  submission: MarketplaceSubmissionV1,
  manifest: PluginManifest,
  runtime: VerifiedMarketplaceRuntimePresentationInput | null
): MarketplaceSubmissionPresentationV1 {
  return parseMarketplaceSubmissionPresentation({
    schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
    submissionId: submission.id,
    publisherId: submission.publisherId,
    revision: submission.revision,
    coordinate: submission.coordinate,
    manifest: manifestProjection(manifest),
    runtime: runtime ? runtimeProjection(runtime) : null
  })
}

function parseConnector(value: unknown, path: string): MarketplaceConnectorPresentationV1 {
  const source = parseExactManifestRecord(value, path, CONNECTOR_KEYS)
  if (typeof source.kind !== 'string' || !CONNECTOR_KINDS.has(source.kind)) {
    throw new TypeError(`${path}.kind is not supported`)
  }
  return Object.freeze({
    connectorId: parseMarketplaceIdentity(source.connectorId, `${path}.connectorId`),
    name: text(source.name, `${path}.name`, PLUGIN_MANIFEST_LIMITS.maxNameLength),
    kind: source.kind as MarketplaceConnectorPresentationV1['kind'],
    adapterId: parseMarketplaceIdentity(source.adapterId, `${path}.adapterId`),
    origins: stringArray(source.origins, `${path}.origins`, 64, (entry, entryPath) =>
      text(entry, entryPath, 2_048)
    ),
    originTemplates: stringArray(
      source.originTemplates,
      `${path}.originTemplates`,
      64,
      (entry, entryPath) => text(entry, entryPath, 2_048)
    ),
    methods: enumArray(
      source.methods,
      `${path}.methods`,
      METHODS.size,
      METHODS
    ) as MarketplaceConnectorPresentationV1['methods'],
    credentialKinds: enumArray(
      source.credentialKinds,
      `${path}.credentialKinds`,
      CREDENTIAL_KINDS.size,
      CREDENTIAL_KINDS
    ) as MarketplaceConnectorPresentationV1['credentialKinds'],
    operationIds: identityArray(source.operationIds, `${path}.operationIds`, 128)
  })
}

function parseManifest(value: unknown, path: string): MarketplaceManifestPresentationV1 {
  const source = parseExactManifestRecord(value, path, MANIFEST_KEYS)
  if (
    source.format !== PLUGIN_MANIFEST_FORMAT ||
    (source.schemaVersion !== 1 && source.schemaVersion !== 2)
  ) {
    throw new TypeError(`${path} schema is not supported`)
  }
  const plugin = parseExactManifestRecord(source.plugin, `${path}.plugin`, PLUGIN_KEYS)
  const publisher = parseExactManifestRecord(source.publisher, `${path}.publisher`, PUBLISHER_KEYS)
  const connectors = parseBoundedManifestArray(
    source.connectors,
    `${path}.connectors`,
    PLUGIN_MANIFEST_LIMITS.maxConnectors
  ).map((entry, index) => parseConnector(entry, `${path}.connectors[${index}]`))
  if (
    connectors.some((entry, index) => {
      return index > 0 && connectors[index - 1].connectorId >= entry.connectorId
    })
  ) {
    throw new TypeError(`${path}.connectors must be sorted and unique`)
  }
  return Object.freeze({
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: source.schemaVersion,
    plugin: Object.freeze({
      id: parseMarketplaceIdentity(plugin.id, `${path}.plugin.id`),
      name: text(plugin.name, `${path}.plugin.name`, PLUGIN_MANIFEST_LIMITS.maxNameLength),
      version: parseStableSemver(plugin.version, `${path}.plugin.version`)
    }),
    publisher: Object.freeze({
      id: parseMarketplaceIdentity(publisher.id, `${path}.publisher.id`),
      name: text(publisher.name, `${path}.publisher.name`, PLUGIN_MANIFEST_LIMITS.maxNameLength),
      keyId: parseMarketplaceIdentity(publisher.keyId, `${path}.publisher.keyId`)
    }),
    engineRange: text(
      source.engineRange,
      `${path}.engineRange`,
      PLUGIN_MANIFEST_LIMITS.maxEngineRangeLength
    ),
    permissions: enumArray(
      source.permissions,
      `${path}.permissions`,
      PERMISSIONS.size,
      PERMISSIONS
    ),
    moduleTypes: identityArray(
      source.moduleTypes,
      `${path}.moduleTypes`,
      PLUGIN_MANIFEST_LIMITS.maxModules
    ),
    commandIds: identityArray(
      source.commandIds,
      `${path}.commandIds`,
      PLUGIN_MANIFEST_LIMITS.maxCommands
    ),
    exporterIds: identityArray(
      source.exporterIds,
      `${path}.exporterIds`,
      PLUGIN_MANIFEST_LIMITS.maxExporters
    ),
    storageProviderIds: identityArray(
      source.storageProviderIds,
      `${path}.storageProviderIds`,
      PLUGIN_MANIFEST_LIMITS.maxStorageProviders
    ),
    connectors: Object.freeze(connectors)
  })
}

function parseRuntime(value: unknown, path: string): MarketplaceRuntimePresentationV1 {
  const source = parseExactManifestRecord(value, path, RUNTIME_KEYS)
  const limits = parseExactManifestRecord(source.limits, `${path}.limits`, LIMIT_KEYS)
  const asset = parseExactManifestRecord(source.asset, `${path}.asset`, ASSET_KEYS)
  const compatibleAsset =
    (source.kind === 'wasm' && asset.mediaType === 'application/wasm') ||
    (source.kind === 'javascript' && asset.mediaType === 'text/javascript')
  const compatibleExecutionReason =
    (source.executionStatus === 'eligible' && source.executionReason === null) ||
    (source.executionStatus === 'runtime-unavailable' && typeof source.executionReason === 'string')
  if (
    (source.kind !== 'wasm' && source.kind !== 'javascript') ||
    (asset.mediaType !== 'application/wasm' && asset.mediaType !== 'text/javascript') ||
    source.abi !== PLUGIN_RUNTIME_COMPUTE_ABI ||
    !compatibleAsset ||
    (source.executionStatus !== 'eligible' && source.executionStatus !== 'runtime-unavailable') ||
    !compatibleExecutionReason
  ) {
    throw new TypeError(`${path} contains unsupported runtime metadata`)
  }
  return Object.freeze({
    packageDigest: parseSha256Base64URL(source.packageDigest, `${path}.packageDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    byteLength: positive(
      source.byteLength,
      `${path}.byteLength`,
      MARKETPLACE_ARTIFACT_LIMITS.maxBytes
    ),
    kind: source.kind,
    abi: source.abi,
    capabilities: enumArray(
      source.capabilities,
      `${path}.capabilities`,
      PLUGIN_RUNTIME_PACKAGE_LIMITS.maxCapabilities,
      RUNTIME_CAPABILITIES
    ),
    limits: Object.freeze({
      timeoutMs: positive(
        limits.timeoutMs,
        `${path}.limits.timeoutMs`,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxTimeoutMs
      ),
      maxInputBytes: positive(
        limits.maxInputBytes,
        `${path}.limits.maxInputBytes`,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxInputBytes
      ),
      maxOutputBytes: positive(
        limits.maxOutputBytes,
        `${path}.limits.maxOutputBytes`,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxOutputBytes
      ),
      maxMemoryPages: positive(
        limits.maxMemoryPages,
        `${path}.limits.maxMemoryPages`,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxMemoryPages
      )
    }),
    asset: Object.freeze({
      mediaType: asset.mediaType,
      byteLength: positive(
        asset.byteLength,
        `${path}.asset.byteLength`,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxAssetBytes
      ),
      digest: parseSha256Base64URL(asset.digest, `${path}.asset.digest`)
    }),
    executionStatus: source.executionStatus,
    executionReason:
      source.executionReason === null
        ? null
        : text(source.executionReason, `${path}.executionReason`, 2_048)
  })
}

export function parseMarketplaceRuntimePresentation(
  value: unknown,
  path = 'marketplaceControl.runtimePresentation'
): MarketplaceRuntimePresentationV1 {
  return parseRuntime(value, path)
}

export function parseMarketplaceSubmissionPresentation(
  value: unknown,
  path = 'marketplaceControl.submissionPresentation'
): MarketplaceSubmissionPresentationV1 {
  const source = parseExactManifestRecord(value, path, ROOT_KEYS)
  const coordinate = parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`)
  if (!MARKETPLACE_RELEASE_CHANNELS.includes(coordinate.channel)) {
    throw new TypeError(`${path}.coordinate.channel is not supported`)
  }
  const manifest = parseManifest(source.manifest, `${path}.manifest`)
  const publisherId = parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`)
  if (
    manifest.publisher.id !== publisherId ||
    manifest.plugin.id !== coordinate.pluginId ||
    manifest.plugin.version !== coordinate.version
  ) {
    throw new TypeError(`${path} manifest identity does not match the submission`)
  }
  return Object.freeze({
    schemaVersion:
      source.schemaVersion === MARKETPLACE_CONTROL_SCHEMA_VERSION
        ? MARKETPLACE_CONTROL_SCHEMA_VERSION
        : (() => {
            throw new TypeError(`${path}.schemaVersion is not supported`)
          })(),
    submissionId: parseMarketplaceIdentity(source.submissionId, `${path}.submissionId`),
    publisherId,
    revision: positive(source.revision, `${path}.revision`),
    coordinate,
    manifest,
    runtime: source.runtime === null ? null : parseRuntime(source.runtime, `${path}.runtime`)
  })
}
