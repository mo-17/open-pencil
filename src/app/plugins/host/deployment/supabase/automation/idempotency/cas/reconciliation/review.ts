/* oxlint-disable eslint(max-lines), eslint(complexity) -- Fixed SQL, immutable CAS snapshot, and authority boundary form one contract. */

import {
  canonicalBackendAutomationIdempotencyCASProposalBytes,
  canonicalBackendAutomationIdempotencyRecordBytes,
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  verifyBackendAutomationIdempotencyCASProposal
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA,
  trustedSupabaseAutomationIdempotencyCASReviewContextV1,
  type SupabaseAutomationIdempotencyCASReviewEnvelopeV1,
  type TrustedSupabaseAutomationIdempotencyCASReviewContextV1
} from '../review'
import SQL_SOURCE from './v1.sql?raw'

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_REVIEW_FORMAT =
  'openpencil.supabase-automation-idempotency-cas-reconciliation-review.v1' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_ID =
  'supabase-automation-idempotency-cas-reconciliation' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION =
  'openpencil-supabase-automation-idempotency-cas-reconciliation-v1' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_ARTIFACT_PATH =
  'backend/supabase-v2/automation/idempotency-cas-reconciliation-review.sql' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL =
  '__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL_COUNT = 17 as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_BYTE_LENGTH =
  72_823 as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_SHA256_HEX =
  '7129d8eed3ad3a4ec66467c3c6f8572e64a8789a698aa553fe9752a36575b7ea' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_DIGEST =
  'cSnY7tOtOk7GZGfDxvhXLmSoeJppiqVT_pdSo2V1t-o' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES = 128 * 1024

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESULT_STATES = Object.freeze([
  'absent',
  'exact-replay',
  'advanced-head',
  'cas-conflict',
  'corruption',
  'precondition-failed'
] as const)

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS = Object.freeze([
  'queryVersion',
  'proposalDigest',
  'recordDigest',
  'reportedStatus',
  'inputValid',
  'runtimeReady',
  'fullLedgerShapeVerified',
  'headCount',
  'headRevision',
  'revisionCount',
  'revisionMinimum',
  'revisionMaximum',
  'exactInitialRevisionCount',
  'exactPredecessorLinkCount',
  'exactHeadTipCount',
  'candidateCount',
  'candidateDigestMatchCount',
  'candidateExactCount',
  'expectedHeadMatchCount',
  'transactionReadOnly',
  'databasePrimary',
  'sessionReplicationRoleOrigin',
  'schemaMarkerDigest',
  'serverVersionNum',
  'snapshotDigest',
  'observedAt'
] as const)

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN = Object.freeze({
  name: 'observation' as const,
  pgType: 'text' as const,
  nullable: false as const
})

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER =
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA =
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE = SQL_SOURCE

export type SupabaseAutomationIdempotencyCASReconciliationStateV1 =
  (typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESULT_STATES)[number]
type ParameterValue = string | number | false | null | readonly string[]
type ParameterValues = readonly ParameterValue[]

export interface CreateSupabaseAutomationIdempotencyCASReconciliationReviewForTestingOptionsV1 {
  readonly casReview: SupabaseAutomationIdempotencyCASReviewEnvelopeV1
}

