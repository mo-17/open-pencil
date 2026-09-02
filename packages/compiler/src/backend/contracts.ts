import type {
  BackendApplicationSpecV1,
  BackendCapability,
  BackendDiagnostic,
  BackendSecretRef
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import type { CompilerTarget } from '../types'

export const BACKEND_PROVIDER_CONTRACT_VERSION = 1 as const
export const BACKEND_PROVIDER_PLAN_VERSION = 1 as const
export const BACKEND_ARTIFACT_MANIFEST_VERSION = 1 as const

export type BackendProviderOutputKind =
  | 'client-config'
  | 'database-schema'
  | 'deployment-manifest'
  | 'migration-plan'
  | 'security-policy'
  | 'server-runtime'

export const BACKEND_PROVIDER_OUTPUT_KINDS = Object.freeze([
  'client-config',
  'database-schema',
  'deployment-manifest',
  'migration-plan',
  'security-policy',
  'server-runtime'
] as const satisfies readonly BackendProviderOutputKind[])

export type BackendProviderAdapterSlot =
  | 'data'
  | 'auth'
  | 'server'
  | 'securityPolicy'
  | 'migrations'

export const BACKEND_PROVIDER_ADAPTER_SLOTS = Object.freeze([
  'data',
  'auth',
  'server',
  'securityPolicy',
  'migrations'
] as const satisfies readonly BackendProviderAdapterSlot[])

/**
 * Data-only authority declared by a plugin contribution. `packageDigest` and
 * lifecycle state are deliberately supplied separately by the trusted host.
 */
export interface BackendProviderDescriptor {
  readonly pluginId: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: typeof BACKEND_PROVIDER_CONTRACT_VERSION
  readonly supportedModelVersions: readonly number[]
  readonly capabilities: readonly BackendCapability[]
  readonly outputs: readonly BackendProviderOutputKind[]
}

/** Exact host-resolved package and lifecycle authority for one operation. */
export interface BackendProviderSelection {
  readonly descriptor: BackendProviderDescriptor
  readonly packageDigest: string
  readonly enabled: boolean
}

export const BACKEND_COMPILATION_MODES = Object.freeze([
  'preview',
  'source-only-prototype',
  'production'
] as const)
export type BackendCompilationMode = (typeof BACKEND_COMPILATION_MODES)[number]

export function isBackendCompilationMode(value: unknown): value is BackendCompilationMode {
  return BACKEND_COMPILATION_MODES.some((mode) => mode === value)
}

export type BackendTargetCapabilityStatus =
  | 'supported'
  | 'source-only'
  | 'unsupported'
  | 'requires-server-bridge'

export type TargetCapabilityMatrix = Readonly<
  Record<CompilerTarget, Readonly<Record<BackendCapability, BackendTargetCapabilityStatus>>>
>

export interface BackendCapabilityDecision {
  readonly capability: BackendCapability
  readonly required: boolean
  readonly providerSupported: boolean
  readonly targetStatus: BackendTargetCapabilityStatus
  readonly resolution: BackendTargetCapabilityStatus
  readonly included: boolean
}

export interface BackendProviderAdapterContext {
  readonly application: BackendApplicationSpecV1
  readonly selection: BackendProviderSelection
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
  readonly capabilities: readonly BackendCapabilityDecision[]
}

export interface BackendArtifactSource {
  readonly path: string
  readonly kind: BackendProviderOutputKind
  readonly mediaType: string
  readonly content: string | Uint8Array
}

/**
 * Every adapter method is deterministic and side-effect free. Implementations
 * receive normalized Backend IR only; no SceneGraph, environment, credential,
 * filesystem, or network handle exists in this contract.
 */
export interface BackendProviderAdapter {
  readonly capabilities: readonly BackendCapability[]
  readonly outputs: readonly BackendProviderOutputKind[]
  readonly validate?: (context: BackendProviderAdapterContext) => readonly BackendDiagnostic[]
  readonly plan: (context: BackendProviderAdapterContext) => JSONValue
  readonly emit: (
    context: BackendProviderAdapterContext,
    plan: JSONValue
  ) => readonly BackendArtifactSource[]
}

export interface BackendProviderBundle {
  readonly descriptor: BackendProviderDescriptor
  readonly data?: BackendProviderAdapter
  readonly auth?: BackendProviderAdapter
  readonly server?: BackendProviderAdapter
  readonly securityPolicy?: BackendProviderAdapter
  readonly migrations?: BackendProviderAdapter
  readonly validate?: (context: BackendProviderAdapterContext) => readonly BackendDiagnostic[]
}

export type BackendProviderAdapterPlans = Readonly<
  Partial<Record<BackendProviderAdapterSlot, JSONValue>>
>

export interface BackendProviderAuthority {
  readonly pluginId: string
  readonly packageDigest: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: typeof BACKEND_PROVIDER_CONTRACT_VERSION
  readonly supportedModelVersions: readonly number[]
  readonly capabilities: readonly BackendCapability[]
  readonly outputs: readonly BackendProviderOutputKind[]
}

export interface BackendProviderPlan {
  readonly version: typeof BACKEND_PROVIDER_PLAN_VERSION
  readonly authority: BackendProviderAuthority
  readonly application: BackendApplicationSpecV1
  readonly applicationDigest: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
  readonly capabilities: readonly BackendCapabilityDecision[]
  readonly adapterPlans: BackendProviderAdapterPlans
  readonly planDigest: string
}

export type BackendProviderPlanResult =
  | Readonly<{
      ok: true
      plan: BackendProviderPlan
      diagnostics: readonly BackendDiagnostic[]
    }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>

export interface BackendArtifactManifestEntry {
  readonly path: string
  readonly kind: BackendProviderOutputKind
  readonly mediaType: string
  readonly byteLength: number
  readonly digest: string
}

export interface BackendArtifactManifestV1 {
  readonly format: 'openpencil.backend-artifacts.v1'
  readonly version: typeof BACKEND_ARTIFACT_MANIFEST_VERSION
  readonly authority: BackendProviderAuthority
  readonly applicationDigest: string
  readonly planDigest: string
  readonly target: CompilerTarget
  readonly mode: BackendCompilationMode
  readonly capabilities: readonly BackendCapabilityDecision[]
  readonly requiredSecrets: readonly BackendSecretRef[]
  readonly artifacts: readonly BackendArtifactManifestEntry[]
}

export interface BackendProviderEmission {
  readonly files: ReadonlyMap<string, string | Uint8Array>
  readonly manifestPath: string
  readonly manifest: BackendArtifactManifestV1
  readonly manifestDigest: string
  readonly diagnostics: readonly BackendDiagnostic[]
}

export type BackendProviderEmissionResult =
  | Readonly<{ ok: true; emission: BackendProviderEmission }>
  | Readonly<{ ok: false; diagnostics: readonly BackendDiagnostic[] }>
