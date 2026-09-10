/* eslint-disable max-lines -- The complete source-ledger evidence envelope and fail-closed verifier stay together. */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { StagedMigrationExecutionTargetAuthorityV1 } from '../migration/execution'
import {
  compareReleaseTimestamps,
  exactArray,
  exactRecord,
  releaseDigest,
  releaseIdentifier,
  releaseText,
  releaseTimestamp,
  stringValue
} from './validation'

export const BACKEND_SOURCE_LEDGER_BINDING_VERSION = 1 as const
export const BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT =
  'openpencil.backend-source-ledger-binding-subject' as const
export const BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT =
  'openpencil.backend-source-ledger-ci-attestation' as const
export const BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT =
  'openpencil.backend-source-ledger-binding-receipt' as const
export const BACKEND_SOURCE_LEDGER_APPLIED_PREFIX_FORMAT =
  'openpencil.backend-source-ledger-applied-prefix' as const

const SUBJECT_KEYS = [
  'format',
  'version',
  'providerId',
  'environment',
  'projectRef',
  'accountId',
  'providerAuthorityDigest',
  'applicationId',
  'applicationDigest',
  'migrationId',
  'migrationDigest',
  'migrationPlanDigest',
  'sourceLedgerDigest',
  'promotionLedgerDigest',
  'sourceArtifact',
  'inspectedLedger',
  'staging'
] as const
const SOURCE_ARTIFACT_KEYS = [
  'migrationId',
  'phase',
  'path',
  'digest',
  'executionPlanDigest',
  'migrationPlanDigest'
] as const
const INSPECTED_LEDGER_KEYS = ['path', 'fileDigest', 'headDigest', 'selectedEntryDigest'] as const
const STAGING_KEYS = [
  'targetAuthority',
  'schemaDigest',
  'appliedMigrationIds',
  'appliedPrefixDigest',
  'lastReceiptDigest',
  'lastNoDriftReceiptDigest',
  'drift'
] as const
const TARGET_AUTHORITY_KEYS = [
  'providerId',
  'providerAuthorityDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'environment'
] as const
const ATTESTATION_KEYS = [
  'format',
  'version',
  'subjectDigest',
  'sourceLedgerDigest',
  'stagingProjectRef',
  'ciProvider',
  'repository',
  'workflow',
  'runId',
  'runAttempt',
  'protectedRef',
  'revision',
  'protectedRefVerified',
  'dbPushCommandDigest',
  'dbPushReceiptDigest',
  'databaseHistoryDigest',
  'succeeded',
  'unresolvedMutation',
  'attestedAt'
] as const
const RECEIPT_KEYS = [
  'format',
  'version',
  'subject',
  'subjectDigest',
  'attestation',
  'attestationDigest',
  'recordedAt'
] as const

export interface BackendSourceLedgerBindingSubjectV1 {
  readonly format: typeof BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT
  readonly version: typeof BACKEND_SOURCE_LEDGER_BINDING_VERSION
  readonly providerId: string
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly providerAuthorityDigest: string
  readonly applicationId: string
  readonly applicationDigest: string
  /** Logical data migration that will consume this P1 source prerequisite. */
  readonly migrationId: string
  readonly migrationDigest: string
  readonly migrationPlanDigest: string
  /** Canonical digest of the strict Apply/promotion ledger. */
  readonly sourceLedgerDigest: string
  /** Explicit alias that prevents an inspected-audit-ledger digest from being substituted. */
  readonly promotionLedgerDigest: string
  /** Last source migration in the applied prerequisite prefix, not the pending data migration. */
  readonly sourceArtifact: Readonly<{
    migrationId: string
    phase: 'expand'
    path: string
    digest: string
    executionPlanDigest: string
    migrationPlanDigest: string
  }>
  readonly inspectedLedger: Readonly<{
    path: string
    fileDigest: string
    headDigest: string
    selectedEntryDigest: string
  }>
  readonly staging: Readonly<{
    targetAuthority: StagedMigrationExecutionTargetAuthorityV1
    schemaDigest: string
    appliedMigrationIds: readonly string[]
    appliedPrefixDigest: string
    lastReceiptDigest: string
    lastNoDriftReceiptDigest: string
    drift: 'none'
  }>
}