export interface SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1 {
  readonly review: SupabaseAutomationIdempotencyCASReconciliationReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

export interface SupabaseAutomationIdempotencyCASReconciliationReviewV1 {
  readonly format: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly productionReachable: false
  readonly databaseLedgerBound: false
  readonly reconciliationAuthorityCreated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly automaticRetryAllowed: false
  readonly releaseReady: false
  readonly bindings: Readonly<{
    casReviewDigest: string
    casRenderedSqlDigest: string
    proposalDigest: string
    recordDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    reconciliationSqlTemplateDigest: string
    reconciliationSqlDigest: string
    reconciliationQueryDigest: string
    schemaMarkerDigest: string
  }>
  readonly query: Readonly<{
    queryId: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_ID
    queryVersion: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION
    schemaName: string
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
    statementCount: 1
    responseShape: 'one-row-one-non-null-text-json-column'
    responseColumn: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN
    responseFields: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS
    responseMaximumBytes: number
    hostMustRecomputeStatusFromFacts: true
    reportedStatusCrossCheckOnly: true
    dmlAllowed: false
    ddlAllowed: false
    callAllowed: false
    rowLocksUsed: false
    callerSqlAccepted: false
    callerSchemaAccepted: false
    requiresDedicatedReadOnlyRole: true
    dedicatedReadOnlyRole: 'supabase_read_only_user'
    requiresTransportEnforcedReadOnlyTransaction: true
    requiresBoundedStatementTimeout: true
    liveTransportCreated: false
  }>
  readonly parameters: Readonly<{
    order: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER
    schema: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA
    valueCount: 27
    valuesExposed: false
    reusedFromCASImmutableSnapshot: true
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_ARTIFACT_PATH
    kind: 'automation-idempotency-cas-reconciliation-fixed-read-review'
    mediaType: 'application/sql; charset=utf-8'
    schemaName: string
    byteLength: number
    digest: string
    templateDigest: string
    containsCatalogRead: true
    containsManagedDataRead: true
    containsDml: false
    containsDdl: false
    containsCall: false
    containsRowLock: false
    requestDispatched: false
  }>
  readonly policy: Readonly<{
    absentProvesPriorMutationStopped: false
    advancedHeadIsRelationalOnly: true
    reportedStatusCreatesAuthority: false
    reportedStatusProvesDatabaseState: false
    commitOutcomeResolved: false
    databaseCASCommitted: false
    automaticRetryAllowed: false
    managementTransportCompatible: false
    productionResponseAuthenticated: false
  }>
  readonly blockers: readonly string[]
}

export interface TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1 {
  readonly envelope: SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1
  readonly casContext: TrustedSupabaseAutomationIdempotencyCASReviewContextV1
  readonly applicationObjectKey: string
  readonly schemaName: string
  readonly sql: string
  readonly parameters: ParameterValues
}

export type SupabaseAutomationIdempotencyCASReconciliationReviewErrorCode =
  | 'supabase-automation-idempotency-cas-reconciliation-input-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-proof-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-cas-review-changed'
  | 'supabase-automation-idempotency-cas-reconciliation-template-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-digest-failed'

export class SupabaseAutomationIdempotencyCASReconciliationReviewError extends Error {
  constructor(readonly code: SupabaseAutomationIdempotencyCASReconciliationReviewErrorCode) {
    super(code)
    this.name = 'SupabaseAutomationIdempotencyCASReconciliationReviewError'
  }
}

type UnknownRecord = Record<PropertyKey, unknown>
const INPUT_KEYS = Object.freeze(['casReview'] as const)
const APPLICATION_OBJECT_KEY = /^[a-z0-9_-]{20}$/u
const SCHEMA_NAME = /^op_automation_([a-z0-9_-]{20})$/u
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const BLOCKERS = Object.freeze([
  'testing-only-review-is-production-unreachable',
  'production-fixed-read-transport-is-not-wired',
  'specific-database-installation-is-not-authenticated',
  'dedicated-read-only-role-and-transaction-are-not-established',
  'reported-status-is-only-a-cross-check-of-injected-facts',
  'commit-outcome-remains-unresolved-without-authenticated-readback',
  'absent-never-proves-that-a-prior-mutation-stopped',
  'advanced-head-is-relational-only',
  'automatic-retry-is-forbidden'
] as const)
const trustedReviews = new WeakMap<
  object,
  TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1
>()

function fail(code: SupabaseAutomationIdempotencyCASReconciliationReviewErrorCode): never {
  throw new SupabaseAutomationIdempotencyCASReconciliationReviewError(code)
}

function snapshotDataRecord(value: unknown, expectedKeys: readonly string[]): UnknownRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
    }
    const snapshot = Object.create(null) as UnknownRecord
    for (const key of expectedKeys) {
      const descriptor = descriptors[key]
      if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
      }
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false
      })
    }
    return Object.freeze(snapshot)
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReconciliationReviewError) throw cause
    return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
  }
}

function assertCloneableWithoutProxy(value: unknown): void {
  try {
    structuredClone(value)
  } catch {
    return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
  }
}

