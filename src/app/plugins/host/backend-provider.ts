import {
  compile,
  type CompilerBackendProviderRequest,
  type CompilerInput,
  type CompilerOptions,
  type CompilerOutput
} from '@open-pencil/compiler'
import {
  BACKEND_PROVIDER_OUTPUT_KINDS,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  emitBackendProviderPlan,
  parseBackendProviderDescriptor,
  type BackendProviderEmission,
  type BackendProviderPlan,
  type BackendProviderSelection
} from '@open-pencil/compiler/backend'
import {
  BACKEND_CAPABILITIES,
  BACKEND_LIMITS,
  containsBackendSecretLikeMaterial,
  normalizeBackendReleaseProviderAuthority,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1,
  type BackendDiagnostic,
  type BackendReleaseProviderAuthorityV1
} from '@open-pencil/lowcode/backend'
import {
  PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
  PLUGIN_BACKEND_PROVIDER_MODEL_VERSION,
  parsePluginObjectParameterValue,
  parsePluginBackendProviderContribution,
  type DeclarativeCommandContributionV2,
  type PluginContributionDataContractV2,
  type PluginBackendProviderCapabilityV1,
  type PluginBackendProviderContributionV1,
  type PluginBackendProviderOutputKindV1
} from '@open-pencil/plugin-contracts'
import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  parseStableSemver,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import type { JSONTraversalState } from '../json-data'
import {
  parseAppPluginMarketplaceAuthority,
  type AppPluginMarketplaceAuthority,
  type AppPluginTrustSource,
  type InstalledPluginBackendProvider
} from '../types'
import { sameJSONAuthority } from './contribution-authority'

export const SUPABASE_BACKEND_PROVIDER_PLUGIN_ID = 'open-pencil.supabase-backend'
export const SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID = 'supabase.backend'
export const SUPABASE_BACKEND_PROVIDER_ID = 'supabase'
export const SUPABASE_BACKEND_PROVIDER_ADAPTER_ID = 'open-pencil.backend.supabase'
export const SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION = '1.0.0'
/** Exact digest of the App catalog Manifest v2 package; it is not CLI Provider authority. */
export const SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST =
  'app-bundle-sha256:oxf6nxbfP0XtWueDMqehuuGEjh5x16kycW886fkEfgs'
export const SUPABASE_BACKEND_PROVIDER_CAPABILITIES = Object.freeze([
  'auth.identity',
  'auth.roles',
  'data.read',
  'data.write',
  'migrations.schema',
  'policy.row-level',
  'server.functions',
  'server.http',
  'storage.objects'
] as const satisfies readonly PluginBackendProviderCapabilityV1[])

export const SUPABASE_BACKEND_PROVIDER_CONTRIBUTION = parsePluginBackendProviderContribution({
  providerId: SUPABASE_BACKEND_PROVIDER_ID,
  contributionId: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID,
  name: 'Supabase Backend',
  description:
    'Emits deterministic Supabase backend artifacts through the host-reviewed compiler adapter.',
  adapterId: SUPABASE_BACKEND_PROVIDER_ADAPTER_ID,
  contractVersion: PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION,
  supportedModelVersions: [PLUGIN_BACKEND_PROVIDER_MODEL_VERSION],
  capabilities: SUPABASE_BACKEND_PROVIDER_CAPABILITIES,
  configuration: {
    schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
      maxProperties: 0
    },
    maxBytes: 2
  },
  outputKinds: [
    'client-config',
    'database-schema',
    'deployment-manifest',
    'migration-plan',
    'security-policy',
    'server-runtime'
  ],
  permissions: []
})

export const APP_BACKEND_PROVIDER_MCP_OPERATIONS = Object.freeze(['audit', 'plan'] as const)
export type AppBackendProviderMCPOperation = (typeof APP_BACKEND_PROVIDER_MCP_OPERATIONS)[number]

export const APP_BACKEND_PROVIDER_MCP_TARGETS = Object.freeze([
  'react',
  'vue',
  'expo',
  'flutter',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
] as const)
export const APP_BACKEND_PROVIDER_MCP_MODES = Object.freeze([
  'preview',
  'source-only-prototype',
  'production'
] as const)
export const APP_BACKEND_PROVIDER_MCP_RESULT_FORMAT =
  'openpencil.backend-provider-mcp-result.v1' as const

const BACKEND_PROVIDER_MCP_PARAMETERS = Object.freeze({
  schema: Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      target: Object.freeze({
        type: 'string' as const,
        enum: APP_BACKEND_PROVIDER_MCP_TARGETS
      }),
      mode: Object.freeze({
        type: 'string' as const,
        enum: APP_BACKEND_PROVIDER_MCP_MODES
      })
    }),
    required: Object.freeze(['target', 'mode']),
    additionalProperties: false as const,
    minProperties: 2,
    maxProperties: 2
  }),
  maxBytes: 256
}) satisfies PluginContributionDataContractV2

const BACKEND_PROVIDER_MCP_NON_NEGATIVE_INTEGER = Object.freeze({
  type: 'integer' as const,
  minimum: 0
})
const BACKEND_PROVIDER_MCP_DIGEST = Object.freeze({
  type: 'string' as const,
  minLength: 43,
  maxLength: 128
})
const BACKEND_PROVIDER_MCP_IDENTITY = Object.freeze({
  type: 'string' as const,
  minLength: 1,
  maxLength: 128
})
const BACKEND_PROVIDER_MCP_CAPABILITY_DECISION = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    capability: Object.freeze({ type: 'string' as const, enum: BACKEND_CAPABILITIES }),
    required: Object.freeze({ type: 'boolean' as const }),
    providerSupported: Object.freeze({ type: 'boolean' as const }),
    targetStatus: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze([
        'supported',
        'source-only',
        'unsupported',
        'requires-server-bridge'
      ] as const)
    }),
    resolution: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze([
        'supported',
        'source-only',
        'unsupported',
        'requires-server-bridge'
      ] as const)
    }),
    included: Object.freeze({ type: 'boolean' as const })
  }),
  required: Object.freeze([
    'capability',
    'required',
    'providerSupported',
    'targetStatus',
    'resolution',
    'included'
  ]),
  additionalProperties: false as const,
  minProperties: 6,
  maxProperties: 6
})
const BACKEND_PROVIDER_MCP_DIAGNOSTICS = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    errorCount: BACKEND_PROVIDER_MCP_NON_NEGATIVE_INTEGER,
    warningCount: BACKEND_PROVIDER_MCP_NON_NEGATIVE_INTEGER,
    infoCount: BACKEND_PROVIDER_MCP_NON_NEGATIVE_INTEGER
  }),
  required: Object.freeze(['errorCount', 'warningCount', 'infoCount']),
  additionalProperties: false as const,
  minProperties: 3,
  maxProperties: 3
})
const BACKEND_PROVIDER_MCP_SAFETY = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    credentialResolution: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze(['forbidden'] as const)
    }),
    sideEffects: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze(['none'] as const)
    }),
    applyAvailable: Object.freeze({
      type: 'boolean' as const,
      enum: Object.freeze([false] as const)
    })
  }),
  required: Object.freeze(['credentialResolution', 'sideEffects', 'applyAvailable']),
  additionalProperties: false as const,
  minProperties: 3,
  maxProperties: 3
})