export interface BackendSourceLedgerCIAttestationV1 {
  readonly format: typeof BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT
  readonly version: typeof BACKEND_SOURCE_LEDGER_BINDING_VERSION
  readonly subjectDigest: string
  readonly sourceLedgerDigest: string
  readonly stagingProjectRef: string
  readonly ciProvider: string
  readonly repository: string
  readonly workflow: string
  readonly runId: string
  readonly runAttempt: number
  readonly protectedRef: string
  readonly revision: string
  readonly protectedRefVerified: true
  readonly dbPushCommandDigest: string
  readonly dbPushReceiptDigest: string
  readonly databaseHistoryDigest: string
  readonly succeeded: true
  readonly unresolvedMutation: false
  readonly attestedAt: string
}

export interface BackendSourceLedgerBindingReceiptV1 {
  readonly format: typeof BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT
  readonly version: typeof BACKEND_SOURCE_LEDGER_BINDING_VERSION
  readonly subject: BackendSourceLedgerBindingSubjectV1
  readonly subjectDigest: string
  readonly attestation: BackendSourceLedgerCIAttestationV1
  readonly attestationDigest: string
  readonly recordedAt: string
}

export interface BackendSourceLedgerBindingVerificationContextV1 {
  /** Independently reconstructed expected subject; the receipt cannot choose this anchor. */
  readonly expectedSubject: BackendSourceLedgerBindingSubjectV1
  readonly evaluatedAt: string
}

interface NonAuthorityResult {
  readonly releaseReady: false
  readonly sourceLedgerAuthorityGranted: false
  readonly databaseAuthorityGranted: false
  readonly executionAuthorityGranted: false
  readonly ciAuthenticated: false
}

export type BackendSourceLedgerBindingVerificationV1 =
  | (NonAuthorityResult &
      Readonly<{
        ok: true
        receipt: BackendSourceLedgerBindingReceiptV1
        receiptDigest: string
        subjectDigest: string
        attestationDigest: string
      }>)
  | (NonAuthorityResult &
      Readonly<{
        ok: false
        code:
          | 'source-ledger-binding-invalid'
          | 'source-ledger-binding-digest-mismatch'
          | 'source-ledger-binding-subject-mismatch'
          | 'source-ledger-binding-attestation-mismatch'
          | 'source-ledger-binding-time-invalid'
        message: string
      }>)

function environment(
  value: unknown,
  path: string
): BackendSourceLedgerBindingSubjectV1['environment'] {
  if (value !== 'staging') throw new TypeError(`${path} must be staging`)
  return 'staging'
}

function trueValue(value: unknown, path: string): true {
  if (value !== true) throw new TypeError(`${path} must be true`)
  return true
}

function falseValue(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false`)
  return false
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

function orderedIdentifiers(value: unknown, path: string): readonly string[] {
  const entries = exactArray(value, path).map((entry, index) =>
    releaseIdentifier(stringValue(entry, `${path}[${index}]`), `${path}[${index}]`)
  )
  if (entries.length === 0 || new Set(entries).size !== entries.length) {
    throw new TypeError(`${path} must contain a non-empty unique applied prefix`)
  }
  return Object.freeze(entries)
}

function sourcePath(value: unknown, path: string): string {
  const parsed = releaseText(stringValue(value, path, 1_024), path, 1_024)
  if (
    parsed.startsWith('/') ||
    parsed.includes('\\') ||
    parsed.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${path} must be a normalized relative source path`)
  }
  return parsed
}

function targetAuthority(value: unknown, path: string): StagedMigrationExecutionTargetAuthorityV1 {
  const source = exactRecord(value, path, TARGET_AUTHORITY_KEYS)
  const parsedEnvironment = environment(source.environment, `${path}.environment`)
  return Object.freeze({
    providerId: releaseIdentifier(
      stringValue(source.providerId, `${path}.providerId`),
      `${path}.providerId`
    ),
    providerAuthorityDigest: releaseDigest(
      stringValue(source.providerAuthorityDigest, `${path}.providerAuthorityDigest`),
      `${path}.providerAuthorityDigest`
    ),
    projectRef: releaseIdentifier(
      stringValue(source.projectRef, `${path}.projectRef`),
      `${path}.projectRef`
    ),
    accountId: releaseIdentifier(
      stringValue(source.accountId, `${path}.accountId`),
      `${path}.accountId`
    ),
    grantGeneration: releaseIdentifier(
      stringValue(source.grantGeneration, `${path}.grantGeneration`),
      `${path}.grantGeneration`
    ),
    environment: parsedEnvironment
  })
}

