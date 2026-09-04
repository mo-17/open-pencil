import {
  cloneCanonicalBackendValue,
  digestCanonicalBackendValue,
  freezeBackendValue
} from '#compiler/backend/canonical'
import {
  type BackendArtifactManifestV2,
  type BackendArtifactManifestEntryV2,
  type BackendProviderAdapterContextV2,
  type BackendProviderPlanV2,
  type BackendProviderSelectionV2
} from '#compiler/backend/v2/contracts'
import { emitBackendProviderPlanV2 } from '#compiler/backend/v2/emit'
import type { BackendProviderRegistryV2 } from '#compiler/backend/v2/registry'

import {
  containsBackendSecretLikeMaterial,
  parseBackendApplicationSpecV2,
  type BackendLiteral
} from '@open-pencil/lowcode/backend'

import { formatSupabaseManagedMarker } from '../inspection'
import {
  createSupabaseBackfillPlanV2,
  resolvedSupabaseBackfillV2,
  SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2,
  SUPABASE_BACKFILL_ARTIFACT_PATHS_V2,
  validateSupabaseBackfillV2
} from './backfill'
import {
  SUPABASE_BACKEND_PROVIDER_ADAPTER_ID_V2,
  SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2,
  SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID_V2
} from './descriptor'

export const SUPABASE_BACKFILL_INSPECTION_SUBJECT_FORMAT_V1 =
  'openpencil.supabase-backfill-inspection-subject.v1' as const
export const SUPABASE_BACKFILL_INSPECTION_QUERY_FAMILY_V1 =
  'openpencil.supabase-backfill-catalog-inspection.v1' as const

interface BoundArtifactV1 {
  readonly path: string
  readonly digest: string
  readonly byteLength: number
}

export interface SupabaseBackfillInspectionSubjectV1 {
  readonly format: typeof SUPABASE_BACKFILL_INSPECTION_SUBJECT_FORMAT_V1
  readonly version: 1
  readonly providerId: 'supabase'
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly executionAuthorityCreated: false
  readonly providerAuthority: {
    readonly digest: string
    readonly pluginId: string
    readonly packageDigest: string
    readonly contributionId: string
    readonly adapterId: string
    readonly adapterVersion: string
  }
  readonly application: {
    readonly id: string
    readonly digest: string
  }
  readonly plan: {
    readonly digest: string
    readonly adapterPlanDigest: string
    readonly target: 'react' | 'vue'
    readonly mode: 'production'
  }
  readonly emission: {
    readonly manifestDigest: string
    readonly artifacts: {
      readonly migrationPlan: BoundArtifactV1
      readonly reviewManifest: BoundArtifactV1
      readonly reviewSqlTemplate: BoundArtifactV1
    }
  }
  readonly migration: {
    readonly id: string
    readonly digest: string
    readonly entity: {
      readonly id: string
      readonly table: string
      readonly marker: string
    }
    readonly cursor: {
      readonly fieldId: string
      readonly field: string
      readonly marker: string
      readonly primaryKeyMarker: string
      readonly postgresType: 'pg_catalog.int8'
      readonly identityGeneration: 'always'
      readonly minimum: 0
      readonly maximum: number
    }
    readonly target: {
      readonly fieldId: string
      readonly field: string
      readonly marker: string
      readonly postgresType: string
      readonly desiredNullable: false
      readonly expectedLiteral: BackendLiteral
      readonly enum: null | {
        readonly id: string
        readonly name: string
        readonly marker: string
        readonly orderedValues: readonly string[]
      }
    }
    readonly batchSize: number
    readonly maximumReceiptCount: number
    readonly maximumBatchReceiptCount: number
  }
  readonly inspection: {
    readonly queryFamily: typeof SUPABASE_BACKFILL_INSPECTION_QUERY_FAMILY_V1
    readonly catalogOnly: true
    readonly generatedReviewSqlIsAuthority: false
    readonly observedHighWaterIsLockedCapture: false
    readonly mayCreateReceipt: false
  }
}

export interface SupabaseBackfillInspectionSubjectEnvelopeV1 {
  readonly subject: SupabaseBackfillInspectionSubjectV1
  readonly subjectDigest: string
}

export interface CreateSupabaseBackfillInspectionSubjectInputV1 {
  readonly plan: BackendProviderPlanV2
  readonly selection: BackendProviderSelectionV2
}

