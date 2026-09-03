import type { CompilerTarget } from '#compiler/types'

import type {
  BackendApplicationSpecV2,
  BackendCapabilityV2,
  BackendDiagnostic,
  BackendSecretRef
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

export const BACKEND_PROVIDER_CONTRACT_VERSION_V2 = 2 as const
export const BACKEND_PROVIDER_PLAN_VERSION_V2 = 2 as const
export const BACKEND_ARTIFACT_MANIFEST_VERSION_V2 = 2 as const

export type BackendProviderOutputKindV2 =
  | 'client-config'
  | 'database-schema'
  | 'deployment-manifest'
  | 'migration-plan'
  | 'security-policy'
  | 'server-runtime'

export const BACKEND_PROVIDER_OUTPUT_KINDS_V2 = Object.freeze([
  'client-config',
  'database-schema',
  'deployment-manifest',
  'migration-plan',
  'security-policy',
  'server-runtime'
] as const satisfies readonly BackendProviderOutputKindV2[])

export type BackendProviderAdapterSlotV2 =
  | 'data'
  | 'auth'
  | 'server'
  | 'securityPolicy'
  | 'migrations'
  | 'realtime'
  | 'transactions'
  | 'dataMigrations'
  | 'automations'
  | 'observability'

export const BACKEND_PROVIDER_ADAPTER_SLOTS_V2 = Object.freeze([
  'data',
  'auth',
  'server',
  'securityPolicy',
  'migrations',
  'realtime',
  'transactions',
  'dataMigrations',
  'automations',
  'observability'
] as const satisfies readonly BackendProviderAdapterSlotV2[])

export type BackendProviderModelVersionV2 = 1 | 2

/**
 * Data-only authority declared by a contract-v2 plugin contribution. Package digest and lifecycle
 * state are supplied separately by the trusted host for every plan and emit operation.
 */
export interface BackendProviderDescriptorV2 {
  readonly pluginId: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: typeof BACKEND_PROVIDER_CONTRACT_VERSION_V2
  readonly supportedModelVersions: readonly BackendProviderModelVersionV2[]
  readonly capabilities: readonly BackendCapabilityV2[]
  readonly outputs: readonly BackendProviderOutputKindV2[]
}

/** Exact host-resolved package and lifecycle authority for one V2 operation. */
export interface BackendProviderSelectionV2 {
  readonly descriptor: BackendProviderDescriptorV2
  readonly packageDigest: string
  readonly enabled: boolean
}

export const BACKEND_COMPILATION_MODES_V2 = Object.freeze([
  'preview',
  'source-only-prototype',
  'production'
] as const)
export type BackendCompilationModeV2 = (typeof BACKEND_COMPILATION_MODES_V2)[number]

export function isBackendCompilationModeV2(value: unknown): value is BackendCompilationModeV2 {
  return BACKEND_COMPILATION_MODES_V2.some((mode) => mode === value)
}

export type BackendTargetCapabilityStatusV2 =
  | 'supported'
  | 'source-only'
  | 'unsupported'
  | 'requires-server-bridge'

export type TargetCapabilityMatrixV2 = Readonly<
  Record<CompilerTarget, Readonly<Record<BackendCapabilityV2, BackendTargetCapabilityStatusV2>>>
>

export interface BackendCapabilityDecisionV2 {
  readonly capability: BackendCapabilityV2
  readonly required: boolean
  readonly providerSupported: boolean
  readonly targetStatus: BackendTargetCapabilityStatusV2
  readonly resolution: BackendTargetCapabilityStatusV2
  readonly included: boolean
}

export interface BackendProviderAdapterContextV2 {
  readonly application: BackendApplicationSpecV2
  readonly selection: BackendProviderSelectionV2
  readonly target: CompilerTarget
  readonly mode: BackendCompilationModeV2
  /** Capabilities proven by the normalized IR, never merely claimed by a descriptor. */
  readonly actualCapabilities: readonly BackendCapabilityV2[]
  readonly capabilities: readonly BackendCapabilityDecisionV2[]
}

export interface BackendArtifactSourceV2 {
  readonly path: string
  readonly kind: BackendProviderOutputKindV2
  readonly mediaType: string
  readonly content: string
}

/**
 * Adapter methods are deterministic and side-effect free. They receive normalized Backend V2 IR
 * only; the contract provides no credential, environment, network, filesystem, Apply, or Deploy
 * handle.
 */
export interface BackendProviderAdapterV2 {
  readonly capabilities: readonly BackendCapabilityV2[]
  readonly outputs: readonly BackendProviderOutputKindV2[]
  readonly validate?: (context: BackendProviderAdapterContextV2) => readonly BackendDiagnostic[]
  readonly plan: (context: BackendProviderAdapterContextV2) => JSONValue
  readonly emit: (
    context: BackendProviderAdapterContextV2,
    plan: JSONValue
  ) => readonly BackendArtifactSourceV2[]
}

export interface BackendProviderBundleV2 {
  readonly descriptor: BackendProviderDescriptorV2
  readonly data?: BackendProviderAdapterV2
  readonly auth?: BackendProviderAdapterV2
  readonly server?: BackendProviderAdapterV2
  readonly securityPolicy?: BackendProviderAdapterV2
  readonly migrations?: BackendProviderAdapterV2
  readonly realtime?: BackendProviderAdapterV2
  readonly transactions?: BackendProviderAdapterV2
  readonly dataMigrations?: BackendProviderAdapterV2
  readonly automations?: BackendProviderAdapterV2
  readonly observability?: BackendProviderAdapterV2
  readonly validate?: (context: BackendProviderAdapterContextV2) => readonly BackendDiagnostic[]
}

export type BackendProviderAdapterPlansV2 = Readonly<
  Partial<Record<BackendProviderAdapterSlotV2, JSONValue>>
>

export interface BackendProviderAuthorityV2 {
  readonly pluginId: string
  readonly packageDigest: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: typeof BACKEND_PROVIDER_CONTRACT_VERSION_V2
  readonly supportedModelVersions: readonly BackendProviderModelVersionV2[]
  readonly capabilities: readonly BackendCapabilityV2[]
  readonly outputs: readonly BackendProviderOutputKindV2[]
}

export interface BackendProviderPlanV2 {
  readonly version: typeof BACKEND_PROVIDER_PLAN_VERSION_V2
  readonly authority: BackendProviderAuthorityV2
  readonly application: BackendApplicationSpecV2
  readonly applicationDigest: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationModeV2
  readonly actualCapabilities: readonly BackendCapabilityV2[]
  readonly capabilities: readonly BackendCapabilityDecisionV2[]
  readonly adapterPlans: BackendProviderAdapterPlansV2
  readonly planDigest: string
}

export type BackendProviderPlanResultV2 =
  | Readonly<{
      ok: true
      plan: BackendProviderPlanV2
      diagnostics: readonly BackendDiagnostic[]
    }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

export interface BackendArtifactManifestEntryV2 {
  readonly path: string
  readonly kind: BackendProviderOutputKindV2
  readonly mediaType: string
  readonly byteLength: number
  readonly digest: string
}

export interface BackendArtifactManifestV2 {
  readonly format: 'openpencil.backend-artifacts.v2'
  readonly version: typeof BACKEND_ARTIFACT_MANIFEST_VERSION_V2
  readonly authority: BackendProviderAuthorityV2
  readonly applicationDigest: string
  readonly planDigest: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationModeV2
  readonly actualCapabilities: readonly BackendCapabilityV2[]
  readonly capabilities: readonly BackendCapabilityDecisionV2[]
  readonly requiredSecrets: readonly BackendSecretRef[]
  readonly artifacts: readonly BackendArtifactManifestEntryV2[]
}

export interface BackendProviderEmissionV2 {
  readonly files: ReadonlyMap<string, string | Uint8Array>
  readonly manifestPath: string
  readonly manifest: BackendArtifactManifestV2
  readonly manifestDigest: string
  readonly diagnostics: readonly BackendDiagnostic[]
}

export type BackendProviderEmissionResultV2 =
  | Readonly<{ ok: true; emission: BackendProviderEmissionV2 }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>