export function parseBackendSourceLedgerBindingSubjectV1(
  value: unknown,
  path = '$.subject'
): BackendSourceLedgerBindingSubjectV1 {
  const source = exactRecord(value, path, SUBJECT_KEYS)
  if (source.format !== BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_SOURCE_LEDGER_BINDING_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  const parsedEnvironment = environment(source.environment, `${path}.environment`)
  const providerId = releaseIdentifier(
    stringValue(source.providerId, `${path}.providerId`),
    `${path}.providerId`
  )
  const projectRef = releaseIdentifier(
    stringValue(source.projectRef, `${path}.projectRef`),
    `${path}.projectRef`
  )
  const accountId = releaseIdentifier(
    stringValue(source.accountId, `${path}.accountId`),
    `${path}.accountId`
  )
  const providerAuthorityDigest = releaseDigest(
    stringValue(source.providerAuthorityDigest, `${path}.providerAuthorityDigest`),
    `${path}.providerAuthorityDigest`
  )
  const sourceLedgerDigest = releaseDigest(
    stringValue(source.sourceLedgerDigest, `${path}.sourceLedgerDigest`),
    `${path}.sourceLedgerDigest`
  )
  const promotionLedgerDigest = releaseDigest(
    stringValue(source.promotionLedgerDigest, `${path}.promotionLedgerDigest`),
    `${path}.promotionLedgerDigest`
  )
  if (sourceLedgerDigest !== promotionLedgerDigest) {
    throw new TypeError(`${path}.sourceLedgerDigest must equal promotionLedgerDigest`)
  }

  const artifactSource = exactRecord(
    source.sourceArtifact,
    `${path}.sourceArtifact`,
    SOURCE_ARTIFACT_KEYS
  )
  const inspectedSource = exactRecord(
    source.inspectedLedger,
    `${path}.inspectedLedger`,
    INSPECTED_LEDGER_KEYS
  )
  const stagingSource = exactRecord(source.staging, `${path}.staging`, STAGING_KEYS)
  const authority = targetAuthority(
    stagingSource.targetAuthority,
    `${path}.staging.targetAuthority`
  )
  const appliedMigrationIds = orderedIdentifiers(
    stagingSource.appliedMigrationIds,
    `${path}.staging.appliedMigrationIds`
  )
  const artifactMigrationId = releaseIdentifier(
    stringValue(artifactSource.migrationId, `${path}.sourceArtifact.migrationId`),
    `${path}.sourceArtifact.migrationId`
  )
  const migrationId = releaseIdentifier(
    stringValue(source.migrationId, `${path}.migrationId`),
    `${path}.migrationId`
  )
  if (artifactMigrationId !== appliedMigrationIds.at(-1)) {
    throw new TypeError(`${path}.sourceArtifact must identify the final applied prerequisite`)
  }
  if (appliedMigrationIds.includes(migrationId)) {
    throw new TypeError(`${path}.migrationId must remain outside the applied prerequisite prefix`)
  }
  if (artifactSource.phase !== 'expand') {
    throw new TypeError(`${path}.sourceArtifact.phase must be expand`)
  }
  if (
    authority.environment !== parsedEnvironment ||
    authority.providerId !== providerId ||
    authority.providerAuthorityDigest !== providerAuthorityDigest ||
    authority.projectRef !== projectRef ||
    authority.accountId !== accountId
  ) {
    throw new TypeError(`${path}.staging.targetAuthority does not match the subject`)
  }
  if (stagingSource.drift !== 'none') {
    throw new TypeError(`${path}.staging.drift must be none`)
  }

  return Object.freeze({
    format: BACKEND_SOURCE_LEDGER_BINDING_SUBJECT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    providerId,
    environment: parsedEnvironment,
    projectRef,
    accountId,
    providerAuthorityDigest,
    applicationId: releaseIdentifier(
      stringValue(source.applicationId, `${path}.applicationId`),
      `${path}.applicationId`
    ),
    applicationDigest: releaseDigest(
      stringValue(source.applicationDigest, `${path}.applicationDigest`),
      `${path}.applicationDigest`
    ),
    migrationId,
    migrationDigest: releaseDigest(
      stringValue(source.migrationDigest, `${path}.migrationDigest`),
      `${path}.migrationDigest`
    ),
    migrationPlanDigest: releaseDigest(
      stringValue(source.migrationPlanDigest, `${path}.migrationPlanDigest`),
      `${path}.migrationPlanDigest`
    ),
    sourceLedgerDigest,
    promotionLedgerDigest,
    sourceArtifact: Object.freeze({
      migrationId: artifactMigrationId,
      phase: 'expand' as const,
      path: sourcePath(artifactSource.path, `${path}.sourceArtifact.path`),
      digest: releaseDigest(
        stringValue(artifactSource.digest, `${path}.sourceArtifact.digest`),
        `${path}.sourceArtifact.digest`
      ),
      executionPlanDigest: releaseDigest(
        stringValue(
          artifactSource.executionPlanDigest,
          `${path}.sourceArtifact.executionPlanDigest`
        ),
        `${path}.sourceArtifact.executionPlanDigest`
      ),
      migrationPlanDigest: releaseDigest(
        stringValue(
          artifactSource.migrationPlanDigest,
          `${path}.sourceArtifact.migrationPlanDigest`
        ),
        `${path}.sourceArtifact.migrationPlanDigest`
      )
    }),
    inspectedLedger: Object.freeze({
      path: sourcePath(inspectedSource.path, `${path}.inspectedLedger.path`),
      fileDigest: releaseDigest(
        stringValue(inspectedSource.fileDigest, `${path}.inspectedLedger.fileDigest`),
        `${path}.inspectedLedger.fileDigest`
      ),
      headDigest: releaseDigest(
        stringValue(inspectedSource.headDigest, `${path}.inspectedLedger.headDigest`),
        `${path}.inspectedLedger.headDigest`
      ),
      selectedEntryDigest: releaseDigest(
        stringValue(
          inspectedSource.selectedEntryDigest,
          `${path}.inspectedLedger.selectedEntryDigest`
        ),
        `${path}.inspectedLedger.selectedEntryDigest`
      )
    }),
    staging: Object.freeze({
      targetAuthority: authority,
      schemaDigest: releaseDigest(
        stringValue(stagingSource.schemaDigest, `${path}.staging.schemaDigest`),
        `${path}.staging.schemaDigest`
      ),
      appliedMigrationIds,
      appliedPrefixDigest: releaseDigest(
        stringValue(stagingSource.appliedPrefixDigest, `${path}.staging.appliedPrefixDigest`),
        `${path}.staging.appliedPrefixDigest`
      ),
      lastReceiptDigest: releaseDigest(
        stringValue(stagingSource.lastReceiptDigest, `${path}.staging.lastReceiptDigest`),
        `${path}.staging.lastReceiptDigest`
      ),
      lastNoDriftReceiptDigest: releaseDigest(
        stringValue(
          stagingSource.lastNoDriftReceiptDigest,
          `${path}.staging.lastNoDriftReceiptDigest`
        ),
        `${path}.staging.lastNoDriftReceiptDigest`
      ),
      drift: 'none'
    })
  })
}

export function parseBackendSourceLedgerCIAttestationV1(
  value: unknown,
  path = '$.attestation'
): BackendSourceLedgerCIAttestationV1 {
  const source = exactRecord(value, path, ATTESTATION_KEYS)
  if (source.format !== BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_SOURCE_LEDGER_BINDING_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  return Object.freeze({
    format: BACKEND_SOURCE_LEDGER_CI_ATTESTATION_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    subjectDigest: releaseDigest(
      stringValue(source.subjectDigest, `${path}.subjectDigest`),
      `${path}.subjectDigest`
    ),
    sourceLedgerDigest: releaseDigest(
      stringValue(source.sourceLedgerDigest, `${path}.sourceLedgerDigest`),
      `${path}.sourceLedgerDigest`
    ),
    stagingProjectRef: releaseIdentifier(
      stringValue(source.stagingProjectRef, `${path}.stagingProjectRef`),
      `${path}.stagingProjectRef`
    ),
    ciProvider: releaseIdentifier(
      stringValue(source.ciProvider, `${path}.ciProvider`),
      `${path}.ciProvider`
    ),
    repository: releaseText(
      stringValue(source.repository, `${path}.repository`, 1_024),
      `${path}.repository`,
      1_024
    ),
    workflow: releaseIdentifier(
      stringValue(source.workflow, `${path}.workflow`),
      `${path}.workflow`
    ),
    runId: releaseIdentifier(stringValue(source.runId, `${path}.runId`), `${path}.runId`),
    runAttempt: positiveInteger(source.runAttempt, `${path}.runAttempt`),
    protectedRef: releaseText(
      stringValue(source.protectedRef, `${path}.protectedRef`, 1_024),
      `${path}.protectedRef`,
      1_024
    ),
    revision: releaseIdentifier(
      stringValue(source.revision, `${path}.revision`),
      `${path}.revision`
    ),
    protectedRefVerified: trueValue(source.protectedRefVerified, `${path}.protectedRefVerified`),
    dbPushCommandDigest: releaseDigest(
      stringValue(source.dbPushCommandDigest, `${path}.dbPushCommandDigest`),
      `${path}.dbPushCommandDigest`
    ),
    dbPushReceiptDigest: releaseDigest(
      stringValue(source.dbPushReceiptDigest, `${path}.dbPushReceiptDigest`),
      `${path}.dbPushReceiptDigest`
    ),
    databaseHistoryDigest: releaseDigest(
      stringValue(source.databaseHistoryDigest, `${path}.databaseHistoryDigest`),
      `${path}.databaseHistoryDigest`
    ),
    succeeded: trueValue(source.succeeded, `${path}.succeeded`),
    unresolvedMutation: falseValue(source.unresolvedMutation, `${path}.unresolvedMutation`),
    attestedAt: releaseTimestamp(
      stringValue(source.attestedAt, `${path}.attestedAt`),
      `${path}.attestedAt`
    )
  })
}

export function parseBackendSourceLedgerBindingReceiptV1(
  value: unknown,
  path = '$.receipt'
): BackendSourceLedgerBindingReceiptV1 {
  const source = exactRecord(value, path, RECEIPT_KEYS)
  if (source.format !== BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_SOURCE_LEDGER_BINDING_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  return Object.freeze({
    format: BACKEND_SOURCE_LEDGER_BINDING_RECEIPT_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    subject: parseBackendSourceLedgerBindingSubjectV1(source.subject, `${path}.subject`),
    subjectDigest: releaseDigest(
      stringValue(source.subjectDigest, `${path}.subjectDigest`),
      `${path}.subjectDigest`
    ),
    attestation: parseBackendSourceLedgerCIAttestationV1(source.attestation, `${path}.attestation`),
    attestationDigest: releaseDigest(
      stringValue(source.attestationDigest, `${path}.attestationDigest`),
      `${path}.attestationDigest`
    ),
    recordedAt: releaseTimestamp(
      stringValue(source.recordedAt, `${path}.recordedAt`),
      `${path}.recordedAt`
    )
  })
}

export function canonicalBackendSourceLedgerBindingSubjectV1Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendSourceLedgerBindingSubjectV1(value))
}

export function canonicalBackendSourceLedgerCIAttestationV1Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendSourceLedgerCIAttestationV1(value))
}