function backendProviderMCPResultContract(
  operation: AppBackendProviderMCPOperation
): PluginContributionDataContractV2 {
  const planProperties =
    operation === 'plan'
      ? {
          plannedAdapterCount: BACKEND_PROVIDER_MCP_NON_NEGATIVE_INTEGER,
          outputKinds: Object.freeze({
            type: 'array' as const,
            items: Object.freeze({
              type: 'string' as const,
              enum: BACKEND_PROVIDER_OUTPUT_KINDS
            }),
            maxItems: BACKEND_PROVIDER_OUTPUT_KINDS.length
          }),
          externalRequirementCount: BACKEND_PROVIDER_MCP_NON_NEGATIVE_INTEGER
        }
      : {}
  const required = [
    'format',
    'operation',
    'status',
    'pluginId',
    'contributionId',
    'providerId',
    'adapterId',
    'adapterVersion',
    'packageDigest',
    'target',
    'mode',
    'applicationDigest',
    'planDigest',
    'capabilities',
    'diagnostics',
    'safety',
    ...(operation === 'plan'
      ? ['plannedAdapterCount', 'outputKinds', 'externalRequirementCount']
      : [])
  ]
  return Object.freeze({
    schema: Object.freeze({
      type: 'object' as const,
      properties: Object.freeze({
        format: Object.freeze({
          type: 'string' as const,
          enum: Object.freeze([APP_BACKEND_PROVIDER_MCP_RESULT_FORMAT] as const)
        }),
        operation: Object.freeze({
          type: 'string' as const,
          enum: Object.freeze([operation])
        }),
        status: Object.freeze({
          type: 'string' as const,
          enum: Object.freeze(['ready'] as const)
        }),
        pluginId: BACKEND_PROVIDER_MCP_IDENTITY,
        contributionId: BACKEND_PROVIDER_MCP_IDENTITY,
        providerId: BACKEND_PROVIDER_MCP_IDENTITY,
        adapterId: BACKEND_PROVIDER_MCP_IDENTITY,
        adapterVersion: Object.freeze({ type: 'string' as const, minLength: 5, maxLength: 64 }),
        packageDigest: BACKEND_PROVIDER_MCP_DIGEST,
        target: Object.freeze({ type: 'string' as const, enum: APP_BACKEND_PROVIDER_MCP_TARGETS }),
        mode: Object.freeze({ type: 'string' as const, enum: APP_BACKEND_PROVIDER_MCP_MODES }),
        applicationDigest: BACKEND_PROVIDER_MCP_DIGEST,
        planDigest: BACKEND_PROVIDER_MCP_DIGEST,
        capabilities: Object.freeze({
          type: 'array' as const,
          items: BACKEND_PROVIDER_MCP_CAPABILITY_DECISION,
          maxItems: BACKEND_CAPABILITIES.length
        }),
        diagnostics: BACKEND_PROVIDER_MCP_DIAGNOSTICS,
        safety: BACKEND_PROVIDER_MCP_SAFETY,
        ...planProperties
      }),
      required: Object.freeze(required),
      additionalProperties: false as const,
      minProperties: required.length,
      maxProperties: required.length
    }),
    maxBytes: 32 * 1024
  }) as PluginContributionDataContractV2
}

function backendProviderMCPCommand(
  operation: AppBackendProviderMCPOperation
): DeclarativeCommandContributionV2 {
  const capitalized = operation === 'audit' ? 'Audit' : 'Plan'
  return Object.freeze({
    commandId: `${operation}-backend-provider`,
    adapterId: `${SUPABASE_BACKEND_PROVIDER_ADAPTER_ID}.${operation}`,
    name: `${capitalized} Supabase Backend Provider`,
    description:
      operation === 'audit'
        ? 'Run a bounded local Backend Provider audit without credentials or remote side effects; return only authority, digest, capability, and diagnostic summary data.'
        : 'Create a bounded local Backend Provider plan without credentials or remote side effects; return only plan metadata and emit no backend artifacts.',
    parameters: BACKEND_PROVIDER_MCP_PARAMETERS,
    result: backendProviderMCPResultContract(operation),
    permissions: Object.freeze(['document.read'] as const)
  })
}

export const APP_BACKEND_PROVIDER_MCP_COMMANDS = Object.freeze({
  audit: backendProviderMCPCommand('audit'),
  plan: backendProviderMCPCommand('plan')
})

export const APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID = 'open-pencil'
export const APP_BACKEND_PROVIDER_DOCUMENT_KEY = 'lowcode/backendProvider.v1'
export const APP_BACKEND_PROVIDER_REQUEST_FORMAT = 'openpencil.backend-provider-request.v1'

export interface AppBackendProviderMCPPolicy {
  readonly operations: readonly AppBackendProviderMCPOperation[]
  readonly credentials: 'forbidden'
  readonly sideEffects: 'none'
}

export interface AppBackendProviderPackageAuthority {
  readonly trustSource: AppPluginTrustSource
  readonly publisherId: string
  readonly publisherKeyId: string
  readonly packageDigest: string
  readonly pluginVersion: string
  readonly pinnedDigest: string | null
  readonly marketplaceAuthority: AppPluginMarketplaceAuthority | null
}

