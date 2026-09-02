import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { validateMigrationPlan } from '../migration'
import type { MigrationPlan } from '../types'
import { compareBackendReleaseAuthority, parseBackendReleaseAuthority } from './authority'
import type {
  BackendReleaseArtifactKind,
  BackendReleaseConfirmationBlocker,
  BackendReleaseConfirmationReadiness,
  BackendReleaseDestructiveConfirmationV1,
  BackendReleaseFreshnessResult,
  BackendReleaseMigrationBindingV1,
  BackendReleaseMigrationOperationV1,
  BackendReleasePlanPayloadV1,
  BackendReleasePlanV1,
  BackendReleaseApplySnapshotV1,
  CreateBackendReleasePlanInput,
  VerifiedBackendReleasePlanV1
} from './types'
import { BACKEND_RELEASE_PLAN_VERSION } from './types'
import {
  RELEASE_MAX_DESCRIPTION_LENGTH,
  exactArray,
  exactRecord,
  releaseCredentialRef,
  releaseDigest,
  releaseEnvironmentName,
  releaseIdentifier,
  releaseText,
  releaseTimestamp,
  sortedUniqueStrings,
  stringValue
} from './validation'
import { sealVerifiedBackendReleasePlan, verifyBackendReleasePlanDigest } from './verification'

const ARTIFACT_ORDER: readonly BackendReleaseArtifactKind[] = ['static', 'server', 'schema']

function normalizedArtifactKinds(
  values: readonly BackendReleaseArtifactKind[]
): BackendReleaseArtifactKind[] {
  if (values.length === 0) throw new TypeError('requiredArtifactKinds must not be empty')
  if (new Set(values).size !== values.length) {
    throw new TypeError('requiredArtifactKinds must not contain duplicates')
  }
  for (const value of values) {
    if (!ARTIFACT_ORDER.includes(value)) {
      throw new TypeError(`Unsupported backend release artifact kind: ${String(value)}`)
    }
  }
  return ARTIFACT_ORDER.filter((value) => values.includes(value))
}

async function migrationBinding(plan: MigrationPlan): Promise<BackendReleaseMigrationBindingV1> {
  const parsed = validateMigrationPlan(plan)
  if (!parsed.ok) {
    throw new TypeError(
      `Cannot bind invalid migration plan: ${parsed.diagnostics.map((entry) => entry.code).join(', ')}`
    )
  }
  const operations: BackendReleaseMigrationOperationV1[] = await Promise.all(
    parsed.value.operations.map(async (entry) => ({
      operationId: releaseIdentifier(entry.operation.id, 'migration.operation.id'),
      kind: releaseIdentifier(entry.operation.kind, 'migration.operation.kind'),
      risk: entry.risk,
      checksum: await digestCanonicalManifest(entry.operation),
      reason: releaseText(
        entry.reason,
        'migration.operation.reason',
        RELEASE_MAX_DESCRIPTION_LENGTH
      )
    }))
  )
  return {
    planId: releaseIdentifier(parsed.value.planId, 'migration.planId'),
    planDigest: await digestCanonicalManifest(parsed.value),
    fromModelDigest: parsed.value.fromModelDigest ?? null,
    targetModelDigest: releaseDigest(parsed.value.targetModelDigest, 'migration.targetModelDigest'),
    highestRisk: parsed.value.highestRisk,
    requiresBackup: parsed.value.requiresBackup,
    operations
  }
}

export async function createBackendReleasePlan(
  input: CreateBackendReleasePlanInput
): Promise<VerifiedBackendReleasePlanV1> {
  const payload: BackendReleasePlanPayloadV1 = {
    format: 'openpencil.backend-release-plan',
    version: BACKEND_RELEASE_PLAN_VERSION,
    planId: releaseIdentifier(input.planId, 'planId'),
    authority: parseBackendReleaseAuthority(input.authority),
    migration: await migrationBinding(input.migrationPlan),
    requiredArtifactKinds: normalizedArtifactKinds(input.requiredArtifactKinds),
    requiredEnvironmentNames: sortedUniqueStrings(
      input.requiredEnvironmentNames ?? [],
      'requiredEnvironmentNames',
      releaseEnvironmentName
    ),
    requiredCredentialRefs: sortedUniqueStrings(
      input.requiredCredentialRefs ?? [],
      'requiredCredentialRefs',
      releaseCredentialRef
    )
  }
  return sealVerifiedBackendReleasePlan({
    ...payload,
    planDigest: await digestCanonicalManifest(payload)
  })
}

export async function inspectBackendReleasePlanFreshness(
  plan: BackendReleasePlanV1,
  observed: BackendReleaseApplySnapshotV1
): Promise<BackendReleaseFreshnessResult> {
  const issues = compareBackendReleaseAuthority(plan.planDigest, plan.authority, observed)
  if (!(await verifyBackendReleasePlanDigest(plan))) {
    issues.unshift({
      field: 'planIntegrity',
      code: 'release-plan-integrity-invalid',
      message: 'The release plan payload no longer matches its reviewed digest.'
    })
  }
  return { stale: issues.length > 0, issues }
}

function confirmationBlocker(
  operationId: string,
  code: BackendReleaseConfirmationBlocker['code'],
  message: string
): BackendReleaseConfirmationBlocker {
  return { operationId, code, message }
}

