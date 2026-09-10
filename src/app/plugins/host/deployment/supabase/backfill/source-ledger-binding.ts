/* oxlint-disable eslint(max-lines), eslint(complexity) -- Source-ledger evidence, testing trust root, and final scope materialization stay in one audit boundary. */
import {
  canonicalSupabaseInspectedSourceMigrationLedgerJSON,
  verifySupabaseInspectedSourceMigrationLedgerIntegrity,
  type SupabaseInspectedSourceMigrationLedgerV1
} from '@open-pencil/compiler/backend'
import {
  BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE,
  BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
  BACKEND_BACKFILL_EXECUTION_V2_VERSION,
  BACKEND_LIMITS,
  digestBackendBackfillExecutionScopeV2,
  digestBackendSourceLedgerAppliedPrefixV1,
  digestSourceMigrationLedger,
  parseBackendBackfillExecutionScopeV2,
  verifyBackendSourceLedgerBindingReceiptV1,
  verifySourceMigrationLedgerIntegrity,
  type BackendBackfillExecutionScopeV2,
  type BackendSourceLedgerBindingReceiptV1,
  type BackendSourceLedgerBindingSubjectV1,
  type SourceMigrationLedgerV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  trustedSupabaseBackfillLockedHighWaterCaptureV1,
  type SupabaseBackfillLockedHighWaterCaptureV1
} from './locked-high-water-capture'
import {
  trustedSupabaseBackfillReceiptV2ReviewContextV1,
  type SupabaseBackfillReceiptV2ReviewEnvelopeV1
} from './receipt/v2/review'

export const SUPABASE_BACKFILL_SOURCE_LEDGER_REVIEW_FORMAT =
  'openpencil.supabase-backfill-source-ledger-review.v1' as const
export const SUPABASE_BACKFILL_SOURCE_LEDGER_BINDING_FORMAT =
  'openpencil.supabase-backfill-source-ledger-binding.v1' as const
export const SUPABASE_BACKFILL_EXECUTION_SCOPE_V2_ENVELOPE_FORMAT =
  'openpencil.supabase-backfill-execution-scope-v2-envelope.v1' as const
export const SUPABASE_BACKFILL_SOURCE_LEDGER_CI_REQUEST_FORMAT =
  'openpencil.supabase-backfill-source-ledger-ci-verification-request.v1' as const
export const SUPABASE_BACKFILL_SOURCE_LEDGER_CI_RESPONSE_FORMAT =
  'openpencil.supabase-backfill-source-ledger-ci-verification-response.v1' as const
export const SUPABASE_INSPECTED_SOURCE_LEDGER_PATH =
  'supabase/openpencil-inspected-source-ledger.json' as const

const REVIEW_INPUT_KEYS = [
  'receiptReview',
  'bindingReceipt',
  'promotionLedger',
  'inspectedSourceLedgerJSON',
  'sourceMigrationSQL',
  'evaluatedAt'
] as const
const BIND_INPUT_KEYS = ['review', 'verifier'] as const
const MATERIALIZE_INPUT_KEYS = ['receiptReview', 'binding'] as const
const CI_RESPONSE_KEYS = [
  'format',
  'version',
  'verified',
  'testingOnly',
  'requestDigest',
  'reviewDigest',
  'bindingReceiptDigest',
  'subjectDigest',
  'attestationDigest',
  'sourceLedgerDigest',
  'trustRootId',
  'verifiedAt'
] as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

const REVIEW_BLOCKERS = Object.freeze([
  'source-ledger-ci-attestation-not-authenticated',
  'source-ledger-production-trust-root-not-bound',
  'receipt-zero-not-persisted',
  'bounded-runner-unavailable'
] as const)

export interface CreateSupabaseBackfillSourceLedgerReviewOptionsV1 {
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
  readonly bindingReceipt: BackendSourceLedgerBindingReceiptV1
  readonly promotionLedger: unknown
  readonly inspectedSourceLedgerJSON: string
  readonly sourceMigrationSQL: string
  readonly evaluatedAt: string
}

export interface SupabaseBackfillSourceLedgerReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_SOURCE_LEDGER_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly reviewOnly: true
  readonly testingOnly: false
  readonly sourceLedgerBound: false
  readonly ciAuthenticated: false
  readonly releaseReady: false
  readonly databaseAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    receiptReviewDigest: string
    scopeDraftDigest: string
    captureDigest: string
    providerAuthorityDigest: string
    applicationDigest: string
    migrationDigest: string
    migrationPlanDigest: string
    bindingReceiptDigest: string
    subjectDigest: string
    attestationDigest: string
    sourceLedgerDigest: string
    inspectedLedgerFileDigest: string
    inspectedLedgerHeadDigest: string
    inspectedLedgerEntryDigest: string
    sourceMigrationDigest: string
    stagingAppliedPrefixDigest: string
    stagingSchemaDigest: string
    stagingLastReceiptDigest: string
    stagingLastNoDriftReceiptDigest: string
  }>
  readonly authority: Readonly<{
    projectRef: string
    accountId: string
    sourceLedgerGrantGeneration: string
  }>
  readonly source: Readonly<{
    promotionLedgerId: string
    inspectedLedgerId: string
    inspectedLedgerPath: typeof SUPABASE_INSPECTED_SOURCE_LEDGER_PATH
    sourceMigrationId: string
    sourceMigrationPath: string
    appliedMigrationIds: readonly string[]
    drift: 'none'
  }>
  readonly ciEvidence: Readonly<{
    ciProvider: string
    repository: string
    workflow: string
    runId: string
    runAttempt: number
    protectedRef: string
    revision: string
    dbPushReceiptDigest: string
    databaseHistoryDigest: string
    structurallyVerifiedOnly: true
  }>
  readonly evaluatedAt: string
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillSourceLedgerReviewEnvelopeV1 {
  readonly review: SupabaseBackfillSourceLedgerReviewV1
  readonly reviewDigest: string
}

export interface SupabaseBackfillSourceLedgerCIVerificationRequestV1 {
  readonly format: typeof SUPABASE_BACKFILL_SOURCE_LEDGER_CI_REQUEST_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly reviewDigest: string
  readonly bindingReceiptDigest: string
  readonly subjectDigest: string
  readonly attestationDigest: string
  readonly sourceLedgerDigest: string
}

export interface SupabaseBackfillSourceLedgerCIVerificationResponseV1 {
  readonly format: typeof SUPABASE_BACKFILL_SOURCE_LEDGER_CI_RESPONSE_FORMAT
  readonly version: 1
  readonly verified: true
  readonly testingOnly: true
  readonly requestDigest: string
  readonly reviewDigest: string
  readonly bindingReceiptDigest: string
  readonly subjectDigest: string
  readonly attestationDigest: string
  readonly sourceLedgerDigest: string
  readonly trustRootId: string
  readonly verifiedAt: string
}

export interface SupabaseBackfillSourceLedgerCIVerifierForTestingV1 {
  verify(request: SupabaseBackfillSourceLedgerCIVerificationRequestV1): Promise<unknown>
}