export function canonicalBackendSourceLedgerBindingReceiptV1Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendSourceLedgerBindingReceiptV1(value))
}

export async function digestBackendSourceLedgerAppliedPrefixV1(
  migrationIds: readonly string[]
): Promise<string> {
  const parsed = orderedIdentifiers(migrationIds, '$.appliedMigrationIds')
  return digestCanonicalManifest({
    format: BACKEND_SOURCE_LEDGER_APPLIED_PREFIX_FORMAT,
    version: BACKEND_SOURCE_LEDGER_BINDING_VERSION,
    migrationIds: parsed
  })
}

export async function digestBackendSourceLedgerBindingSubjectV1(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendSourceLedgerBindingSubjectV1(value))
}

export async function digestBackendSourceLedgerCIAttestationV1(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendSourceLedgerCIAttestationV1(value))
}

export async function digestBackendSourceLedgerBindingReceiptV1(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendSourceLedgerBindingReceiptV1(value))
}

function failure(
  code: Extract<BackendSourceLedgerBindingVerificationV1, { ok: false }>['code'],
  message: string
): BackendSourceLedgerBindingVerificationV1 {
  return Object.freeze({
    ok: false as const,
    code,
    message,
    releaseReady: false as const,
    sourceLedgerAuthorityGranted: false as const,
    databaseAuthorityGranted: false as const,
    executionAuthorityGranted: false as const,
    ciAuthenticated: false as const
  })
}