/**
 * Pure authority descriptor for a host-reviewed provider adapter. It deliberately contains no
 * executor, CredentialResolver, endpoint, migration SQL, network callback, or deployment command.
 * Callers must resolve the descriptor against the live store again immediately before use.
 */
export interface AppBackendProviderDescriptor {
  readonly descriptorVersion: 1
  readonly packageAuthority: AppBackendProviderPackageAuthority
  readonly pluginId: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: typeof PLUGIN_BACKEND_PROVIDER_CONTRACT_VERSION
  readonly supportedModelVersions: readonly [typeof PLUGIN_BACKEND_PROVIDER_MODEL_VERSION]
  readonly capabilities: readonly PluginBackendProviderCapabilityV1[]
  readonly configuration: PluginBackendProviderContributionV1['configuration']
  readonly outputKinds: readonly PluginBackendProviderOutputKindV1[]
  readonly permissions: readonly []
  readonly mcp: AppBackendProviderMCPPolicy
}

export type AppBackendProviderCompatibilityStatus =
  | 'compatible'
  | 'inactive'
  | 'trust-source-mismatch'
  | 'publisher-mismatch'
  | 'publisher-key-mismatch'
  | 'package-authority-invalid'
  | 'package-digest-mismatch'
  | 'digest-pin-mismatch'
  | 'untrusted-adapter'
  | 'plugin-identity-mismatch'
  | 'plugin-version-mismatch'
  | 'contribution-identity-mismatch'
  | 'declaration-mismatch'

export type AppBackendProviderCompatibility =
  | Readonly<{
      ok: true
      status: 'compatible'
      descriptor: AppBackendProviderDescriptor
    }>
  | Readonly<{
      ok: false
      status: Exclude<AppBackendProviderCompatibilityStatus, 'compatible'>
      reason: string
    }>

interface ReviewedBackendProviderAdapter {
  readonly trustSource: 'app-bundle'
  readonly publisherId: string
  readonly publisherKeyId: string
  readonly pluginId: string
  readonly pluginVersion: string
  readonly adapterVersion: string
  readonly packageDigest: string
  readonly contribution: PluginBackendProviderContributionV1
}

const REVIEWED_BACKEND_PROVIDER_ADAPTERS = new Map<string, ReviewedBackendProviderAdapter>([
  [
    SUPABASE_BACKEND_PROVIDER_ADAPTER_ID,
    Object.freeze({
      trustSource: 'app-bundle',
      publisherId: 'open-pencil',
      publisherKeyId: 'app-bundle-v1',
      pluginId: SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
      pluginVersion: '1.0.0',
      adapterVersion: SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION,
      packageDigest: SUPABASE_BACKEND_PROVIDER_PACKAGE_DIGEST,
      contribution: SUPABASE_BACKEND_PROVIDER_CONTRIBUTION
    })
  ]
])

export interface AppBackendProviderHostStore {
  installedBackendProviders(): readonly InstalledPluginBackendProvider[]
}

export interface AppBackendProviderBuildRequest {
  readonly format: typeof APP_BACKEND_PROVIDER_REQUEST_FORMAT
  readonly selection: AppBackendProviderDescriptor
  readonly application: BackendApplicationSpecV1
}

export interface AppBackendProviderBuildOptions {
  readonly target: BackendProviderPlan['target']
  readonly mode: BackendProviderPlan['mode']
}

export interface PreparedAppBackendProviderBuild {
  readonly request: AppBackendProviderBuildRequest
  readonly descriptor: AppBackendProviderDescriptor
  readonly selection: BackendProviderSelection
  readonly plan: BackendProviderPlan
  readonly emission: BackendProviderEmission
}

export interface PreparedAppBackendProviderPlan {
  readonly request: AppBackendProviderBuildRequest
  readonly descriptor: AppBackendProviderDescriptor
  readonly selection: BackendProviderSelection
  readonly plan: BackendProviderPlan
  readonly diagnostics: readonly BackendDiagnostic[]
}

export type AppBackendProviderBuildErrorCode =
  | 'request-invalid'
  | 'provider-unavailable'
  | 'provider-plan-failed'
  | 'provider-emit-failed'

export class AppBackendProviderBuildError extends Error {
  constructor(
    readonly code: AppBackendProviderBuildErrorCode,
    message: string,
    readonly diagnostics: readonly BackendDiagnostic[] = []
  ) {
    super(message)
    this.name = 'AppBackendProviderBuildError'
  }
}

export interface AppBackendProviderDocumentGraph {
  readonly rootId: string
  getNode(id: string):
    | Readonly<{
        pluginData: readonly Readonly<{ pluginId: string; key: string; value: string }>[]
      }>
    | undefined
}

type BackendProviderDataCloneState = JSONTraversalState

interface MutableBackendProviderDataRecord {
  [key: string]: unknown
}

const APP_BACKEND_PROVIDER_DESCRIPTOR_KEYS = new Set([
  'descriptorVersion',
  'packageAuthority',
  'pluginId',
  'contributionId',
  'providerId',
  'adapterId',
  'adapterVersion',
  'contractVersion',
  'supportedModelVersions',
  'capabilities',
  'configuration',
  'outputKinds',
  'permissions',
  'mcp'
])
const APP_BACKEND_PROVIDER_PACKAGE_AUTHORITY_KEYS = new Set([
  'trustSource',
  'publisherId',
  'publisherKeyId',
  'packageDigest',
  'pluginVersion',
  'pinnedDigest',
  'marketplaceAuthority'
])
const APP_BACKEND_PROVIDER_MARKETPLACE_AUTHORITY_KEYS = new Set([
  'sourceId',
  'trustDomainId',
  'sourceGeneration',
  'rootKeySpkiSha256'
])
const APP_BACKEND_PROVIDER_MCP_KEYS = new Set(['operations', 'credentials', 'sideEffects'])
const APP_BACKEND_PROVIDER_PACKAGE_DIGEST_PREFIXES = ['sha256:', 'app-bundle-sha256:'] as const

function invalidBackendProviderData(path: string): never {
  throw new TypeError(`${path} must contain only bounded plain data`)
}

function invalidBuildRequest(message: string): never {
  throw new AppBackendProviderBuildError('request-invalid', message)
}