export interface SupabaseBackfillSourceLedgerBindingV1 {
  readonly format: typeof SUPABASE_BACKFILL_SOURCE_LEDGER_BINDING_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly sourceLedgerBound: false
  readonly testingSourceLedgerBound: true
  readonly ciAuthenticated: false
  readonly testingCiVerified: true
  readonly releaseReady: false
  readonly databaseAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly reviewDigest: string
  readonly bindingDigest: string
  readonly bindings: SupabaseBackfillSourceLedgerReviewV1['bindings']
  readonly trust: Readonly<{
    trustRootId: string
    requestDigest: string
    verifiedAt: string
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1 {
  readonly format: typeof SUPABASE_BACKFILL_EXECUTION_SCOPE_V2_ENVELOPE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly sourceLedgerBound: false
  readonly testingSourceLedgerBound: true
  readonly ciAuthenticated: false
  readonly testingCiVerified: true
  readonly databaseAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseReady: false
  readonly sourceLedgerBindingDigest: string
  readonly scope: BackendBackfillExecutionScopeV2
  readonly scopeDigest: string
}

export type SupabaseBackfillSourceLedgerBindingErrorCode =
  | 'supabase-backfill-source-ledger-input-invalid'
  | 'supabase-backfill-source-ledger-receipt-review-proof-invalid'
  | 'supabase-backfill-source-ledger-promotion-ledger-invalid'
  | 'supabase-backfill-source-ledger-inspected-ledger-invalid'
  | 'supabase-backfill-source-ledger-source-artifact-invalid'
  | 'supabase-backfill-source-ledger-evidence-mismatch'
  | 'supabase-backfill-source-ledger-ci-verifier-untrusted'
  | 'supabase-backfill-source-ledger-ci-verification-failed'
  | 'supabase-backfill-source-ledger-proof-invalid'
  | 'supabase-backfill-source-ledger-proof-in-use'
  | 'supabase-backfill-source-ledger-proof-consumed'
  | 'supabase-backfill-source-ledger-digest-failed'

export class SupabaseBackfillSourceLedgerBindingError extends Error {
  constructor(readonly code: SupabaseBackfillSourceLedgerBindingErrorCode) {
    super(`Supabase backfill source-ledger binding failed: ${code}.`)
    this.name = 'SupabaseBackfillSourceLedgerBindingError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface TrustedReviewContext {
  readonly envelope: SupabaseBackfillSourceLedgerReviewEnvelopeV1
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
  readonly bindingReceipt: BackendSourceLedgerBindingReceiptV1
  readonly subject: BackendSourceLedgerBindingSubjectV1
}

interface TrustedBindingContext {
  readonly binding: SupabaseBackfillSourceLedgerBindingV1
  readonly review: TrustedReviewContext
}

export interface TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1 {
  readonly envelope: SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
  readonly binding: SupabaseBackfillSourceLedgerBindingV1
  readonly capture: SupabaseBackfillLockedHighWaterCaptureV1
}

const trustedReviews = new WeakMap<object, TrustedReviewContext>()
const pendingReviews = new WeakSet<object>()
const consumedReviews = new WeakSet<object>()
const trustedTestingVerifiers = new WeakMap<
  object,
  SupabaseBackfillSourceLedgerCIVerifierForTestingV1
>()
const trustedBindings = new WeakMap<object, TrustedBindingContext>()
const trustedScopes = new WeakMap<
  object,
  TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1
>()

function fail(code: SupabaseBackfillSourceLedgerBindingErrorCode): never {
  throw new SupabaseBackfillSourceLedgerBindingError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  let prototype: object | null
  let actual: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    actual = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  for (const key of keys) ownData(value, key)
  return value as UnknownRecord
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-source-ledger-digest-failed')
  }
}

async function textDigest(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const hashed = await crypto.subtle.digest('SHA-256', bytes)
    return encodeBase64URL(new Uint8Array(hashed))
  } catch {
    return fail('supabase-backfill-source-ledger-digest-failed')
  }
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string') return fail('supabase-backfill-source-ledger-input-invalid')
  if (new TextEncoder().encode(value).byteLength > BACKEND_LIMITS.maxCanonicalBytes) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  return value
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  return value
}

function sameAuthority(
  left: SourceMigrationLedgerV1['environments'][number]['targetAuthority'],
  right: BackendSourceLedgerBindingSubjectV1['staging']['targetAuthority']
): boolean {
  return (
    left !== null &&
    left.providerId === right.providerId &&
    left.providerAuthorityDigest === right.providerAuthorityDigest &&
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration &&
    left.environment === right.environment
  )
}

function currentReceiptContext(
  receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
): NonNullable<ReturnType<typeof trustedSupabaseBackfillReceiptV2ReviewContextV1>> {
  const context = trustedSupabaseBackfillReceiptV2ReviewContextV1(receiptReview)
  if (!context || !trustedSupabaseBackfillLockedHighWaterCaptureV1(context.capture)) {
    return fail('supabase-backfill-source-ledger-receipt-review-proof-invalid')
  }
  return context
}

async function promotionLedger(
  value: unknown,
  receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
): Promise<{
  ledger: SourceMigrationLedgerV1
  digest: string
  staging: SourceMigrationLedgerV1['environments'][number]
  sourceEntry: SourceMigrationLedgerV1['entries'][number]
  lastNoDriftReceiptDigest: string
  lastNoDriftCheckedAt: string
}> {
  const verified = await verifySourceMigrationLedgerIntegrity(value)
  if (!verified.ok) return fail('supabase-backfill-source-ledger-promotion-ledger-invalid')
  const ledger = verified.value
  if (ledger.ledgerId !== `supabase:${receiptReview.review.authority.projectRef}:promotion`) {
    return fail('supabase-backfill-source-ledger-promotion-ledger-invalid')
  }
  const staging = ledger.environments.find((entry) => entry.environment === 'staging')
  if (!staging) return fail('supabase-backfill-source-ledger-promotion-ledger-invalid')
  const sourceMigrationId = staging.appliedMigrationIds.at(-1)
  const sourceEntry = ledger.entries.find((entry) => entry.migrationId === sourceMigrationId)
  const latestDrift = [...ledger.driftRecords]
    .reverse()
    .find((entry) => entry.environment === 'staging')
  if (!sourceMigrationId || !sourceEntry || !latestDrift) {
    return fail('supabase-backfill-source-ledger-promotion-ledger-invalid')
  }
  if (
    staging.drift !== 'none' ||
    staging.schemaDigest === null ||
    staging.lastReceiptDigest === null ||
    latestDrift.status !== 'none' ||
    latestDrift.expectedSchemaDigest !== staging.schemaDigest ||
    latestDrift.observedSchemaDigest !== staging.schemaDigest ||
    latestDrift.providerReceipt.outcome !== 'succeeded' ||
    !sameAuthority(staging.targetAuthority, latestDrift.targetAuthority)
  ) {
    return fail('supabase-backfill-source-ledger-promotion-ledger-invalid')
  }
  let ledgerDigest: string
  try {
    ledgerDigest = await digestSourceMigrationLedger(ledger)
  } catch {
    return fail('supabase-backfill-source-ledger-promotion-ledger-invalid')
  }
  return Object.freeze({
    ledger,
    digest: ledgerDigest,
    staging,
    sourceEntry,
    lastNoDriftReceiptDigest: latestDrift.providerReceiptDigest,
    lastNoDriftCheckedAt: latestDrift.checkedAt
  })
}

async function inspectedLedger(
  json: string,
  projectRef: string,
  migrationId: string
): Promise<{
  ledger: SupabaseInspectedSourceMigrationLedgerV1
  fileDigest: string
  entry: SupabaseInspectedSourceMigrationLedgerV1['entries'][number]
}> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return fail('supabase-backfill-source-ledger-inspected-ledger-invalid')
  }
  const verified = verifySupabaseInspectedSourceMigrationLedgerIntegrity(parsed)
  if (!verified.ok || verified.value.ledgerId !== `supabase:${projectRef}:inspected`) {
    return fail('supabase-backfill-source-ledger-inspected-ledger-invalid')
  }
  const canonical = canonicalSupabaseInspectedSourceMigrationLedgerJSON(verified.value)
  const entry = verified.value.entries.find((candidate) => candidate.migrationId === migrationId)
  if (canonical !== json || !verified.value.headDigest || !entry) {
    return fail('supabase-backfill-source-ledger-inspected-ledger-invalid')
  }
  return Object.freeze({ ledger: verified.value, fileDigest: await textDigest(json), entry })
}