/**
 * Verify portable source/CI evidence only. Even a successful result does not authenticate the CI
 * producer, the repository, Supabase migration history, or any credential/Host trust root.
 */
export async function verifyBackendSourceLedgerBindingReceiptV1(
  value: unknown,
  context: BackendSourceLedgerBindingVerificationContextV1
): Promise<BackendSourceLedgerBindingVerificationV1> {
  let receipt: BackendSourceLedgerBindingReceiptV1
  let expectedSubject: BackendSourceLedgerBindingSubjectV1
  let evaluatedAt: string
  try {
    receipt = parseBackendSourceLedgerBindingReceiptV1(value)
    const source = exactRecord(context, '$.context', ['expectedSubject', 'evaluatedAt'])
    expectedSubject = parseBackendSourceLedgerBindingSubjectV1(
      source.expectedSubject,
      '$.context.expectedSubject'
    )
    evaluatedAt = releaseTimestamp(
      stringValue(source.evaluatedAt, '$.context.evaluatedAt'),
      '$.context.evaluatedAt'
    )
  } catch {
    return failure('source-ledger-binding-invalid', 'Source-ledger evidence has an invalid shape.')
  }

  const [subjectDigest, expectedSubjectDigest, attestationDigest, prefixDigest, receiptDigest] =
    await Promise.all([
      digestBackendSourceLedgerBindingSubjectV1(receipt.subject),
      digestBackendSourceLedgerBindingSubjectV1(expectedSubject),
      digestBackendSourceLedgerCIAttestationV1(receipt.attestation),
      digestBackendSourceLedgerAppliedPrefixV1(receipt.subject.staging.appliedMigrationIds),
      digestBackendSourceLedgerBindingReceiptV1(receipt)
    ])
  if (
    subjectDigest !== receipt.subjectDigest ||
    attestationDigest !== receipt.attestationDigest ||
    prefixDigest !== receipt.subject.staging.appliedPrefixDigest
  ) {
    return failure(
      'source-ledger-binding-digest-mismatch',
      'Source-ledger evidence contains a canonical digest mismatch.'
    )
  }
  if (subjectDigest !== expectedSubjectDigest) {
    return failure(
      'source-ledger-binding-subject-mismatch',
      'Source-ledger evidence does not match the independently expected subject.'
    )
  }
  if (
    receipt.attestation.subjectDigest !== subjectDigest ||
    receipt.attestation.sourceLedgerDigest !== receipt.subject.sourceLedgerDigest ||
    receipt.attestation.stagingProjectRef !== receipt.subject.projectRef
  ) {
    return failure(
      'source-ledger-binding-attestation-mismatch',
      'CI evidence does not bind the exact source-ledger subject.'
    )
  }
  if (
    compareReleaseTimestamps(
      receipt.attestation.attestedAt,
      receipt.recordedAt,
      '$.receipt.attestation.attestedAt',
      '$.receipt.recordedAt'
    ) > 0 ||
    compareReleaseTimestamps(
      receipt.recordedAt,
      evaluatedAt,
      '$.receipt.recordedAt',
      '$.context.evaluatedAt'
    ) > 0
  ) {
    return failure(
      'source-ledger-binding-time-invalid',
      'Source-ledger evidence is recorded out of order or in the future.'
    )
  }
  return Object.freeze({
    ok: true as const,
    receipt,
    receiptDigest,
    subjectDigest,
    attestationDigest,
    releaseReady: false as const,
    sourceLedgerAuthorityGranted: false as const,
    databaseAuthorityGranted: false as const,
    executionAuthorityGranted: false as const,
    ciAuthenticated: false as const
  })
}