function backendProviderDataField(value: object, key: string, path: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key)
  if (!field?.enumerable || !Object.hasOwn(field, 'value')) {
    return invalidBackendProviderData(path)
  }
  return field.value
}

function cloneAndFreezeBackendProviderArray(
  value: readonly unknown[],
  path: string,
  state: BackendProviderDataCloneState
): readonly unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 1_024) {
    return invalidBackendProviderData(path)
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    return invalidBackendProviderData(path)
  }
  const clone: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`
    clone.push(
      cloneAndFreezeBackendProviderData(
        backendProviderDataField(value, String(index), itemPath),
        itemPath,
        state
      )
    )
  }
  return Object.freeze(clone)
}

function cloneAndFreezeBackendProviderRecord(
  value: object,
  path: string,
  state: BackendProviderDataCloneState
): Readonly<MutableBackendProviderDataRecord> {
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length > 1_024 ||
    keys.some((key) => typeof key !== 'string')
  ) {
    return invalidBackendProviderData(path)
  }
  const clone = Object.create(null) as MutableBackendProviderDataRecord
  for (const key of keys as string[]) {
    const fieldPath = `${path}.${key}`
    clone[key] = cloneAndFreezeBackendProviderData(
      backendProviderDataField(value, key, fieldPath),
      fieldPath,
      state
    )
  }
  return Object.freeze(clone)
}

/** Clone through own data descriptors only, then recursively freeze the detached snapshot. */
function cloneAndFreezeBackendProviderData<T>(
  value: T,
  path = '$',
  state: BackendProviderDataCloneState = { nodes: 0, ancestors: new WeakSet() }
): T {
  state.nodes += 1
  if (state.nodes > 4_096) return invalidBackendProviderData(path)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : invalidBackendProviderData(path)
  }
  if (typeof value !== 'object' || state.ancestors.has(value)) {
    return invalidBackendProviderData(path)
  }

  state.ancestors.add(value)
  try {
    return (
      Array.isArray(value)
        ? cloneAndFreezeBackendProviderArray(value, path, state)
        : cloneAndFreezeBackendProviderRecord(value, path, state)
    ) as T
  } finally {
    state.ancestors.delete(value)
  }
}

function containsSecretLikeBackendProviderData(value: unknown): boolean {
  if (typeof value === 'string') return containsBackendSecretLikeMaterial(value)
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((entry) => containsSecretLikeBackendProviderData(entry))
  }
  return Object.entries(value).some(
    ([key, entry]) =>
      containsBackendSecretLikeMaterial(key) || containsSecretLikeBackendProviderData(entry)
  )
}

function appBackendProviderAuthorityIdentity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function appBackendProviderPackageDigest(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a package digest`)
  const prefix = APP_BACKEND_PROVIDER_PACKAGE_DIGEST_PREFIXES.find((candidate) =>
    value.startsWith(candidate)
  )
  if (!prefix) throw new TypeError(`${path} must be a package digest`)
  parseSha256Base64URL(value.slice(prefix.length), path)
  return value
}

function appBackendProviderMarketplaceAuthority(
  value: unknown
): AppPluginMarketplaceAuthority | null {
  if (value === null) return null
  const source = parseExactManifestRecord(
    value,
    '$.selection.packageAuthority.marketplaceAuthority',
    APP_BACKEND_PROVIDER_MARKETPLACE_AUTHORITY_KEYS
  )
  return parseAppPluginMarketplaceAuthority({
    sourceId: source.sourceId,
    trustDomainId: source.trustDomainId,
    sourceGeneration: source.sourceGeneration,
    rootKeySpkiSha256: source.rootKeySpkiSha256
  })
}

function appBackendProviderPackageAuthority(value: unknown): AppBackendProviderPackageAuthority {
  const source = parseExactManifestRecord(
    value,
    '$.selection.packageAuthority',
    APP_BACKEND_PROVIDER_PACKAGE_AUTHORITY_KEYS
  )
  if (source.trustSource !== 'app-bundle' && source.trustSource !== 'publisher-signature') {
    throw new TypeError('Backend Provider package trust source is invalid')
  }
  return Object.freeze({
    trustSource: source.trustSource,
    publisherId: appBackendProviderAuthorityIdentity(
      source.publisherId,
      '$.selection.packageAuthority.publisherId'
    ),
    publisherKeyId: appBackendProviderAuthorityIdentity(
      source.publisherKeyId,
      '$.selection.packageAuthority.publisherKeyId'
    ),
    packageDigest: appBackendProviderPackageDigest(
      source.packageDigest,
      '$.selection.packageAuthority.packageDigest'
    ),
    pluginVersion: parseStableSemver(
      source.pluginVersion,
      '$.selection.packageAuthority.pluginVersion'
    ),
    pinnedDigest:
      source.pinnedDigest === null
        ? null
        : appBackendProviderPackageDigest(
            source.pinnedDigest,
            '$.selection.packageAuthority.pinnedDigest'
          ),
    marketplaceAuthority: appBackendProviderMarketplaceAuthority(source.marketplaceAuthority)
  })
}

function appBackendProviderMCPPolicy(value: unknown): AppBackendProviderMCPPolicy {
  const source = parseExactManifestRecord(value, '$.selection.mcp', APP_BACKEND_PROVIDER_MCP_KEYS)
  const operations = parseBoundedManifestArray(source.operations, '$.selection.mcp.operations', 2)
  if (
    operations.length !== APP_BACKEND_PROVIDER_MCP_OPERATIONS.length ||
    operations.some(
      (operation, index) => operation !== APP_BACKEND_PROVIDER_MCP_OPERATIONS[index]
    ) ||
    source.credentials !== 'forbidden' ||
    source.sideEffects !== 'none'
  ) {
    throw new TypeError('Backend Provider MCP policy is invalid')
  }
  return Object.freeze({
    operations: APP_BACKEND_PROVIDER_MCP_OPERATIONS,
    credentials: 'forbidden',
    sideEffects: 'none'
  })
}

