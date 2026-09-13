import { canonicalBackendValue, digestCanonicalBackendValue } from '#compiler/backend/canonical'
import type {
  BackendArtifactSource,
  BackendProviderAdapterContext
} from '#compiler/backend/contracts'
import type {
  BackendArtifactSourceV2,
  BackendProviderAdapterContextV2
} from '#compiler/backend/v2/contracts'

import {
  BACKEND_CAPABILITIES,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1,
  type BackendApplicationSpecV2,
  type BackendCapability
} from '@open-pencil/lowcode/backend'
import type { JSONValue } from '@open-pencil/scene-graph/primitives'

import {
  createSupabaseMigrationPlan,
  emitSupabaseDataArtifacts,
  emitSupabaseMigrationArtifact,
  SUPABASE_ARTIFACT_PATHS
} from '../artifacts'
import { SUPABASE_BACKEND_PROVIDER_DESCRIPTOR } from '../descriptor'
import { createSupabaseSecurityProposal, emitSupabaseSecurityArtifacts } from '../policy'
import { validateSupabaseBackendProvider } from '../validation'

export const SUPABASE_COMMON_ARTIFACT_PATHS_V2 = Object.freeze({
  databaseSchema: 'backend/supabase-v2/base/database-schema.json',
  migrationPlan: 'backend/supabase-v2/base/migration-plan.json',
  securityPolicy: 'backend/supabase-v2/base/rls-policy.sql',
  securityPolicyManifest: 'backend/supabase-v2/base/rls-policy.json'
} as const)

function isV1Capability(capability: string): capability is BackendCapability {
  return (BACKEND_CAPABILITIES as readonly string[]).includes(capability)
}

/** Strict common-subset lowering; V2-only behavior is never smuggled into the established V1 code. */
export function lowerSupabaseBackendApplicationV2ToV1(
  application: BackendApplicationSpecV2
): BackendApplicationSpecV1 {
  const parsed = parseBackendApplicationSpecV1({
    format: application.format,
    version: 1,
    applicationId: application.applicationId,
    dataModel: application.dataModel,
    auth: application.auth,
    workflows: application.workflows,
    ...(application.httpApi === undefined ? {} : { httpApi: application.httpApi }),
    ...(application.storage ? { storage: application.storage } : {}),
    capabilities: application.capabilities
      .filter((entry): entry is typeof entry & { capability: BackendCapability } =>
        isV1Capability(entry.capability)
      )
      .map((entry) => ({
        capability: entry.capability,
        required: entry.required,
        ...(entry.reason === undefined ? {} : { reason: entry.reason })
      })),
    secrets: application.secrets
  })
  if (!parsed.ok) {
    throw new TypeError('Supabase Backend V2 common-subset lowering failed closed.')
  }
  return parsed.value
}

function lowerSupabaseContextV2ToV1(
  context: BackendProviderAdapterContextV2
): BackendProviderAdapterContext {
  return Object.freeze({
    application: lowerSupabaseBackendApplicationV2ToV1(context.application),
    selection: Object.freeze({
      descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: context.selection.packageDigest,
      enabled: context.selection.enabled
    }),
    target: context.target,
    mode: context.mode,
    capabilities: Object.freeze(
      context.capabilities
        .filter((entry): entry is typeof entry & { capability: BackendCapability } =>
          isV1Capability(entry.capability)
        )
        .map((entry) => Object.freeze({ ...entry, capability: entry.capability }))
    )
  })
}

function assertExpectedPlan(plan: JSONValue, expected: JSONValue, path: string): void {
  if (
    digestCanonicalBackendValue(plan, `${path}.received`) !==
    digestCanonicalBackendValue(expected, `${path}.expected`)
  ) {
    throw new TypeError('Supabase Backend V2 common adapter plan does not match normalized IR.')
  }
}

function textArtifact(source: BackendArtifactSource): BackendArtifactSourceV2 {
  if (typeof source.content !== 'string') {
    throw new TypeError('Supabase Backend V2 permits text artifacts only.')
  }
  return Object.freeze({
    path: source.path,
    kind: source.kind,
    mediaType: source.mediaType,
    content: source.content
  })
}

function exactArtifacts(
  sources: readonly BackendArtifactSource[],
  paths: readonly { readonly source: string; readonly destination: string }[]
): readonly BackendArtifactSourceV2[] {
  return Object.freeze(
    paths.map((path) => {
      const source = sources.find((entry) => entry.path === path.source)
      if (!source) throw new TypeError('Expected Supabase common review artifact was not emitted.')
      return Object.freeze({ ...textArtifact(source), path: path.destination })
    })
  )
}

export function validateSupabaseCommonV2(context: BackendProviderAdapterContextV2) {
  return validateSupabaseBackendProvider(lowerSupabaseContextV2ToV1(context))
}

export function createSupabaseAuthPlanV2(context: BackendProviderAdapterContextV2): JSONValue {
  return canonicalBackendValue(
    {
      format: 'openpencil.supabase-auth-plan.v2',
      version: 2,
      applicationId: context.application.applicationId,
      auth: context.application.auth,
      sessionAuthority: 'host-authenticated-supabase-client',
      credentialAcceptedByGeneratedRealtimeHelper: false
    },
    '$.supabaseV2.authPlan'
  )
}

export function createSupabaseMigrationPlanV2(context: BackendProviderAdapterContextV2): JSONValue {
  return createSupabaseMigrationPlan(lowerSupabaseContextV2ToV1(context))
}

export function emitSupabaseMigrationArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  const legacy = lowerSupabaseContextV2ToV1(context)
  assertExpectedPlan(plan, createSupabaseMigrationPlan(legacy), '$.supabaseV2.migrations')
  return exactArtifacts(
    [...emitSupabaseDataArtifacts(legacy), ...emitSupabaseMigrationArtifact(legacy)],
    [
      {
        source: SUPABASE_ARTIFACT_PATHS.databaseSchema,
        destination: SUPABASE_COMMON_ARTIFACT_PATHS_V2.databaseSchema
      },
      {
        source: SUPABASE_ARTIFACT_PATHS.migrationPlan,
        destination: SUPABASE_COMMON_ARTIFACT_PATHS_V2.migrationPlan
      }
    ]
  )
}

export function createSupabaseSecurityPlanV2(context: BackendProviderAdapterContextV2): JSONValue {
  return createSupabaseSecurityProposal(lowerSupabaseContextV2ToV1(context))
}

export function emitSupabaseSecurityArtifactsV2(
  context: BackendProviderAdapterContextV2,
  plan: JSONValue
): readonly BackendArtifactSourceV2[] {
  const legacy = lowerSupabaseContextV2ToV1(context)
  assertExpectedPlan(plan, createSupabaseSecurityProposal(legacy), '$.supabaseV2.securityPolicy')
  return exactArtifacts(emitSupabaseSecurityArtifacts(legacy), [
    {
      source: SUPABASE_ARTIFACT_PATHS.securityPolicy,
      destination: SUPABASE_COMMON_ARTIFACT_PATHS_V2.securityPolicy
    },
    {
      source: SUPABASE_ARTIFACT_PATHS.securityPolicyManifest,
      destination: SUPABASE_COMMON_ARTIFACT_PATHS_V2.securityPolicyManifest
    }
  ])
}