const INPUT_KEYS = ['plan', 'selection'] as const
const ARTIFACT_ENTRY_KEYS = ['path', 'kind', 'mediaType', 'byteLength', 'digest'] as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const PACKAGE_DIGEST = /^(?:sha256|app-bundle-sha256):[A-Za-z0-9_-]{43}$/u

function sameCanonical(left: unknown, right: unknown, path: string): boolean {
  return (
    digestCanonicalBackendValue(left, `${path}.left`) ===
    digestCanonicalBackendValue(right, `${path}.right`)
  )
}

function containsSecretLikeData(value: unknown): boolean {
  if (typeof value === 'string') return containsBackendSecretLikeMaterial(value)
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((entry) => containsSecretLikeData(entry))
  return Object.entries(value).some(
    ([key, entry]) => containsBackendSecretLikeMaterial(key) || containsSecretLikeData(entry)
  )
}

function snapshotInput(value: unknown): CreateSupabaseBackfillInspectionSubjectInputV1 {
  try {
    const snapshot = cloneCanonicalBackendValue(value, '$.supabaseBackfillInspection.input')
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError('invalid input')
    }
    const keys = Object.keys(snapshot)
    if (
      keys.length !== INPUT_KEYS.length ||
      keys.some((key) => !INPUT_KEYS.includes(key as never))
    ) {
      throw new TypeError('invalid input keys')
    }
    const source = snapshot as CreateSupabaseBackfillInspectionSubjectInputV1
    return Object.freeze({
      plan: source.plan,
      selection: source.selection
    })
  } catch {
    throw new TypeError('Supabase backfill inspection input must be inert data.')
  }
}

function requireArtifact(
  manifest: BackendArtifactManifestV2,
  path: string,
  kind: BackendArtifactManifestEntryV2['kind'],
  mediaType: string
): BoundArtifactV1 {
  const matches = manifest.artifacts.filter((entry) => entry.path === path)
  if (matches.length !== 1) {
    throw new TypeError('Supabase backfill inspection requires one exact emitted review artifact.')
  }
  const entry = matches[0]
  const keys = Object.keys(entry)
  if (
    keys.length !== ARTIFACT_ENTRY_KEYS.length ||
    keys.some((key) => !ARTIFACT_ENTRY_KEYS.includes(key as never)) ||
    entry.kind !== kind ||
    entry.mediaType !== mediaType ||
    !Number.isSafeInteger(entry.byteLength) ||
    entry.byteLength < 1 ||
    !DIGEST.test(entry.digest)
  ) {
    throw new TypeError('Supabase backfill inspection emitted review artifact is invalid.')
  }
  return Object.freeze({ path: entry.path, digest: entry.digest, byteLength: entry.byteLength })
}

function assertPlanAuthority(plan: BackendProviderPlanV2): void {
  if (
    (plan as { readonly version: unknown }).version !== 2 ||
    plan.mode !== 'production' ||
    (plan.target !== 'react' && plan.target !== 'vue') ||
    plan.authority.providerId !== 'supabase' ||
    plan.authority.contributionId !== SUPABASE_BACKEND_PROVIDER_CONTRIBUTION_ID_V2 ||
    plan.authority.adapterId !== SUPABASE_BACKEND_PROVIDER_ADAPTER_ID_V2 ||
    plan.authority.adapterVersion !== SUPABASE_BACKEND_PROVIDER_ADAPTER_VERSION_V2 ||
    !DIGEST.test(plan.planDigest) ||
    !DIGEST.test(plan.applicationDigest) ||
    !PACKAGE_DIGEST.test(plan.authority.packageDigest)
  ) {
    throw new TypeError('Supabase backfill inspection plan authority is invalid.')
  }
  if (plan.planDigest !== backendProviderPlanDigest(plan)) {
    throw new TypeError('Supabase backfill inspection plan digest is invalid.')
  }
}