function appBackendProviderDescriptor(value: unknown): AppBackendProviderDescriptor {
  if (containsSecretLikeBackendProviderData(value)) {
    throw new TypeError('Backend Provider selection contains forbidden material')
  }
  const source = parseExactManifestRecord(
    value,
    '$.selection',
    APP_BACKEND_PROVIDER_DESCRIPTOR_KEYS
  )
  if (source.descriptorVersion !== 1) {
    throw new TypeError('Backend Provider descriptor version is invalid')
  }
  const compilerDescriptor = parseBackendProviderDescriptor({
    pluginId: source.pluginId,
    contributionId: source.contributionId,
    providerId: source.providerId,
    adapterId: source.adapterId,
    adapterVersion: source.adapterVersion,
    contractVersion: source.contractVersion,
    supportedModelVersions: source.supportedModelVersions,
    capabilities: source.capabilities,
    outputs: source.outputKinds
  })
  if (!compilerDescriptor.ok) throw new TypeError('Backend Provider descriptor is invalid')
  const contribution = parsePluginBackendProviderContribution(
    {
      providerId: source.providerId,
      contributionId: source.contributionId,
      name: 'Backend Provider',
      description: 'Host-validated Backend Provider selection.',
      adapterId: source.adapterId,
      contractVersion: source.contractVersion,
      supportedModelVersions: source.supportedModelVersions,
      capabilities: source.capabilities,
      configuration: source.configuration,
      outputKinds: source.outputKinds,
      permissions: source.permissions
    },
    '$.selection'
  )
  return cloneAndFreezeBackendProviderData({
    descriptorVersion: 1,
    packageAuthority: appBackendProviderPackageAuthority(source.packageAuthority),
    pluginId: compilerDescriptor.value.pluginId,
    contributionId: contribution.contributionId,
    providerId: contribution.providerId,
    adapterId: contribution.adapterId,
    adapterVersion: compilerDescriptor.value.adapterVersion,
    contractVersion: contribution.contractVersion,
    supportedModelVersions: contribution.supportedModelVersions,
    capabilities: contribution.capabilities,
    configuration: contribution.configuration,
    outputKinds: contribution.outputKinds,
    permissions: contribution.permissions,
    mcp: appBackendProviderMCPPolicy(source.mcp)
  })
}

function backendProviderBuildRequestRecord(value: unknown): Readonly<{
  format: unknown
  selection: unknown
  application: unknown
}> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidBuildRequest('Backend Provider request must be a plain object.')
  }
  const keys = Reflect.ownKeys(value)
  if (
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    keys.length !== 3 ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'format' && key !== 'selection' && key !== 'application')
    )
  ) {
    return invalidBuildRequest(
      'Backend Provider request must contain exactly format, selection, and application.'
    )
  }
  for (const key of ['format', 'selection', 'application'] as const) {
    if (!keys.includes(key)) {
      return invalidBuildRequest(
        'Backend Provider request must contain exactly format, selection, and application.'
      )
    }
  }
  return Object.freeze({
    format: backendProviderDataField(value, 'format', '$.format'),
    selection: backendProviderDataField(value, 'selection', '$.selection'),
    application: backendProviderDataField(value, 'application', '$.application')
  })
}

export function parseAppBackendProviderBuildRequest(
  value: unknown
): AppBackendProviderBuildRequest {
  let source: ReturnType<typeof backendProviderBuildRequestRecord>
  try {
    source = backendProviderBuildRequestRecord(value)
  } catch (cause) {
    if (cause instanceof AppBackendProviderBuildError) throw cause
    return invalidBuildRequest('Backend Provider request must contain only data properties.')
  }
  if (source.format !== APP_BACKEND_PROVIDER_REQUEST_FORMAT) {
    return invalidBuildRequest('Backend Provider request format is not supported.')
  }
  let selection: AppBackendProviderDescriptor
  try {
    const detachedSelection = cloneAndFreezeBackendProviderData(source.selection, '$.selection')
    selection = appBackendProviderDescriptor(detachedSelection)
  } catch {
    return invalidBuildRequest('Backend Provider selection is invalid.')
  }
  const application = parseBackendApplicationSpecV1(source.application)
  if (!application.ok) {
    throw new AppBackendProviderBuildError(
      'request-invalid',
      `Backend application is invalid: ${application.diagnostics
        .map((entry) => entry.code)
        .join(', ')}.`,
      application.diagnostics
    )
  }
  return Object.freeze({
    format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
    selection,
    application: application.value
  })
}

export function appBackendProviderDocumentValue(value: unknown): string {
  const request = parseAppBackendProviderBuildRequest(value)
  const serialized = JSON.stringify(request)
  if (
    new TextEncoder().encode(serialized).byteLength >
    BACKEND_LIMITS.maxCanonicalBytes + 256 * 1024
  ) {
    return invalidBuildRequest('Backend Provider document request is too large.')
  }
  return serialized
}

export function readAppBackendProviderDocumentRequest(
  graph: AppBackendProviderDocumentGraph
): AppBackendProviderBuildRequest | null {
  const root = graph.getNode(graph.rootId)
  const matches = (root?.pluginData ?? []).filter(
    (entry) =>
      entry.pluginId === APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID &&
      entry.key === APP_BACKEND_PROVIDER_DOCUMENT_KEY
  )
  if (matches.length === 0) return null
  if (matches.length !== 1) {
    return invalidBuildRequest('Backend Provider document request must be declared exactly once.')
  }
  const serialized = matches[0].value
  if (
    new TextEncoder().encode(serialized).byteLength >
    BACKEND_LIMITS.maxCanonicalBytes + 256 * 1024
  ) {
    return invalidBuildRequest('Backend Provider document request is too large.')
  }
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return invalidBuildRequest('Backend Provider document request is not valid JSON.')
  }
  return parseAppBackendProviderBuildRequest(value)
}

function incompatible(
  status: Exclude<AppBackendProviderCompatibilityStatus, 'compatible'>,
  reason: string
): AppBackendProviderCompatibility {
  return Object.freeze({ ok: false, status, reason })
}

function exactDeclaredContribution(
  installed: InstalledPluginBackendProvider
): PluginBackendProviderContributionV1 | null {
  const manifest = installed.plugin.package.manifest
  if (manifest.schemaVersion !== 2) return null
  const matches = (manifest.contributions.backendProviders ?? []).filter(
    ({ contributionId }) => contributionId === installed.contribution.contributionId
  )
  if (matches.length !== 1 || !sameJSONAuthority(matches[0], installed.contribution)) return null
  return matches[0]
}