function requireTrustedCASReview(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASReviewContextV1 {
  const context = trustedSupabaseAutomationIdempotencyCASReviewContextV1(value)
  if (!context || context.envelope !== value) {
    return fail('supabase-automation-idempotency-cas-reconciliation-proof-invalid')
  }
  const review = context.envelope.review
  if (
    review.transaction.schemaName !== review.artifact.schemaName ||
    review.parameters.order !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER ||
    review.parameters.schema !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA ||
    context.envelope.previewSql !== context.sql ||
    !Array.isArray(context.parameters) ||
    Object.getPrototypeOf(context.parameters) !== Array.prototype ||
    context.parameters.length !== 27
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-cas-review-changed')
  }
  return context
}

function schemaBinding(
  schemaName: string
): Readonly<{ applicationObjectKey: string; schemaName: string }> {
  const match = SCHEMA_NAME.exec(schemaName)
  if (!match || !APPLICATION_OBJECT_KEY.test(match[1])) {
    return fail('supabase-automation-idempotency-cas-reconciliation-cas-review-changed')
  }
  return Object.freeze({ applicationObjectKey: match[1], schemaName })
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function immutableParameterSnapshot(parameters: ParameterValues): ParameterValues {
  const values: ParameterValue[] = []
  for (const value of parameters) {
    values.push(Array.isArray(value) ? Object.freeze([...value]) : value)
  }
  return Object.freeze(values)
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-automation-idempotency-cas-reconciliation-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-automation-idempotency-cas-reconciliation-digest-failed')
  }
}

function executableSQL(sql: string): string {
  let output = ''
  let index = 0
  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2)
      index = end === -1 ? sql.length : end
      output += ' '
      continue
    }
    if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2)
      if (end === -1)
        return fail('supabase-automation-idempotency-cas-reconciliation-template-invalid')
      index = end + 2
      output += ' '
      continue
    }
    const character = sql[index]
    if (character === "'") {
      index += 1
      while (index < sql.length) {
        if (sql[index] !== "'") {
          index += 1
          continue
        }
        if (sql[index + 1] === "'") {
          index += 2
          continue
        }
        index += 1
        break
      }
      output += ' '
      continue
    }
    if (character === '"') {
      index += 1
      while (index < sql.length) {
        if (sql[index] !== '"') {
          index += 1
          continue
        }
        if (sql[index + 1] === '"') {
          index += 2
          continue
        }
        index += 1
        break
      }
      output += ' '
      continue
    }
    if (character === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$/u.exec(sql.slice(index))?.[0]
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length)
        if (end === -1)
          return fail('supabase-automation-idempotency-cas-reconciliation-template-invalid')
        index = end + tag.length
        output += ' '
        continue
      }
    }
    output += character
    index += 1
  }
  return output
}

function postgresCast(pgType: string): string {
  switch (pgType) {
    case 'integer':
      return 'int4'
    case 'bigint':
      return 'int8'
    case 'boolean':
      return 'bool'
    case 'text[]':
      return 'text[]'
    default:
      return 'text'
  }
}

function expectedParameterCasts(): readonly string[] {
  return Object.freeze(
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA.map(({ position, pgType }) => {
      return String(position) + ':' + postgresCast(pgType)
    })
  )
}

function actualParameterCasts(sql: string): readonly string[] {
  const casts: string[] = []
  for (const match of sql.matchAll(/\$(\d+)::"pg_catalog"\."(text|int4|int8|bool)"(\[\])?/gu)) {
    casts.push(String(Number(match[1])) + ':' + match[2] + (match[3] ?? ''))
  }
  return Object.freeze(casts)
}

function assertFixedTemplate(): void {
  const sql = SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE
  const bytes = new TextEncoder().encode(sql)
  const sentinelCount =
    sql.split(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL).length - 1
  const executable = executableSQL(sql)
  if (
    bytes.byteLength !==
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_BYTE_LENGTH ||
    sentinelCount !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL_COUNT ||
    sql.includes('\\') ||
    sql.includes(String.fromCharCode(96)) ||
    sql.includes(String.fromCharCode(36, 123)) ||
    sql.split(';').length - 1 !== 1 ||
    !/^\s*WITH\s+RECURSIVE\b/iu.test(executable) ||
    /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|COPY|VACUUM|ANALYZE|REFRESH|LOCK)\b/iu.test(
      executable
    ) ||
    /\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/iu.test(executable) ||
    /\bSELECT\b[\s\S]*?\bINTO\b/iu.test(executable) ||
    executable.split(';').length - 1 !== 1 ||
    actualParameterCasts(sql).join('|') !== expectedParameterCasts().join('|')
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-template-invalid')
  }
}