function contextForPlan(
  plan: BackendProviderPlanV2,
  selection: BackendProviderSelectionV2
): BackendProviderAdapterContextV2 {
  const applicationResult = parseBackendApplicationSpecV2(plan.application)
  if (!applicationResult.ok) {
    throw new TypeError('Supabase backfill inspection application is invalid.')
  }
  if (
    !sameCanonical(
      plan.actualCapabilities,
      SUPABASE_BACKFILL_ACTUAL_CAPABILITIES_V2,
      '$.capabilities'
    )
  ) {
    throw new TypeError('Supabase backfill inspection capability scope is invalid.')
  }
  const context: BackendProviderAdapterContextV2 = Object.freeze({
    application: applicationResult.value,
    selection,
    target: plan.target,
    mode: plan.mode,
    actualCapabilities: plan.actualCapabilities,
    capabilities: plan.capabilities
  })
  if (validateSupabaseBackfillV2(context).some((entry) => entry.severity === 'error')) {
    throw new TypeError('Supabase backfill inspection application is outside the reviewed subset.')
  }
  return context
}

function assertAdapterPlan(
  plan: BackendProviderPlanV2,
  context: BackendProviderAdapterContextV2
): void {
  const actualAdapterPlan = plan.adapterPlans.dataMigrations
  const expectedAdapterPlan = createSupabaseBackfillPlanV2(context)
  if (
    actualAdapterPlan === undefined ||
    !sameCanonical(actualAdapterPlan, expectedAdapterPlan, '$.adapterPlan')
  ) {
    throw new TypeError(
      'Supabase backfill inspection requires the trusted Supabase backfill adapter plan.'
    )
  }
}

function assertManifest(
  plan: BackendProviderPlanV2,
  manifest: BackendArtifactManifestV2,
  manifestDigest: string
): void {
  if (
    (manifest as { readonly format: unknown }).format !== 'openpencil.backend-artifacts.v2' ||
    (manifest as { readonly version: unknown }).version !== 2 ||
    manifest.applicationDigest !== plan.applicationDigest ||
    manifest.planDigest !== plan.planDigest ||
    manifest.target !== plan.target ||
    manifest.mode !== plan.mode ||
    !sameCanonical(manifest.authority, plan.authority, '$.manifestAuthority') ||
    !sameCanonical(
      manifest.actualCapabilities,
      plan.actualCapabilities,
      '$.manifestCapabilities'
    ) ||
    !sameCanonical(manifest.capabilities, plan.capabilities, '$.manifestDecisions')
  ) {
    throw new TypeError('Supabase backfill inspection artifact manifest does not match the plan.')
  }
  if (!DIGEST.test(manifestDigest)) {
    throw new TypeError('Supabase backfill inspection artifact manifest digest is invalid.')
  }
  const paths = manifest.artifacts.map((entry) => entry.path)
  if (new Set(paths).size !== paths.length) {
    throw new TypeError('Supabase backfill inspection artifact manifest contains duplicate paths.')
  }
}

function assertPlanAndManifest(
  plan: BackendProviderPlanV2,
  selection: BackendProviderSelectionV2,
  manifest: BackendArtifactManifestV2,
  manifestDigest: string
): BackendProviderAdapterContextV2 {
  assertPlanAuthority(plan)
  const context = contextForPlan(plan, selection)
  assertAdapterPlan(plan, context)
  assertManifest(plan, manifest, manifestDigest)
  return context
}

function backendProviderPlanDigest(plan: BackendProviderPlanV2): string {
  const { planDigest: _planDigest, ...payload } = plan
  return digestCanonicalBackendValue(payload, '$.supabaseBackfillInspection.planDigest')
}

/**
 * Derive the only compiler output that a trusted Host may use to choose its fixed catalog query.
 * This never accepts caller SQL and deliberately creates no execution or receipt authority.
 */