function packageAuthority(
  installed: InstalledPluginBackendProvider,
  reviewed: ReviewedBackendProviderAdapter
): AppBackendProviderPackageAuthority | AppBackendProviderCompatibility {
  const pluginPackage = installed.plugin.package
  const manifest = pluginPackage.manifest
  const verifiedKeyId = pluginPackage.verifiedPackage?.verifiedKeyId ?? manifest.publisher.keyId
  if (pluginPackage.trustSource !== reviewed.trustSource) {
    return incompatible(
      'trust-source-mismatch',
      `Backend adapter ${reviewed.contribution.adapterId} is available only from the reviewed app bundle`
    )
  }
  if (manifest.publisher.id !== reviewed.publisherId) {
    return incompatible(
      'publisher-mismatch',
      `Publisher ${manifest.publisher.id} is not authorized for backend adapter ${reviewed.contribution.adapterId}`
    )
  }
  if (verifiedKeyId !== reviewed.publisherKeyId) {
    return incompatible(
      'publisher-key-mismatch',
      `Publisher key ${verifiedKeyId} is not authorized for backend adapter ${reviewed.contribution.adapterId}`
    )
  }
  if (
    !pluginPackage.digest ||
    pluginPackage.verifiedPackage !== undefined ||
    pluginPackage.marketplaceAuthority != null
  ) {
    return incompatible(
      'package-authority-invalid',
      'The app-bundled backend provider package has unexpected publisher review authority'
    )
  }
  if (pluginPackage.digest !== reviewed.packageDigest) {
    return incompatible(
      'package-digest-mismatch',
      'The app-bundled backend provider package no longer matches the host-reviewed digest'
    )
  }
  if (manifest.plugin.version !== reviewed.pluginVersion) {
    return incompatible(
      'plugin-version-mismatch',
      `Plugin version ${manifest.plugin.version} is not reviewed for backend adapter ${reviewed.contribution.adapterId}`
    )
  }
  if (
    installed.plugin.pinnedDigest !== null &&
    installed.plugin.pinnedDigest !== pluginPackage.digest
  ) {
    return incompatible(
      'digest-pin-mismatch',
      'The backend provider package no longer matches its pinned digest'
    )
  }
  return Object.freeze({
    trustSource: pluginPackage.trustSource,
    publisherId: manifest.publisher.id,
    publisherKeyId: verifiedKeyId,
    packageDigest: pluginPackage.digest,
    pluginVersion: manifest.plugin.version,
    pinnedDigest: installed.plugin.pinnedDigest,
    marketplaceAuthority: null
  })
}

function descriptor(
  installed: InstalledPluginBackendProvider,
  reviewed: ReviewedBackendProviderAdapter,
  authority: AppBackendProviderPackageAuthority
): AppBackendProviderDescriptor {
  const contribution = installed.contribution
  return cloneAndFreezeBackendProviderData({
    descriptorVersion: 1,
    packageAuthority: authority,
    pluginId: installed.plugin.package.manifest.plugin.id,
    contributionId: contribution.contributionId,
    providerId: contribution.providerId,
    adapterId: contribution.adapterId,
    adapterVersion: reviewed.adapterVersion,
    contractVersion: contribution.contractVersion,
    supportedModelVersions: [...contribution.supportedModelVersions] as readonly [1],
    capabilities: [...contribution.capabilities],
    configuration: contribution.configuration,
    outputKinds: [...contribution.outputKinds],
    permissions: [] as readonly [],
    mcp: {
      operations: APP_BACKEND_PROVIDER_MCP_OPERATIONS,
      credentials: 'forbidden',
      sideEffects: 'none'
    }
  })
}

/** Accept only the complete reviewed manifest declaration and current live package authority. */
export function inspectInstalledBackendProviderCompatibility(
  installed: InstalledPluginBackendProvider
): AppBackendProviderCompatibility {
  if (!installed.plugin.enabled || installed.plugin.blockedReason) {
    return incompatible(
      'inactive',
      installed.plugin.blockedReason ?? 'Backend provider plugin is disabled'
    )
  }
  const contribution = exactDeclaredContribution(installed)
  if (!contribution) {
    return incompatible(
      'contribution-identity-mismatch',
      'Backend provider contribution does not match the installed manifest'
    )
  }
  const reviewed = REVIEWED_BACKEND_PROVIDER_ADAPTERS.get(contribution.adapterId)
  if (!reviewed) {
    return incompatible(
      'untrusted-adapter',
      `Backend provider adapter is not host-reviewed: ${contribution.adapterId}`
    )
  }
  const pluginId = installed.plugin.package.manifest.plugin.id
  if (pluginId !== reviewed.pluginId) {
    return incompatible(
      'plugin-identity-mismatch',
      `Plugin ${pluginId} is not authorized for backend adapter ${contribution.adapterId}`
    )
  }
  if (
    contribution.providerId !== reviewed.contribution.providerId ||
    contribution.contributionId !== reviewed.contribution.contributionId
  ) {
    return incompatible(
      'contribution-identity-mismatch',
      `Backend adapter ${contribution.adapterId} does not authorize this provider identity`
    )
  }
  if (!sameJSONAuthority(contribution, reviewed.contribution)) {
    return incompatible(
      'declaration-mismatch',
      `Backend adapter ${contribution.adapterId} requires its exact reviewed versions, capabilities, permissions, configuration, and outputs`
    )
  }
  const authority = packageAuthority(installed, reviewed)
  if ('ok' in authority) return authority
  return Object.freeze({
    ok: true,
    status: 'compatible',
    descriptor: descriptor(installed, reviewed, authority)
  })
}

function descriptorIdentity(value: AppBackendProviderDescriptor): string {
  return `${value.pluginId}\0${value.contributionId}\0${value.providerId}\0${value.adapterId}`
}

/**
 * Enumerates only installed, enabled, unblocked, exact-reviewed providers. The store lookup is pure:
 * it never connects an account, resolves a credential, proposes a migration, or starts deployment.
 */