function requireLedgerRegistrationParity(
  promoted: Awaited<ReturnType<typeof promotionLedger>>,
  inspected: Awaited<ReturnType<typeof inspectedLedger>>
): void {
  if (promoted.ledger.entries.length !== inspected.ledger.entries.length) {
    return fail('supabase-backfill-source-ledger-evidence-mismatch')
  }
  for (const [index, promotionEntry] of promoted.ledger.entries.entries()) {
    const inspectedEntry = inspected.ledger.entries[index]
    if (
      inspectedEntry.sequence !== promotionEntry.sequence ||
      inspectedEntry.migrationId !== promotionEntry.migrationId ||
      inspectedEntry.name !== promotionEntry.name ||
      inspectedEntry.source.path !== promotionEntry.source.path ||
      inspectedEntry.source.digest !== promotionEntry.source.digest ||
      inspectedEntry.stagedExecutionPlanDigest !== promotionEntry.executionPlanDigest ||
      inspectedEntry.migrationPlanDigest !==
        promotionEntry.executionPlan.sourceMigrationPlan.planDigest ||
      inspectedEntry.registeredAt !== promotionEntry.registeredAt
    ) {
      return fail('supabase-backfill-source-ledger-evidence-mismatch')
    }
  }
}

async function expectedSubject(
  receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1,
  promoted: Awaited<ReturnType<typeof promotionLedger>>,
  inspected: Awaited<ReturnType<typeof inspectedLedger>>,
  sourceMigrationSQL: string
): Promise<BackendSourceLedgerBindingSubjectV1> {
  const scope = receiptReview.review.scopeDraft
  const sourceDigest = await textDigest(sourceMigrationSQL)
  if (
    promoted.sourceEntry.source.path !== inspected.entry.source.path ||
    promoted.sourceEntry.source.digest !== inspected.entry.source.digest ||
    sourceDigest !== promoted.sourceEntry.source.digest ||
    promoted.staging.targetAuthority === null ||
    promoted.staging.schemaDigest === null ||
    promoted.staging.lastReceiptDigest === null
  ) {
    return fail('supabase-backfill-source-ledger-source-artifact-invalid')
  }
  return Object.freeze({
    format: 'openpencil.backend-source-ledger-binding-subject' as const,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    projectRef: receiptReview.review.authority.projectRef,
    accountId: receiptReview.review.authority.accountId,
    providerAuthorityDigest: scope.providerAuthorityDigest,
    applicationId: scope.applicationId,
    applicationDigest: scope.applicationDigest,
    migrationId: scope.migrationId,
    migrationDigest: scope.migrationDigest,
    migrationPlanDigest: scope.migrationPlanDigest,
    sourceLedgerDigest: promoted.digest,
    promotionLedgerDigest: promoted.digest,
    sourceArtifact: Object.freeze({
      migrationId: promoted.sourceEntry.migrationId,
      phase: 'expand' as const,
      path: promoted.sourceEntry.source.path,
      digest: promoted.sourceEntry.source.digest,
      executionPlanDigest: promoted.sourceEntry.executionPlanDigest,
      migrationPlanDigest: promoted.sourceEntry.executionPlan.sourceMigrationPlan.planDigest
    }),
    inspectedLedger: Object.freeze({
      path: SUPABASE_INSPECTED_SOURCE_LEDGER_PATH,
      fileDigest: inspected.fileDigest,
      headDigest: inspected.ledger.headDigest as string,
      selectedEntryDigest: inspected.entry.entryDigest
    }),
    staging: Object.freeze({
      targetAuthority: promoted.staging.targetAuthority,
      schemaDigest: promoted.staging.schemaDigest,
      appliedMigrationIds: Object.freeze([...promoted.staging.appliedMigrationIds]),
      appliedPrefixDigest: await digestBackendSourceLedgerAppliedPrefixV1(
        promoted.staging.appliedMigrationIds
      ),
      lastReceiptDigest: promoted.staging.lastReceiptDigest,
      lastNoDriftReceiptDigest: promoted.lastNoDriftReceiptDigest,
      drift: 'none' as const
    })
  })
}