export function createSupabaseBackfillInspectionSubjectV1(
  registry: BackendProviderRegistryV2,
  input: CreateSupabaseBackfillInspectionSubjectInputV1
): SupabaseBackfillInspectionSubjectEnvelopeV1 {
  const { plan, selection } = snapshotInput(input)
  const emitted = emitBackendProviderPlanV2(registry, { plan, selection })
  if (!emitted.ok) {
    throw new TypeError(
      'Supabase backfill inspection requires a plan and emission from the trusted Provider registry.'
    )
  }
  const { manifest, manifestDigest } = emitted.emission
  const context = assertPlanAndManifest(plan, selection, manifest, manifestDigest)
  const migration = resolvedSupabaseBackfillV2(context.application)
  const entity = context.application.dataModel.entities.find(
    (entry) => entry.id === migration.entityId
  )
  const target = entity?.fields.find((entry) => entry.id === migration.transform.fieldId)
  if (!entity || !target) {
    throw new TypeError('Supabase backfill inspection target identity is unavailable.')
  }
  const targetEnum =
    target.type === 'enum'
      ? context.application.dataModel.enums.find((entry) => entry.id === target.enumId)
      : undefined
  if (target.type === 'enum' && !targetEnum) {
    throw new TypeError('Supabase backfill inspection enum identity is unavailable.')
  }
  const artifacts = Object.freeze({
    migrationPlan: requireArtifact(
      manifest,
      SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.migrationPlan,
      'migration-plan',
      'application/json'
    ),
    reviewManifest: requireArtifact(
      manifest,
      SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.reviewManifest,
      'deployment-manifest',
      'application/json'
    ),
    reviewSqlTemplate: requireArtifact(
      manifest,
      SUPABASE_BACKFILL_ARTIFACT_PATHS_V2.sql,
      'server-runtime',
      'application/sql; charset=utf-8'
    )
  })
  const subject = freezeBackendValue({
    format: SUPABASE_BACKFILL_INSPECTION_SUBJECT_FORMAT_V1,
    version: 1,
    providerId: 'supabase',
    reviewOnly: true,
    applyAvailable: false,
    releaseReady: false,
    executionAuthorityCreated: false,
    providerAuthority: {
      digest: digestCanonicalBackendValue(plan.authority, '$.supabaseBackfillInspection.authority'),
      pluginId: plan.authority.pluginId,
      packageDigest: plan.authority.packageDigest,
      contributionId: plan.authority.contributionId,
      adapterId: plan.authority.adapterId,
      adapterVersion: plan.authority.adapterVersion
    },
    application: {
      id: context.application.applicationId,
      digest: plan.applicationDigest
    },
    plan: {
      digest: plan.planDigest,
      adapterPlanDigest: digestCanonicalBackendValue(
        plan.adapterPlans.dataMigrations,
        '$.supabaseBackfillInspection.adapterPlan'
      ),
      target: plan.target,
      mode: plan.mode
    },
    emission: { manifestDigest, artifacts },
    migration: {
      id: migration.id,
      digest: migration.digest,
      entity: {
        id: migration.entityId,
        table: migration.table,
        marker: formatSupabaseManagedMarker('entity', migration.entityId)
      },
      cursor: {
        fieldId: migration.cursor.fieldId,
        field: migration.cursor.field,
        marker: formatSupabaseManagedMarker('field', migration.cursor.fieldId),
        primaryKeyMarker: formatSupabaseManagedMarker('primary-key', migration.entityId),
        postgresType: 'pg_catalog.int8',
        identityGeneration: migration.cursor.identityGenerationRequired,
        minimum: migration.cursor.minimum,
        maximum: migration.cursor.maximum
      },
      target: {
        fieldId: migration.transform.fieldId,
        field: migration.transform.field,
        marker: formatSupabaseManagedMarker('field', migration.transform.fieldId),
        postgresType: migration.transform.expectedPostgresType,
        desiredNullable: false,
        expectedLiteral: migration.transform.value,
        enum: targetEnum
          ? {
              id: targetEnum.id,
              name: targetEnum.name,
              marker: formatSupabaseManagedMarker('enum', targetEnum.id),
              orderedValues: [...targetEnum.values]
            }
          : null
      },
      batchSize: migration.batchSize,
      maximumReceiptCount: migration.maximumReceiptCount,
      maximumBatchReceiptCount: migration.maximumBatchReceiptCount
    },
    inspection: {
      queryFamily: SUPABASE_BACKFILL_INSPECTION_QUERY_FAMILY_V1,
      catalogOnly: true,
      generatedReviewSqlIsAuthority: false,
      observedHighWaterIsLockedCapture: false,
      mayCreateReceipt: false
    }
  }) as SupabaseBackfillInspectionSubjectV1
  if (containsSecretLikeData(subject)) {
    throw new TypeError('Supabase backfill inspection subject must remain secret-free.')
  }
  return Object.freeze({
    subject,
    subjectDigest: digestCanonicalBackendValue(subject, '$.supabaseBackfillInspection.subject')
  })
}