export function listAppBackendProviderDescriptors(
  store: AppBackendProviderHostStore
): readonly AppBackendProviderDescriptor[] {
  const descriptors = store.installedBackendProviders().flatMap((installed) => {
    const compatibility = inspectInstalledBackendProviderCompatibility(installed)
    return compatibility.ok ? [compatibility.descriptor] : []
  })
  const counts = new Map<string, number>()
  for (const value of descriptors) {
    const identity = descriptorIdentity(value)
    counts.set(identity, (counts.get(identity) ?? 0) + 1)
  }
  return Object.freeze(
    descriptors
      .filter((value) => counts.get(descriptorIdentity(value)) === 1)
      .sort((left, right) => descriptorIdentity(left).localeCompare(descriptorIdentity(right)))
      .map((value) => cloneAndFreezeBackendProviderData(value))
  )
}

/**
 * Re-resolves an earlier descriptor against the live store. Package digest, pin, publisher key,
 * Marketplace review authority, lifecycle state, and every contribution field must still match.
 */
export function resolveAppBackendProviderDescriptor(
  store: AppBackendProviderHostStore,
  expected: AppBackendProviderDescriptor
): AppBackendProviderDescriptor | null {
  return (
    listAppBackendProviderDescriptors(store).find((candidate) =>
      sameJSONAuthority(candidate, expected)
    ) ?? null
  )
}

function compilerBackendProviderSelection(
  descriptor: AppBackendProviderDescriptor
): BackendProviderSelection {
  return Object.freeze({
    descriptor: Object.freeze({
      pluginId: descriptor.pluginId,
      contributionId: descriptor.contributionId,
      providerId: descriptor.providerId,
      adapterId: descriptor.adapterId,
      adapterVersion: descriptor.adapterVersion,
      contractVersion: descriptor.contractVersion,
      supportedModelVersions: Object.freeze([...descriptor.supportedModelVersions]),
      capabilities: Object.freeze([...descriptor.capabilities]),
      outputs: Object.freeze([...descriptor.outputKinds])
    }),
    packageDigest: descriptor.packageAuthority.packageDigest,
    enabled: true
  })
}

const BUILTIN_APP_BACKEND_PROVIDER_REGISTRY = createBuiltinBackendProviderRegistry()

function buildFailure(
  code: Extract<AppBackendProviderBuildErrorCode, 'provider-plan-failed' | 'provider-emit-failed'>,
  label: string,
  diagnostics: readonly BackendDiagnostic[]
): never {
  throw new AppBackendProviderBuildError(
    code,
    `${label}: ${diagnostics.map((entry) => entry.code).join(', ')}.`,
    diagnostics
  )
}

/**
 * Resolves live lifecycle/package authority, then runs only the trusted deterministic compiler
 * plan and emit stages. It has no credential, filesystem, network, migration apply, or deployment
 * handle. Callers must repeat this operation immediately before any remote frontend dispatch.
 */
export function prepareAppBackendProviderBuild(
  store: AppBackendProviderHostStore,
  value: unknown,
  options: AppBackendProviderBuildOptions
): PreparedAppBackendProviderBuild {
  const prepared = prepareAppBackendProviderPlan(store, value, options)
  const emitted = emitBackendProviderPlan(BUILTIN_APP_BACKEND_PROVIDER_REGISTRY, {
    selection: prepared.selection,
    plan: prepared.plan
  })
  if (!emitted.ok) {
    return buildFailure(
      'provider-emit-failed',
      'Trusted Backend Provider emission failed',
      emitted.diagnostics
    )
  }
  return Object.freeze({
    request: prepared.request,
    descriptor: prepared.descriptor,
    selection: prepared.selection,
    plan: prepared.plan,
    emission: emitted.emission
  })
}

/**
 * Resolves live Provider authority and produces only the deterministic plan. This boundary is used
 * by MCP/AI review commands so artifact generation can remain unreachable from that capability.
 */
export function prepareAppBackendProviderPlan(
  store: AppBackendProviderHostStore,
  value: unknown,
  options: AppBackendProviderBuildOptions
): PreparedAppBackendProviderPlan {
  const request = parseAppBackendProviderBuildRequest(value)
  const descriptor = resolveAppBackendProviderDescriptor(store, request.selection)
  if (!descriptor) {
    throw new AppBackendProviderBuildError(
      'provider-unavailable',
      'Selected Backend Provider is not installed, enabled, unblocked, digest-pinned, and host-reviewed.'
    )
  }
  const selection = compilerBackendProviderSelection(descriptor)
  const planned = createBackendProviderPlan(BUILTIN_APP_BACKEND_PROVIDER_REGISTRY, {
    selection,
    application: request.application,
    target: options.target,
    mode: options.mode
  })
  if (!planned.ok) {
    return buildFailure(
      'provider-plan-failed',
      'Trusted Backend Provider plan failed',
      planned.diagnostics
    )
  }
  return Object.freeze({
    request,
    descriptor,
    selection,
    plan: planned.plan,
    diagnostics: planned.diagnostics
  })
}

export function prepareAppBackendProviderDocumentPlan(
  store: AppBackendProviderHostStore,
  graph: AppBackendProviderDocumentGraph,
  options: AppBackendProviderBuildOptions
): PreparedAppBackendProviderPlan | null {
  const request = readAppBackendProviderDocumentRequest(graph)
  return request ? prepareAppBackendProviderPlan(store, request, options) : null
}

export function prepareAppBackendProviderDocumentBuild(
  store: AppBackendProviderHostStore,
  graph: AppBackendProviderDocumentGraph,
  options: AppBackendProviderBuildOptions
): PreparedAppBackendProviderBuild | null {
  const request = readAppBackendProviderDocumentRequest(graph)
  return request ? prepareAppBackendProviderBuild(store, request, options) : null
}

function compilerRequest(prepared: PreparedAppBackendProviderPlan): CompilerBackendProviderRequest {
  return Object.freeze({
    selection: prepared.selection,
    application: prepared.plan.application
  })
}

/**
 * Resolve a document's data-only declaration against the live Host lifecycle
 * immediately before ordinary Compiler plan/emit. The Compiler receives no App
 * store or executable Host capability. A pre-populated request plus a document
 * declaration is rejected so two explicit authorities can never be merged.
 */