function uniqueBlockers(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)])
}

/**
 * Recompute every local ledger/file anchor and compare it with one portable receipt. The CI fields
 * remain untrusted claims here; this step performs no network, credential, filesystem, or SQL work.
 */
export async function createSupabaseBackfillSourceLedgerReviewV1(
  input: CreateSupabaseBackfillSourceLedgerReviewOptionsV1
): Promise<SupabaseBackfillSourceLedgerReviewEnvelopeV1> {
  const options = exactInput(input, REVIEW_INPUT_KEYS)
  const receiptReviewValue = ownData(options, 'receiptReview')
  const bindingReceiptValue = ownData(options, 'bindingReceipt')
  const promotionLedgerValue = ownData(options, 'promotionLedger')
  const inspectedJSON = boundedText(ownData(options, 'inspectedSourceLedgerJSON'))
  const sourceSQL = boundedText(ownData(options, 'sourceMigrationSQL'))
  const evaluatedAtValue = canonicalTimestamp(ownData(options, 'evaluatedAt'))
  if (
    receiptReviewValue === null ||
    typeof receiptReviewValue !== 'object' ||
    bindingReceiptValue === null ||
    typeof bindingReceiptValue !== 'object'
  ) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  const receiptReview = receiptReviewValue as SupabaseBackfillReceiptV2ReviewEnvelopeV1
  currentReceiptContext(receiptReview)
  const promoted = await promotionLedger(promotionLedgerValue, receiptReview)
  const inspected = await inspectedLedger(
    inspectedJSON,
    receiptReview.review.authority.projectRef,
    promoted.sourceEntry.migrationId
  )
  requireLedgerRegistrationParity(promoted, inspected)
  const subject = await expectedSubject(receiptReview, promoted, inspected, sourceSQL)
  const verified = await verifyBackendSourceLedgerBindingReceiptV1(bindingReceiptValue, {
    expectedSubject: subject,
    evaluatedAt: evaluatedAtValue
  })
  if (!verified.ok) return fail('supabase-backfill-source-ledger-evidence-mismatch')
  const bindingReceipt = verified.receipt
  const stagingAuthority = subject.staging.targetAuthority
  if (
    stagingAuthority.providerId !== 'supabase' ||
    stagingAuthority.environment !== 'staging' ||
    stagingAuthority.projectRef !== receiptReview.review.authority.projectRef ||
    stagingAuthority.accountId !== receiptReview.review.authority.accountId ||
    stagingAuthority.providerAuthorityDigest !==
      receiptReview.review.bindings.providerAuthorityDigest ||
    subject.staging.appliedMigrationIds.includes(subject.migrationId) ||
    promoted.sourceEntry.executionPlan.phase !== 'expand' ||
    Date.parse(bindingReceipt.attestation.attestedAt) <
      Math.max(
        Date.parse(promoted.ledger.updatedAt),
        Date.parse(inspected.ledger.updatedAt),
        Date.parse(promoted.lastNoDriftCheckedAt)
      )
  ) {
    return fail('supabase-backfill-source-ledger-evidence-mismatch')
  }
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_SOURCE_LEDGER_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    reviewOnly: true as const,
    testingOnly: false as const,
    sourceLedgerBound: false as const,
    ciAuthenticated: false as const,
    releaseReady: false as const,
    databaseAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      receiptReviewDigest: receiptReview.reviewDigest,
      scopeDraftDigest: receiptReview.review.bindings.scopeDraftDigest,
      captureDigest: receiptReview.review.bindings.captureDigest,
      providerAuthorityDigest: receiptReview.review.bindings.providerAuthorityDigest,
      applicationDigest: receiptReview.review.bindings.applicationDigest,
      migrationDigest: receiptReview.review.bindings.migrationDigest,
      migrationPlanDigest: receiptReview.review.scopeDraft.migrationPlanDigest,
      bindingReceiptDigest: verified.receiptDigest,
      subjectDigest: verified.subjectDigest,
      attestationDigest: verified.attestationDigest,
      sourceLedgerDigest: subject.sourceLedgerDigest,
      inspectedLedgerFileDigest: subject.inspectedLedger.fileDigest,
      inspectedLedgerHeadDigest: subject.inspectedLedger.headDigest,
      inspectedLedgerEntryDigest: subject.inspectedLedger.selectedEntryDigest,
      sourceMigrationDigest: subject.sourceArtifact.digest,
      stagingAppliedPrefixDigest: subject.staging.appliedPrefixDigest,
      stagingSchemaDigest: subject.staging.schemaDigest,
      stagingLastReceiptDigest: subject.staging.lastReceiptDigest,
      stagingLastNoDriftReceiptDigest: subject.staging.lastNoDriftReceiptDigest
    }),
    authority: Object.freeze({
      projectRef: subject.projectRef,
      accountId: subject.accountId,
      sourceLedgerGrantGeneration: subject.staging.targetAuthority.grantGeneration
    }),
    source: Object.freeze({
      promotionLedgerId: promoted.ledger.ledgerId,
      inspectedLedgerId: inspected.ledger.ledgerId,
      inspectedLedgerPath: SUPABASE_INSPECTED_SOURCE_LEDGER_PATH,
      sourceMigrationId: subject.sourceArtifact.migrationId,
      sourceMigrationPath: subject.sourceArtifact.path,
      appliedMigrationIds: subject.staging.appliedMigrationIds,
      drift: 'none' as const
    }),
    ciEvidence: Object.freeze({
      ciProvider: bindingReceipt.attestation.ciProvider,
      repository: bindingReceipt.attestation.repository,
      workflow: bindingReceipt.attestation.workflow,
      runId: bindingReceipt.attestation.runId,
      runAttempt: bindingReceipt.attestation.runAttempt,
      protectedRef: bindingReceipt.attestation.protectedRef,
      revision: bindingReceipt.attestation.revision,
      dbPushReceiptDigest: bindingReceipt.attestation.dbPushReceiptDigest,
      databaseHistoryDigest: bindingReceipt.attestation.databaseHistoryDigest,
      structurallyVerifiedOnly: true as const
    }),
    evaluatedAt: evaluatedAtValue,
    blockers: uniqueBlockers([...receiptReview.review.blockers, ...REVIEW_BLOCKERS])
  }) satisfies SupabaseBackfillSourceLedgerReviewV1
  const envelope = Object.freeze({ review, reviewDigest: await digest(review) })
  trustedReviews.set(envelope, Object.freeze({ envelope, receiptReview, bindingReceipt, subject }))
  return envelope
}