assertFixedTemplate()

/** Render only the compiler-owned 20-character application object key into the fixed schema token. */
export function renderSupabaseAutomationIdempotencyCASReconciliationSQLForTestingV1(
  applicationObjectKey: string
): string {
  if (!APPLICATION_OBJECT_KEY.test(applicationObjectKey)) {
    return fail('supabase-automation-idempotency-cas-reconciliation-input-invalid')
  }
  assertFixedTemplate()
  const schemaName = 'op_automation_' + applicationObjectKey
  const rendered = SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE.replaceAll(
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL,
    schemaName
  )
  if (
    rendered.includes(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SCHEMA_SENTINEL) ||
    !rendered.includes('"' + schemaName + '"')
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-template-invalid')
  }
  return rendered
}

/** Create a deterministic review over the exact immutable 27-value CAS snapshot. No SQL is sent. */
export async function createSupabaseAutomationIdempotencyCASReconciliationReviewForTestingV1(
  input: CreateSupabaseAutomationIdempotencyCASReconciliationReviewForTestingOptionsV1
): Promise<SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1> {
  const source = snapshotDataRecord(input, INPUT_KEYS)
  const casContext = requireTrustedCASReview(source.casReview)
  const { applicationObjectKey, schemaName } = schemaBinding(
    casContext.envelope.review.transaction.schemaName
  )
  const parameters = immutableParameterSnapshot(casContext.parameters)
  const proposalDigest = parameters[0]
  const canonicalProposalBase64 = parameters[1]
  const recordDigest = parameters[2]
  const canonicalRecordBase64 = parameters[3]
  if (
    typeof proposalDigest !== 'string' ||
    !SHA256_BASE64URL.test(proposalDigest) ||
    typeof canonicalProposalBase64 !== 'string' ||
    typeof recordDigest !== 'string' ||
    !SHA256_BASE64URL.test(recordDigest) ||
    typeof canonicalRecordBase64 !== 'string'
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-cas-review-changed')
  }
  assertCloneableWithoutProxy(input)

  const sql =
    renderSupabaseAutomationIdempotencyCASReconciliationSQLForTestingV1(applicationObjectKey)
  const marker =
    'openpencil.supabase-automation-idempotency-ledger.v1;application=' +
    applicationObjectKey +
    ';object=schema'
  let verifiedCandidatePromise: ReturnType<typeof verifyBackendAutomationIdempotencyCASProposal>
  let currentProposalDigestPromise: Promise<string>
  let currentRecordDigestPromise: Promise<string>
  try {
    verifiedCandidatePromise = verifyBackendAutomationIdempotencyCASProposal(
      casContext.candidate.proposal,
      casContext.currentRecord,
      casContext.candidate.record
    )
    currentProposalDigestPromise = digestBackendAutomationIdempotencyCASProposal(
      casContext.candidate.proposal
    )
    currentRecordDigestPromise = digestBackendAutomationIdempotencyRecord(
      casContext.candidate.record
    )
  } catch {
    return fail('supabase-automation-idempotency-cas-reconciliation-cas-review-changed')
  }

  const [
    verifiedCandidate,
    currentProposalDigest,
    currentRecordDigest,
    casReviewDigest,
    casRenderedSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    reconciliationSqlTemplateDigest,
    reconciliationSqlDigest,
    schemaMarkerDigest
  ] = await Promise.all([
    verifiedCandidatePromise,
    currentProposalDigestPromise,
    currentRecordDigestPromise,
    digest(casContext.envelope.review),
    digestRawText(casContext.sql),
    digest(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-automation-idempotency-cas-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
        values: parameters
      })
    ),
    digestRawText(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE),
    digestRawText(sql),
    digestRawText(marker)
  ])

  if (
    verifiedCandidate.recordDigest !== casContext.candidate.recordDigest ||
    currentProposalDigest !== proposalDigest ||
    currentRecordDigest !== recordDigest ||
    encodeBase64(
      canonicalBackendAutomationIdempotencyCASProposalBytes(verifiedCandidate.proposal)
    ) !== canonicalProposalBase64 ||
    encodeBase64(canonicalBackendAutomationIdempotencyRecordBytes(verifiedCandidate.record)) !==
      canonicalRecordBase64 ||
    casReviewDigest !== casContext.envelope.reviewDigest ||
    casRenderedSqlDigest !== casContext.envelope.review.bindings.renderedSqlDigest ||
    parameterSchemaDigest !== casContext.envelope.review.bindings.parameterSchemaDigest ||
    parameterValuesDigest !== casContext.envelope.review.bindings.parameterValuesDigest ||
    reconciliationSqlTemplateDigest !==
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_SQL_TEMPLATE_DIGEST
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-cas-review-changed')
  }

  const reconciliationQueryDigest = await digest(
    Object.freeze({
      format: 'openpencil.supabase-automation-idempotency-cas-reconciliation-query.v1' as const,
      version: 1 as const,
      queryId: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION,
      sqlTemplateDigest: reconciliationSqlTemplateDigest,
      parameterSchemaDigest,
      responseColumn: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
      responseFields: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
      responseMaximumBytes: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES
    })
  )

  const review: SupabaseAutomationIdempotencyCASReconciliationReviewV1 = Object.freeze({
    format: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    productionReachable: false as const,
    databaseLedgerBound: false as const,
    reconciliationAuthorityCreated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    automaticRetryAllowed: false as const,
    releaseReady: false as const,
    bindings: Object.freeze({
      casReviewDigest,
      casRenderedSqlDigest,
      proposalDigest,
      recordDigest,
      parameterSchemaDigest,
      parameterValuesDigest,
      reconciliationSqlTemplateDigest,
      reconciliationSqlDigest,
      reconciliationQueryDigest,
      schemaMarkerDigest
    }),
    query: Object.freeze({
      queryId: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION,
      schemaName,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const,
      statementCount: 1 as const,
      responseShape: 'one-row-one-non-null-text-json-column' as const,
      responseColumn: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
      responseFields: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
      responseMaximumBytes: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES,
      hostMustRecomputeStatusFromFacts: true as const,
      reportedStatusCrossCheckOnly: true as const,
      dmlAllowed: false as const,
      ddlAllowed: false as const,
      callAllowed: false as const,
      rowLocksUsed: false as const,
      callerSqlAccepted: false as const,
      callerSchemaAccepted: false as const,
      requiresDedicatedReadOnlyRole: true as const,
      dedicatedReadOnlyRole: 'supabase_read_only_user' as const,
      requiresTransportEnforcedReadOnlyTransaction: true as const,
      requiresBoundedStatementTimeout: true as const,
      liveTransportCreated: false as const
    }),
    parameters: Object.freeze({
      order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER,
      schema: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA,
      valueCount: 27 as const,
      valuesExposed: false as const,
      reusedFromCASImmutableSnapshot: true as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_ARTIFACT_PATH,
      kind: 'automation-idempotency-cas-reconciliation-fixed-read-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      schemaName,
      byteLength: new TextEncoder().encode(sql).byteLength,
      digest: reconciliationSqlDigest,
      templateDigest: reconciliationSqlTemplateDigest,
      containsCatalogRead: true as const,
      containsManagedDataRead: true as const,
      containsDml: false as const,
      containsDdl: false as const,
      containsCall: false as const,
      containsRowLock: false as const,
      requestDispatched: false as const
    }),
    policy: Object.freeze({
      absentProvesPriorMutationStopped: false as const,
      advancedHeadIsRelationalOnly: true as const,
      reportedStatusCreatesAuthority: false as const,
      reportedStatusProvesDatabaseState: false as const,
      commitOutcomeResolved: false as const,
      databaseCASCommitted: false as const,
      automaticRetryAllowed: false as const,
      managementTransportCompatible: false as const,
      productionResponseAuthenticated: false as const
    }),
    blockers: BLOCKERS
  })
  const envelope = Object.freeze({ review, reviewDigest: await digest(review), previewSql: sql })
  trustedReviews.set(
    envelope,
    Object.freeze({ envelope, casContext, applicationObjectKey, schemaName, sql, parameters })
  )
  return envelope
}

/** Identity-only lookup; copies never regain the hidden 27-value parameter snapshot. */
export function trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  return trustedReviews.get(value) ?? null
}