export function prepareAppBackendProviderCompilerOptions(
  store: AppBackendProviderHostStore,
  graph: AppBackendProviderDocumentGraph,
  options: CompilerOptions
): CompilerOptions {
  const request = readAppBackendProviderDocumentRequest(graph)
  if (!request) return options
  if (options.backendProvider !== undefined) {
    throw new AppBackendProviderBuildError(
      'request-invalid',
      'Backend Provider authority must be resolved exactly once for this compile.'
    )
  }
  const prepared = prepareAppBackendProviderPlan(store, request, {
    target: options.target,
    mode: options.backendCompilationMode ?? (options.devMode ? 'preview' : 'production')
  })
  return Object.freeze({
    ...options,
    backendProvider: compilerRequest(prepared)
  })
}

/** Resolve live Host authority and synchronously compile without a stale async hand-off window. */
export function compileAppBackendProviderDocument(
  store: AppBackendProviderHostStore,
  input: CompilerInput
): CompilerOutput {
  return compile({
    ...input,
    options: prepareAppBackendProviderCompilerOptions(store, input.graph, input.options)
  })
}

function installedBackendProvidersForCommand(
  plugin: InstalledPluginBackendProvider['plugin']
): readonly InstalledPluginBackendProvider[] {
  if (!plugin.enabled || plugin.blockedReason || plugin.package.manifest.schemaVersion !== 2) {
    return []
  }
  return Object.freeze(
    (plugin.package.manifest.contributions.backendProviders ?? []).map((contribution) =>
      Object.freeze({
        plugin: structuredClone(plugin),
        contribution: structuredClone(contribution)
      })
    )
  )
}

function backendProviderMCPDiagnosticCounts(
  diagnostics: readonly BackendDiagnostic[]
): Readonly<{ errorCount: number; warningCount: number; infoCount: number }> {
  return Object.freeze({
    errorCount: diagnostics.filter(({ severity }) => severity === 'error').length,
    warningCount: diagnostics.filter(({ severity }) => severity === 'warning').length,
    infoCount: diagnostics.filter(({ severity }) => severity === 'info').length
  })
}

/**
 * Executes the host-owned review projection for one exact installed Provider package. It performs
 * only live authority resolution and deterministic planning; no credential, emit, filesystem,
 * network, migration, Apply, release, or deployment handle is present.
 */
export function runAppBackendProviderMCPCommand(
  plugin: InstalledPluginBackendProvider['plugin'],
  graph: AppBackendProviderDocumentGraph,
  operation: AppBackendProviderMCPOperation,
  value: unknown
): Readonly<Record<string, unknown>> {
  const command = APP_BACKEND_PROVIDER_MCP_COMMANDS[operation]
  const args = parsePluginObjectParameterValue(
    value,
    command.parameters.schema,
    command.parameters.maxBytes,
    'Backend Provider MCP arguments'
  ) as {
    target: AppBackendProviderBuildOptions['target']
    mode: AppBackendProviderBuildOptions['mode']
  }
  const store: AppBackendProviderHostStore = {
    installedBackendProviders: () => installedBackendProvidersForCommand(plugin)
  }
  const prepared = prepareAppBackendProviderDocumentPlan(store, graph, args)
  if (!prepared) {
    throw new AppBackendProviderBuildError(
      'request-invalid',
      'The current document does not declare a Backend Provider request.'
    )
  }
  const common = {
    format: APP_BACKEND_PROVIDER_MCP_RESULT_FORMAT,
    operation,
    status: 'ready',
    pluginId: prepared.descriptor.pluginId,
    contributionId: prepared.descriptor.contributionId,
    providerId: prepared.descriptor.providerId,
    adapterId: prepared.descriptor.adapterId,
    adapterVersion: prepared.descriptor.adapterVersion,
    packageDigest: prepared.descriptor.packageAuthority.packageDigest,
    target: prepared.plan.target,
    mode: prepared.plan.mode,
    applicationDigest: prepared.plan.applicationDigest,
    planDigest: prepared.plan.planDigest,
    capabilities: prepared.plan.capabilities.map((decision) => ({ ...decision })),
    diagnostics: backendProviderMCPDiagnosticCounts(prepared.diagnostics),
    safety: {
      credentialResolution: 'forbidden',
      sideEffects: 'none',
      applyAvailable: false
    }
  }
  const result =
    operation === 'plan'
      ? {
          ...common,
          plannedAdapterCount: Object.keys(prepared.plan.adapterPlans).length,
          outputKinds: [...prepared.descriptor.outputKinds],
          externalRequirementCount: prepared.plan.application.secrets.length
        }
      : common
  const validated = parsePluginObjectParameterValue(
    result,
    command.result.schema,
    command.result.maxBytes,
    'Backend Provider MCP result'
  ) as Readonly<Record<string, unknown>>
  if (containsSecretLikeBackendProviderData(validated)) {
    throw new Error('Backend Provider MCP result contains forbidden material')
  }
  return cloneAndFreezeBackendProviderData(validated, '$.backendProviderMCPResult')
}

/** Maps only a freshly re-resolved descriptor into Release Core's data-only authority. */
export function resolveAppBackendProviderReleaseAuthority(
  store: AppBackendProviderHostStore,
  expected: AppBackendProviderDescriptor
): BackendReleaseProviderAuthorityV1 | null {
  const current = resolveAppBackendProviderDescriptor(store, expected)
  if (!current) return null
  const normalized = normalizeBackendReleaseProviderAuthority({
    publisherId: current.packageAuthority.publisherId,
    packageDigest: current.packageAuthority.packageDigest,
    pluginId: current.pluginId,
    contributionId: current.contributionId,
    providerId: current.providerId,
    adapterId: current.adapterId,
    adapterVersion: current.adapterVersion,
    contractVersion: current.contractVersion,
    supportedModelVersions: current.supportedModelVersions,
    capabilities: current.capabilities,
    permissions: current.permissions,
    outputKinds: current.outputKinds
  })
  return Object.freeze({
    ...normalized,
    supportedModelVersions: Object.freeze([...normalized.supportedModelVersions]),
    capabilities: Object.freeze([...normalized.capabilities]),
    permissions: Object.freeze([...normalized.permissions]),
    outputKinds: Object.freeze([...normalized.outputKinds])
  })
}

export function isAppBackendProviderMCPOperation(
  value: unknown
): value is AppBackendProviderMCPOperation {
  return value === 'audit' || value === 'plan'
}
