/** Canonicalizes caller inputs before they reach the release state machine. */
import {
  BACKEND_PRODUCTION_GATE_IDS,
  isBackendCredentialRef,
  validateMigrationPlan,
  type BackendCredentialRef,
  type BackendProductionGateResultV1,
  type BackendReleaseArtifactKind,
  type MigrationPlan
} from '@open-pencil/lowcode/backend'

const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
const ARTIFACT_KINDS = ['static', 'server', 'schema'] as const

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

export function normalizedMigrationPlan(value: MigrationPlan): MigrationPlan {
  const validated = validateMigrationPlan(value)
  if (!validated.ok) {
    throw new TypeError(
      `Backend migration plan is invalid: ${validated.diagnostics
        .map((entry) => entry.code)
        .join(', ')}.`
    )
  }
  return deepFreeze(validated.value)
}

export function normalizedCredentialRefs(
  values: readonly BackendCredentialRef[] | undefined
): readonly BackendCredentialRef[] {
  const refs = values ?? []
  if (!Array.isArray(refs) || refs.some((value) => !isBackendCredentialRef(value))) {
    throw new TypeError('Backend Release requires only valid CredentialRef values, never secrets.')
  }
  return Object.freeze([...new Set(refs)].sort((left, right) => left.localeCompare(right)))
}

export function normalizedEnvironmentNames(
  values: readonly string[] | undefined
): readonly string[] {
  const names = values ?? []
  if (
    !Array.isArray(names) ||
    names.some((value) => typeof value !== 'string' || !ENVIRONMENT_NAME.test(value))
  ) {
    throw new TypeError('Backend Release environment requirements must contain only names.')
  }
  return Object.freeze([...new Set(names)].sort((left, right) => left.localeCompare(right)))
}

export function normalizedArtifactKinds(
  values: readonly BackendReleaseArtifactKind[]
): readonly BackendReleaseArtifactKind[] {
  if (
    !Array.isArray(values) ||
    values.some(
      (value) =>
        typeof value !== 'string' ||
        !ARTIFACT_KINDS.includes(value as (typeof ARTIFACT_KINDS)[number])
    )
  ) {
    throw new TypeError('Backend Release artifact requirements are invalid.')
  }
  return Object.freeze(
    ARTIFACT_KINDS.filter((kind) => values.includes(kind as BackendReleaseArtifactKind))
  )
}

export function failedVerificationGates(): readonly BackendProductionGateResultV1[] {
  return BACKEND_PRODUCTION_GATE_IDS.map((gate) => ({
    gate,
    status: 'failed' as const,
    checkedAt: null,
    evidenceDigest: null
  }))
}