function ciRequest(
  context: TrustedReviewContext
): SupabaseBackfillSourceLedgerCIVerificationRequestV1 {
  const review = context.envelope.review
  return Object.freeze({
    format: SUPABASE_BACKFILL_SOURCE_LEDGER_CI_REQUEST_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    projectRef: review.authority.projectRef,
    accountId: review.authority.accountId,
    reviewDigest: context.envelope.reviewDigest,
    bindingReceiptDigest: review.bindings.bindingReceiptDigest,
    subjectDigest: review.bindings.subjectDigest,
    attestationDigest: review.bindings.attestationDigest,
    sourceLedgerDigest: review.bindings.sourceLedgerDigest
  })
}

function ciResponse(value: unknown): SupabaseBackfillSourceLedgerCIVerificationResponseV1 {
  const source = exactInput(value, CI_RESPONSE_KEYS)
  if (
    ownData(source, 'format') !== SUPABASE_BACKFILL_SOURCE_LEDGER_CI_RESPONSE_FORMAT ||
    ownData(source, 'version') !== 1 ||
    ownData(source, 'verified') !== true ||
    ownData(source, 'testingOnly') !== true
  ) {
    return fail('supabase-backfill-source-ledger-ci-verification-failed')
  }
  const text = (key: (typeof CI_RESPONSE_KEYS)[number]): string => {
    const result = ownData(source, key)
    if (typeof result !== 'string' || result.length === 0 || result.length > 512) {
      return fail('supabase-backfill-source-ledger-ci-verification-failed')
    }
    return result
  }
  const digestValue = (key: (typeof CI_RESPONSE_KEYS)[number]): string => {
    const result = text(key)
    if (!DIGEST.test(result)) return fail('supabase-backfill-source-ledger-ci-verification-failed')
    return result
  }
  const verifiedAtValue = text('verifiedAt')
  const trustRootId = text('trustRootId')
  if (!STABLE_ID.test(trustRootId)) {
    return fail('supabase-backfill-source-ledger-ci-verification-failed')
  }
  let verifiedAt: string
  try {
    verifiedAt = canonicalTimestamp(verifiedAtValue)
  } catch {
    return fail('supabase-backfill-source-ledger-ci-verification-failed')
  }
  return Object.freeze({
    format: SUPABASE_BACKFILL_SOURCE_LEDGER_CI_RESPONSE_FORMAT,
    version: 1,
    verified: true,
    testingOnly: true,
    requestDigest: digestValue('requestDigest'),
    reviewDigest: digestValue('reviewDigest'),
    bindingReceiptDigest: digestValue('bindingReceiptDigest'),
    subjectDigest: digestValue('subjectDigest'),
    attestationDigest: digestValue('attestationDigest'),
    sourceLedgerDigest: digestValue('sourceLedgerDigest'),
    trustRootId,
    verifiedAt
  })
}

