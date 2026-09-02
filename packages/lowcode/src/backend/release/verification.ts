import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { BackendDiagnostic, BackendValidationResult } from '../types'
import { parseBackendReleaseAuthority } from './authority'
import { freezeBackendReleaseData } from './state-authority'
import type {
  BackendReleaseArtifactKind,
  BackendReleaseMigrationBindingV1,
  BackendReleaseMigrationOperationV1,
  BackendReleasePlanPayloadV1,
  BackendReleasePlanV1,
  VerifiedBackendReleasePlanV1
} from './types'
import { BACKEND_RELEASE_PLAN_VERSION } from './types'
import {
  RELEASE_MAX_DESCRIPTION_LENGTH,
  exactArray,
  exactRecord,
  parseReleaseMigrationFields,
  parseReleaseMigrationOperationFields,
  releaseCredentialRef,
  releaseDigest,
  releaseEnvironmentName,
  releaseIdentifier,
  releaseText,
  stringArray,
  stringValue
} from './validation'

const VERIFIED_PLANS = new WeakSet<object>()
const ARTIFACT_ORDER: readonly BackendReleaseArtifactKind[] = ['static', 'server', 'schema']
const RISKS = ['low', 'medium', 'high', 'destructive'] as const

function diagnostic(cause: unknown): BackendDiagnostic {
  return {
    code: 'backend-release-plan-invalid',
    severity: 'error',
    path: '$',
    message: cause instanceof Error ? cause.message : 'Backend release plan is invalid.'
  }
}

export function sealVerifiedBackendReleasePlan(
  plan: BackendReleasePlanV1
): VerifiedBackendReleasePlanV1 {
  const frozen = freezeBackendReleaseData(plan)
  VERIFIED_PLANS.add(frozen)
  return frozen as VerifiedBackendReleasePlanV1
}

export function isVerifiedBackendReleasePlan(
  value: unknown
): value is VerifiedBackendReleasePlanV1 {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.isFrozen(value) &&
    VERIFIED_PLANS.has(value)
  )
}

export function backendReleasePlanPayload(plan: BackendReleasePlanV1): BackendReleasePlanPayloadV1 {
  return {
    format: plan.format,
    version: plan.version,
    planId: plan.planId,
    authority: plan.authority,
    migration: plan.migration,
    requiredArtifactKinds: plan.requiredArtifactKinds,
    requiredEnvironmentNames: plan.requiredEnvironmentNames,
    requiredCredentialRefs: plan.requiredCredentialRefs
  }
}

function migrationOperation(value: unknown, index: number): BackendReleaseMigrationOperationV1 {
  const parsed = parseReleaseMigrationOperationFields(value, index, [
    'operationId',
    'kind',
    'risk',
    'checksum',
    'reason'
  ])
  return {
    ...parsed.value,
    reason: releaseText(
      stringValue(parsed.source.reason, `${parsed.path}.reason`, RELEASE_MAX_DESCRIPTION_LENGTH),
      `${parsed.path}.reason`,
      RELEASE_MAX_DESCRIPTION_LENGTH
    )
  }
}

function highestRisk(
  operations: readonly BackendReleaseMigrationOperationV1[]
): BackendReleaseMigrationBindingV1['highestRisk'] {
  let highest: BackendReleaseMigrationBindingV1['highestRisk'] = 'low'
  for (const operation of operations) {
    if (RISKS.indexOf(operation.risk) > RISKS.indexOf(highest)) highest = operation.risk
  }
  return highest
}

function migrationBinding(value: unknown): BackendReleaseMigrationBindingV1 {
  const parsed = parseReleaseMigrationFields(
    value,
    [
      'planId',
      'planDigest',
      'fromModelDigest',
      'targetModelDigest',
      'highestRisk',
      'requiresBackup',
      'operations'
    ],
    migrationOperation
  )
  const { source } = parsed
  const { operations } = parsed.value
  const derivedRisk = highestRisk(operations)
  if (source.highestRisk !== derivedRisk) {
    throw new TypeError('$.migration.highestRisk does not match the bound operations')
  }
  const requiresBackup = derivedRisk === 'high' || derivedRisk === 'destructive'
  if (source.requiresBackup !== requiresBackup) {
    throw new TypeError('$.migration.requiresBackup does not match the bound risk')
  }
  return {
    ...parsed.value,
    highestRisk: derivedRisk,
    requiresBackup
  }
}

function artifactKinds(value: unknown): BackendReleaseArtifactKind[] {
  const entries = exactArray(value, '$.requiredArtifactKinds')
  if (entries.length === 0) throw new TypeError('$.requiredArtifactKinds must not be empty')
  const accepted = entries.map((entry, index) => {
    if (
      typeof entry !== 'string' ||
      !ARTIFACT_ORDER.includes(entry as BackendReleaseArtifactKind)
    ) {
      throw new TypeError(`$.requiredArtifactKinds[${index}] is not supported`)
    }
    return entry as BackendReleaseArtifactKind
  })
  if (new Set(accepted).size !== accepted.length) {
    throw new TypeError('$.requiredArtifactKinds must not contain duplicates')
  }
  const normalized = ARTIFACT_ORDER.filter((kind) => accepted.includes(kind))
  if (normalized.some((kind, index) => kind !== accepted[index])) {
    throw new TypeError('$.requiredArtifactKinds must use canonical order')
  }
  return normalized
}

function parsedPlan(value: unknown): BackendReleasePlanV1 {
  const source = exactRecord(value, '$', [
    'format',
    'version',
    'planId',
    'authority',
    'migration',
    'requiredArtifactKinds',
    'requiredEnvironmentNames',
    'requiredCredentialRefs',
    'planDigest'
  ])
  if (source.format !== 'openpencil.backend-release-plan') {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_RELEASE_PLAN_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  return {
    format: 'openpencil.backend-release-plan',
    version: BACKEND_RELEASE_PLAN_VERSION,
    planId: releaseIdentifier(stringValue(source.planId, '$.planId'), '$.planId'),
    authority: parseBackendReleaseAuthority(source.authority),
    migration: migrationBinding(source.migration),
    requiredArtifactKinds: artifactKinds(source.requiredArtifactKinds),
    requiredEnvironmentNames: stringArray(
      source.requiredEnvironmentNames,
      '$.requiredEnvironmentNames',
      releaseEnvironmentName
    ),
    requiredCredentialRefs: stringArray(
      source.requiredCredentialRefs,
      '$.requiredCredentialRefs',
      releaseCredentialRef
    ),
    planDigest: releaseDigest(stringValue(source.planDigest, '$.planDigest'), '$.planDigest')
  }
}

export async function verifyBackendReleasePlan(
  value: unknown
): Promise<BackendValidationResult<VerifiedBackendReleasePlanV1>> {
  if (isVerifiedBackendReleasePlan(value)) {
    return { ok: true, value, diagnostics: [] }
  }
  try {
    const plan = parsedPlan(value)
    const digest = await digestCanonicalManifest(backendReleasePlanPayload(plan))
    if (digest !== plan.planDigest) {
      throw new TypeError('$.planDigest does not match the canonical release plan payload')
    }
    return { ok: true, value: sealVerifiedBackendReleasePlan(plan), diagnostics: [] }
  } catch (cause) {
    return { ok: false, diagnostics: [diagnostic(cause)] }
  }
}

export async function verifyBackendReleasePlanDigest(value: unknown): Promise<boolean> {
  return (await verifyBackendReleasePlan(value)).ok
}