function destructiveConfirmation(
  value: unknown,
  index: number
): BackendReleaseDestructiveConfirmationV1 {
  const path = `confirmations[${index}]`
  const source = exactRecord(value, path, [
    'planDigest',
    'operationId',
    'confirmed',
    'backendProviderId',
    'backupDescription',
    'providerRecoveryDescription',
    'confirmedAt'
  ])
  if (source.confirmed !== true) {
    throw new TypeError(`${path}.confirmed must be true`)
  }
  if (
    typeof source.backupDescription !== 'string' ||
    typeof source.providerRecoveryDescription !== 'string' ||
    typeof source.confirmedAt !== 'string'
  ) {
    throw new TypeError(`${path} confirmation details must be strings`)
  }
  return {
    planDigest: releaseDigest(
      stringValue(source.planDigest, `${path}.planDigest`),
      `${path}.planDigest`
    ),
    operationId: releaseIdentifier(
      stringValue(source.operationId, `${path}.operationId`),
      `${path}.operationId`
    ),
    confirmed: true,
    backendProviderId: releaseIdentifier(
      stringValue(source.backendProviderId, `${path}.backendProviderId`),
      `${path}.backendProviderId`
    ),
    backupDescription: releaseText(
      source.backupDescription,
      `${path}.backupDescription`,
      RELEASE_MAX_DESCRIPTION_LENGTH
    ),
    providerRecoveryDescription: releaseText(
      source.providerRecoveryDescription,
      `${path}.providerRecoveryDescription`,
      RELEASE_MAX_DESCRIPTION_LENGTH
    ),
    confirmedAt: releaseTimestamp(source.confirmedAt, `${path}.confirmedAt`)
  }
}

export function normalizeBackendReleaseDestructiveConfirmations(
  value: unknown
): BackendReleaseDestructiveConfirmationV1[] {
  return exactArray(value, 'confirmations').map(destructiveConfirmation)
}

export function evaluateDestructiveMigrationConfirmations(
  plan: BackendReleasePlanV1,
  confirmations: readonly BackendReleaseDestructiveConfirmationV1[]
): BackendReleaseConfirmationReadiness {
  const blockers: BackendReleaseConfirmationBlocker[] = []
  let normalized: BackendReleaseDestructiveConfirmationV1[]
  try {
    normalized = normalizeBackendReleaseDestructiveConfirmations(confirmations)
  } catch {
    return {
      ready: false,
      blockers: [
        confirmationBlocker(
          'invalid-confirmation',
          'destructive-confirmation-invalid',
          'Destructive confirmations must be exact plain data with confirmed=true.'
        )
      ]
    }
  }
  const destructiveIds = new Set(
    plan.migration.operations
      .filter((operation) => operation.risk === 'destructive')
      .map((operation) => operation.operationId)
  )
  const grouped = new Map<string, BackendReleaseDestructiveConfirmationV1[]>()
  for (const confirmation of normalized) {
    const entries = grouped.get(confirmation.operationId) ?? []
    entries.push(confirmation)
    grouped.set(confirmation.operationId, entries)
    if (!destructiveIds.has(confirmation.operationId)) {
      blockers.push(
        confirmationBlocker(
          confirmation.operationId,
          'destructive-confirmation-unexpected',
          'Confirmation references an operation that is not destructive in this plan.'
        )
      )
    }
  }

  for (const operationId of destructiveIds) {
    const entries = grouped.get(operationId) ?? []
    if (entries.length === 0) {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-confirmation-missing',
          'Every destructive migration operation requires a separate confirmation.'
        )
      )
      continue
    }
    if (entries.length > 1) {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-confirmation-duplicate',
          'A destructive migration operation must be confirmed exactly once.'
        )
      )
    }
    const confirmation = entries[0]
    if (confirmation.planDigest !== plan.planDigest) {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-confirmation-plan-mismatch',
          'Destructive confirmation belongs to a different plan digest.'
        )
      )
    }
    if (confirmation.backendProviderId !== plan.authority.backendProvider.providerId) {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-confirmation-provider-mismatch',
          'Provider-specific recovery instructions belong to a different provider.'
        )
      )
    }
    try {
      releaseTimestamp(confirmation.confirmedAt, 'confirmation.confirmedAt')
    } catch {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-confirmation-invalid',
          'Destructive confirmation has an invalid confirmation timestamp.'
        )
      )
    }
    if (
      confirmation.backupDescription.trim().length === 0 ||
      confirmation.backupDescription.length > RELEASE_MAX_DESCRIPTION_LENGTH
    ) {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-backup-description-required',
          'A bounded backup plan is required before destructive Apply.'
        )
      )
    }
    if (
      confirmation.providerRecoveryDescription.trim().length === 0 ||
      confirmation.providerRecoveryDescription.length > RELEASE_MAX_DESCRIPTION_LENGTH
    ) {
      blockers.push(
        confirmationBlocker(
          operationId,
          'destructive-provider-recovery-required',
          'Provider-specific recovery instructions are required; a generic down migration is not assumed.'
        )
      )
    }
  }
  return { ready: blockers.length === 0, blockers }
}