/** Explicitly testing-only trust root; no production factory accepts an injected callback. */
export function createSupabaseBackfillSourceLedgerCIVerifierForTestingV1(
  verify: SupabaseBackfillSourceLedgerCIVerifierForTestingV1['verify']
): SupabaseBackfillSourceLedgerCIVerifierForTestingV1 {
  if (typeof verify !== 'function') return fail('supabase-backfill-source-ledger-input-invalid')
  const verifier = Object.freeze({ verify })
  trustedTestingVerifiers.set(verifier, verifier)
  return verifier
}

/** Authenticate the portable CI claim only through the testing trust root and retain provenance. */
export async function bindSupabaseBackfillSourceLedgerForTestingV1(input: {
  readonly review: SupabaseBackfillSourceLedgerReviewEnvelopeV1
  readonly verifier: SupabaseBackfillSourceLedgerCIVerifierForTestingV1
}): Promise<SupabaseBackfillSourceLedgerBindingV1> {
  const options = exactInput(input, BIND_INPUT_KEYS)
  const reviewValue = ownData(options, 'review')
  const verifierValue = ownData(options, 'verifier')
  if (
    reviewValue === null ||
    typeof reviewValue !== 'object' ||
    verifierValue === null ||
    typeof verifierValue !== 'object'
  ) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  const review = reviewValue as SupabaseBackfillSourceLedgerReviewEnvelopeV1
  const context = trustedReviews.get(review)
  if (!context) {
    return fail('supabase-backfill-source-ledger-proof-invalid')
  }
  currentReceiptContext(context.receiptReview)
  if (consumedReviews.has(review)) return fail('supabase-backfill-source-ledger-proof-consumed')
  if (pendingReviews.has(review)) return fail('supabase-backfill-source-ledger-proof-in-use')
  const verifier = trustedTestingVerifiers.get(verifierValue)
  if (!verifier) return fail('supabase-backfill-source-ledger-ci-verifier-untrusted')
  pendingReviews.add(review)
  try {
    const request = ciRequest(context)
    const requestDigest = await digest(request)
    let response: SupabaseBackfillSourceLedgerCIVerificationResponseV1
    try {
      response = ciResponse(await verifier.verify(request))
    } catch (cause) {
      if (cause instanceof SupabaseBackfillSourceLedgerBindingError) throw cause
      return fail('supabase-backfill-source-ledger-ci-verification-failed')
    }
    if (
      response.requestDigest !== requestDigest ||
      response.reviewDigest !== request.reviewDigest ||
      response.bindingReceiptDigest !== request.bindingReceiptDigest ||
      response.subjectDigest !== request.subjectDigest ||
      response.attestationDigest !== request.attestationDigest ||
      response.sourceLedgerDigest !== request.sourceLedgerDigest ||
      Date.parse(response.verifiedAt) <
        Math.max(
          Date.parse(context.bindingReceipt.recordedAt),
          Date.parse(context.envelope.review.evaluatedAt)
        )
    ) {
      return fail('supabase-backfill-source-ledger-ci-verification-failed')
    }
    currentReceiptContext(context.receiptReview)
    const withoutDigest = Object.freeze({
      format: SUPABASE_BACKFILL_SOURCE_LEDGER_BINDING_FORMAT,
      version: 1 as const,
      providerId: 'supabase' as const,
      environment: 'staging' as const,
      testingOnly: true as const,
      sourceLedgerBound: false as const,
      testingSourceLedgerBound: true as const,
      ciAuthenticated: false as const,
      testingCiVerified: true as const,
      releaseReady: false as const,
      databaseAuthorityCreated: false as const,
      executionAuthorityCreated: false as const,
      receiptAuthorityCreated: false as const,
      reviewDigest: review.reviewDigest,
      bindings: review.review.bindings,
      trust: Object.freeze({
        trustRootId: response.trustRootId,
        requestDigest,
        verifiedAt: response.verifiedAt
      }),
      blockers: uniqueBlockers([
        ...review.review.blockers.filter(
          (entry) => entry !== 'source-ledger-artifact-authority-binding-not-implemented'
        ),
        'source-ledger-testing-trust-root-only'
      ])
    })
    const binding = Object.freeze({
      ...withoutDigest,
      bindingDigest: await digest(withoutDigest)
    }) satisfies SupabaseBackfillSourceLedgerBindingV1
    consumedReviews.add(review)
    trustedBindings.set(binding, Object.freeze({ binding, review: context }))
    return binding
  } finally {
    pendingReviews.delete(review)
  }
}

/** Materialize the portable V2 scope without creating IDs, a database head, or execution permit. */
export async function materializeSupabaseBackfillExecutionScopeV2ForTestingV1(input: {
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
  readonly binding: SupabaseBackfillSourceLedgerBindingV1
}): Promise<SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1> {
  const options = exactInput(input, MATERIALIZE_INPUT_KEYS)
  const receiptReviewValue = ownData(options, 'receiptReview')
  const bindingValue = ownData(options, 'binding')
  if (
    receiptReviewValue === null ||
    typeof receiptReviewValue !== 'object' ||
    bindingValue === null ||
    typeof bindingValue !== 'object'
  ) {
    return fail('supabase-backfill-source-ledger-input-invalid')
  }
  const receiptReview = receiptReviewValue as SupabaseBackfillReceiptV2ReviewEnvelopeV1
  const binding = bindingValue as SupabaseBackfillSourceLedgerBindingV1
  const receiptContext = currentReceiptContext(receiptReview)
  const bindingContext = trustedBindings.get(binding)
  if (!bindingContext || bindingContext.review.receiptReview !== receiptReview) {
    return fail('supabase-backfill-source-ledger-proof-invalid')
  }
  const draft = receiptReview.review.scopeDraft
  const scope = parseBackendBackfillExecutionScopeV2({
    format: BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_V2_VERSION,
    providerId: draft.providerId,
    environment: draft.environment,
    providerAuthorityDigest: draft.providerAuthorityDigest,
    applicationId: draft.applicationId,
    applicationDigest: draft.applicationDigest,
    migrationId: draft.migrationId,
    migrationDigest: draft.migrationDigest,
    migrationPlanDigest: draft.migrationPlanDigest,
    sourceLedgerDigest: binding.bindings.sourceLedgerDigest,
    captureDigest: draft.captureDigest,
    receiptZeroEvidenceDigest: draft.receiptZeroEvidenceDigest,
    resourceIdentityDigest: draft.resourceIdentityDigest,
    catalogPreconditionDigest: draft.catalogPreconditionDigest,
    entityId: draft.entityId,
    cursorField: draft.cursorField,
    cursorFieldType: draft.cursorFieldType,
    targetField: draft.targetField,
    batchSize: draft.batchSize,
    maximumReceiptCount: draft.maximumReceiptCount,
    maximumBatchCount: draft.maximumBatchCount,
    capturedHighWater: draft.capturedHighWater,
    initialRemainingEligibleRowCount: draft.initialRemainingEligibleRowCount,
    initialRemainingTargetRowCount: draft.initialRemainingTargetRowCount,
    requiredBatchCount: draft.requiredBatchCount,
    requiredMatchedRowCount: draft.requiredMatchedRowCount,
    resumePolicy: draft.resumePolicy,
    completionRule: BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE
  })
  const envelope = Object.freeze({
    format: SUPABASE_BACKFILL_EXECUTION_SCOPE_V2_ENVELOPE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    sourceLedgerBound: false as const,
    testingSourceLedgerBound: true as const,
    ciAuthenticated: false as const,
    testingCiVerified: true as const,
    databaseAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseReady: false as const,
    sourceLedgerBindingDigest: binding.bindingDigest,
    scope,
    scopeDigest: await digestBackendBackfillExecutionScopeV2(scope)
  }) satisfies SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1
  trustedScopes.set(
    envelope,
    Object.freeze({ envelope, receiptReview, binding, capture: receiptContext.capture })
  )
  return envelope
}

/** Testing-only provenance for the future receipt-zero initializer; still no database authority. */
export function trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1(
  value: unknown
): TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedScopes.get(value)
  if (
    !context ||
    !trustedBindings.has(context.binding) ||
    !trustedSupabaseBackfillLockedHighWaterCaptureV1(context.capture)
  ) {
    return null
  }
  return context
}
