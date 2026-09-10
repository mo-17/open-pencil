/* oxlint-disable eslint(max-lines), eslint(complexity) -- Native metadata, strict JSON, Host truth table, and authority refusal form one boundary. */

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_ID,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESULT_STATES,
  trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1,
  type SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1,
  type SupabaseAutomationIdempotencyCASReconciliationStateV1,
  type TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1
} from './review'

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_OBSERVATION_FORMAT =
  'openpencil.supabase-automation-idempotency-cas-reconciliation-observation.v1' as const

export interface ParseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingOptionsV1 {
  readonly reconciliationReview: SupabaseAutomationIdempotencyCASReconciliationReviewEnvelopeV1
  readonly response: unknown
}

export interface SupabaseAutomationIdempotencyCASReconciliationFactsV1 {
  readonly inputValid: boolean
  readonly runtimeReady: boolean
  readonly fullLedgerShapeVerified: boolean
  readonly headCount: number
  readonly headRevision: number | null
  readonly revisionCount: number
  readonly revisionMinimum: number | null
  readonly revisionMaximum: number | null
  readonly exactInitialRevisionCount: number
  readonly exactPredecessorLinkCount: number
  readonly exactHeadTipCount: number
  readonly candidateCount: number
  readonly candidateDigestMatchCount: number
  readonly candidateExactCount: number
  readonly expectedHeadMatchCount: number
}

export interface SupabaseAutomationIdempotencyCASReconciliationObservationV1 {
  readonly format: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_OBSERVATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly reportedStatus: SupabaseAutomationIdempotencyCASReconciliationStateV1
  readonly status: SupabaseAutomationIdempotencyCASReconciliationStateV1
  readonly bindings: Readonly<{
    reconciliationReviewDigest: string
    reconciliationSqlDigest: string
    reconciliationQueryDigest: string
    casReviewDigest: string
    proposalDigest: string
    recordDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    expectedSchemaMarkerDigest: string
    observedSchemaMarkerDigest: string | null
    responseDigest: string
    responseByteLength: number
  }>
  readonly facts: SupabaseAutomationIdempotencyCASReconciliationFactsV1
  readonly snapshot: Readonly<{
    transactionReadOnly: boolean
    databasePrimary: boolean
    sessionReplicationRoleOrigin: boolean
    serverVersionNum: string
    snapshotDigest: string
    observedAt: string
  }>
  readonly reportedStatusMatchesRecomputedFacts: true
  readonly statusRecomputedByHost: true
  readonly advancedHeadClassificationIsRelationalOnly: true
  readonly absentProvesPriorMutationStopped: false
  readonly reportedStatusAuthenticated: false
  readonly statusProvesDatabaseState: false
  readonly specificInstallationAuthenticated: false
  readonly productionTransportAuthenticated: false
  readonly readOnlyReconciliationCompleted: false
  readonly commitOutcomeResolved: false
  readonly databaseCASCommitted: false
  readonly automaticRetryAllowed: false
  readonly captureConsumed: false
  readonly operationAuthorityAuthenticated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly releaseReady: false
}

export interface TrustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1 {
  readonly observation: SupabaseAutomationIdempotencyCASReconciliationObservationV1
  readonly reviewContext: TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1
  readonly canonicalResponse: Readonly<Record<string, unknown>>
}

export type SupabaseAutomationIdempotencyCASReconciliationResponseErrorCode =
  | 'supabase-automation-idempotency-cas-reconciliation-response-input-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-response-proof-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-response-review-changed'
  | 'supabase-automation-idempotency-cas-reconciliation-response-metadata-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-response-size-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-response-json-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-response-invalid'
  | 'supabase-automation-idempotency-cas-reconciliation-response-binding-mismatch'
  | 'supabase-automation-idempotency-cas-reconciliation-response-status-mismatch'
  | 'supabase-automation-idempotency-cas-reconciliation-response-digest-failed'

export class SupabaseAutomationIdempotencyCASReconciliationResponseError extends Error {
  constructor(readonly code: SupabaseAutomationIdempotencyCASReconciliationResponseErrorCode) {
    super(code)
    this.name = 'SupabaseAutomationIdempotencyCASReconciliationResponseError'
  }
}

type ErrorCode = SupabaseAutomationIdempotencyCASReconciliationResponseErrorCode
type UnknownRecord = Record<PropertyKey, unknown>
const INPUT_KEYS = Object.freeze(['reconciliationReview', 'response'] as const)
const NATIVE_RESPONSE_KEYS = Object.freeze(['columns', 'rows'] as const)
const COLUMN_KEYS = Object.freeze(['name', 'pgType', 'nullable'] as const)
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const RFC3339_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const SUPPORTED_SERVER_VERSION = /^(?:15|16|17)[0-9]{4}$/u
const STATES = new Set<string>(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESULT_STATES)
const trustedObservations = new WeakMap<
  object,
  TrustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1
>()

function fail(code: ErrorCode): never {
  throw new SupabaseAutomationIdempotencyCASReconciliationResponseError(code)
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: ErrorCode
): UnknownRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return fail(code)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(code)
    }
    const snapshot = Object.create(null) as UnknownRecord
    for (const key of expectedKeys) {
      const descriptor = descriptors[key]
      if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return fail(code)
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false
      })
    }
    return Object.freeze(snapshot)
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReconciliationResponseError) throw cause
    return fail(code)
  }
}

function exactArray(value: unknown, expectedLength: number, code: ErrorCode): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail(code)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length !== expectedLength + 1 || !keys.includes('length')) return fail(code)
    const length = Object.getOwnPropertyDescriptor(value, 'length')
    if (
      length?.enumerable !== false ||
      length.configurable !== false ||
      length.writable !== true ||
      !Object.hasOwn(length, 'value') ||
      length.value !== expectedLength
    ) {
      return fail(code)
    }
    const result: unknown[] = []
    for (let index = 0; index < expectedLength; index += 1) {
      const key = String(index)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return fail(code)
      result.push(descriptor.value)
    }
    if (keys.some((key) => key !== 'length' && !/^\d+$/u.test(String(key)))) return fail(code)
    return Object.freeze(result)
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReconciliationResponseError) throw cause
    return fail(code)
  }
}

function assertCloneableWithoutProxy(value: unknown, code: ErrorCode): void {
  try {
    structuredClone(value)
  } catch {
    return fail(code)
  }
}

interface NativeSnapshot {
  readonly text: string
  readonly byteLength: number
}

function exactNativeResponse(value: unknown): NativeSnapshot {
  const metadataCode =
    'supabase-automation-idempotency-cas-reconciliation-response-metadata-invalid' as const
  const response = exactRecord(value, NATIVE_RESPONSE_KEYS, metadataCode)
  const columns = exactArray(response.columns, 1, metadataCode)
  const column = exactRecord(columns[0], COLUMN_KEYS, metadataCode)
  if (
    column.name !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN.name ||
    column.pgType !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN.pgType ||
    column.nullable !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN.nullable
  ) {
    return fail(metadataCode)
  }
  const rows = exactArray(response.rows, 1, metadataCode)
  const row = exactArray(rows[0], 1, metadataCode)
  const text = row[0]
  if (typeof text !== 'string' || text.length === 0) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
  }
  let bytes: Uint8Array
  try {
    bytes = new TextEncoder().encode(text)
    if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text) {
      return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
    }
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReconciliationResponseError) throw cause
    return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
  }
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-size-invalid')
  }
  return Object.freeze({ text, byteLength: bytes.byteLength })
}

function skipWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code !== 9 && code !== 10 && code !== 13 && code !== 32) break
    index += 1
  }
  return index
}

function parseJSONString(text: string, start: number): Readonly<{ value: string; end: number }> {
  if (text[start] !== '"')
    return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
  let index = start + 1
  while (index < text.length) {
    const character = text[index]
    if (character === '"') {
      const source = text.slice(start, index + 1)
      let value: unknown
      try {
        value = JSON.parse(source)
      } catch {
        return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
      }
      if (typeof value !== 'string') {
        return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
      }
      return Object.freeze({ value, end: index + 1 })
    }
    if (character === '\\') {
      index += 1
      if (index >= text.length || !/^["\\/bfnrtu]$/u.test(text[index])) {
        return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
      }
      if (text[index] === 'u') {
        if (!/^[0-9A-Fa-f]{4}$/u.test(text.slice(index + 1, index + 5))) {
          return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
        }
        index += 4
      }
    } else if (character.charCodeAt(0) < 0x20) {
      return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
    }
    index += 1
  }
  return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
}

function parseJSONPrimitive(
  text: string,
  start: number
): Readonly<{ value: string | number | boolean | null; end: number }> {
  if (text[start] === '"') return parseJSONString(text, start)
  for (const [source, value] of [
    ['true', true],
    ['false', false],
    ['null', null]
  ] as const) {
    if (text.startsWith(source, start)) return Object.freeze({ value, end: start + source.length })
  }
  const match = /^-?(?:0|[1-9]\d*)/u.exec(text.slice(start))
  if (!match)
    return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
  const value = Number(match[0])
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-json-invalid')
  }
  return Object.freeze({ value, end: start + match[0].length })
}

function strictFlatJSONObject(text: string): Readonly<Record<string, unknown>> {
  const code = 'supabase-automation-idempotency-cas-reconciliation-response-json-invalid' as const
  let index = skipWhitespace(text, 0)
  if (text[index] !== '{') return fail(code)
  index = skipWhitespace(text, index + 1)
  const result: Record<string, unknown> = Object.create(null)
  const keys = new Set<string>()
  if (text[index] === '}') index += 1
  else {
    while (index < text.length) {
      const key = parseJSONString(text, index)
      if (keys.has(key.value)) return fail(code)
      keys.add(key.value)
      index = skipWhitespace(text, key.end)
      if (text[index] !== ':') return fail(code)
      index = skipWhitespace(text, index + 1)
      const primitive = parseJSONPrimitive(text, index)
      result[key.value] = primitive.value
      index = skipWhitespace(text, primitive.end)
      if (text[index] === '}') {
        index += 1
        break
      }
      if (text[index] !== ',') return fail(code)
      index = skipWhitespace(text, index + 1)
    }
  }
  if (skipWhitespace(text, index) !== text.length) return fail(code)
  const parsed = exactRecord(
    result,
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
    code
  )
  return parsed as Readonly<Record<string, unknown>>
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  return value as number
}

function nullableRevision(value: unknown): number | null {
  return value === null ? null : integer(value, 0, 1024)
}

function digestString(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  return value
}

function canonicalObservedAt(value: unknown): string {
  if (typeof value !== 'string' || !RFC3339_MILLISECONDS.test(value) || value.startsWith('0000-')) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  try {
    if (new Date(milliseconds).toISOString() !== value) {
      return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
    }
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReconciliationResponseError) throw cause
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  return value
}

function state(value: unknown): SupabaseAutomationIdempotencyCASReconciliationStateV1 {
  if (typeof value !== 'string' || !STATES.has(value)) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  return value as SupabaseAutomationIdempotencyCASReconciliationStateV1
}

interface ParsedResponse {
  readonly reportedStatus: SupabaseAutomationIdempotencyCASReconciliationStateV1
  readonly proposalDigest: string
  readonly recordDigest: string
  readonly schemaMarkerDigest: string | null
  readonly facts: SupabaseAutomationIdempotencyCASReconciliationFactsV1
  readonly snapshot: SupabaseAutomationIdempotencyCASReconciliationObservationV1['snapshot']
  readonly canonicalResponse: Readonly<Record<string, unknown>>
}

function parseResponse(value: Readonly<Record<string, unknown>>): ParsedResponse {
  if (value.queryVersion !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-binding-mismatch')
  }
  const schemaMarkerDigest =
    value.schemaMarkerDigest === null ? null : digestString(value.schemaMarkerDigest)
  const facts: SupabaseAutomationIdempotencyCASReconciliationFactsV1 = Object.freeze({
    inputValid: boolean(value.inputValid),
    runtimeReady: boolean(value.runtimeReady),
    fullLedgerShapeVerified: boolean(value.fullLedgerShapeVerified),
    headCount: integer(value.headCount, 0, 2),
    headRevision: nullableRevision(value.headRevision),
    revisionCount: integer(value.revisionCount, 0, 1026),
    revisionMinimum: nullableRevision(value.revisionMinimum),
    revisionMaximum: nullableRevision(value.revisionMaximum),
    exactInitialRevisionCount: integer(value.exactInitialRevisionCount, 0, 2),
    exactPredecessorLinkCount: integer(value.exactPredecessorLinkCount, 0, 1025),
    exactHeadTipCount: integer(value.exactHeadTipCount, 0, 2),
    candidateCount: integer(value.candidateCount, 0, 2),
    candidateDigestMatchCount: integer(value.candidateDigestMatchCount, 0, 2),
    candidateExactCount: integer(value.candidateExactCount, 0, 2),
    expectedHeadMatchCount: integer(value.expectedHeadMatchCount, 0, 2)
  })
  const serverVersionNum = value.serverVersionNum
  const observedAt = canonicalObservedAt(value.observedAt)
  if (typeof serverVersionNum !== 'string' || !SUPPORTED_SERVER_VERSION.test(serverVersionNum)) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
  const snapshot = Object.freeze({
    transactionReadOnly: boolean(value.transactionReadOnly),
    databasePrimary: boolean(value.databasePrimary),
    sessionReplicationRoleOrigin: boolean(value.sessionReplicationRoleOrigin),
    serverVersionNum,
    snapshotDigest: digestString(value.snapshotDigest),
    observedAt
  })
  return Object.freeze({
    reportedStatus: state(value.reportedStatus),
    proposalDigest: digestString(value.proposalDigest),
    recordDigest: digestString(value.recordDigest),
    schemaMarkerDigest,
    facts,
    snapshot,
    canonicalResponse: value
  })
}

function dataFactsAreEmpty(facts: SupabaseAutomationIdempotencyCASReconciliationFactsV1): boolean {
  return (
    facts.headCount === 0 &&
    facts.headRevision === null &&
    facts.revisionCount === 0 &&
    facts.revisionMinimum === null &&
    facts.revisionMaximum === null &&
    facts.exactInitialRevisionCount === 0 &&
    facts.exactPredecessorLinkCount === 0 &&
    facts.exactHeadTipCount === 0 &&
    facts.candidateCount === 0 &&
    facts.candidateDigestMatchCount === 0 &&
    facts.candidateExactCount === 0 &&
    facts.expectedHeadMatchCount === 0
  )
}

function validateFactRelations(
  parsed: ParsedResponse,
  reviewContext: TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1
): void {
  const { facts, snapshot } = parsed
  const nextRevision = reviewContext.parameters[14]
  const expectedRevision = reviewContext.parameters[15]
  if (
    typeof nextRevision !== 'number' ||
    !Number.isSafeInteger(nextRevision) ||
    (expectedRevision !== null &&
      (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision))) ||
    (expectedRevision === null ? nextRevision !== 0 : nextRevision !== expectedRevision + 1) ||
    (facts.headCount === 1) !== (facts.headRevision !== null) ||
    (facts.revisionCount === 0) !==
      (facts.revisionMinimum === null && facts.revisionMaximum === null) ||
    (facts.revisionCount > 0 &&
      (facts.revisionMinimum === null ||
        facts.revisionMaximum === null ||
        facts.revisionMinimum > facts.revisionMaximum)) ||
    facts.exactInitialRevisionCount > facts.revisionCount ||
    facts.exactPredecessorLinkCount > Math.max(facts.revisionCount - 1, 0) ||
    facts.exactHeadTipCount > facts.headCount ||
    facts.exactHeadTipCount > facts.revisionCount ||
    facts.candidateDigestMatchCount > facts.candidateCount ||
    facts.candidateExactCount > facts.candidateDigestMatchCount ||
    facts.candidateCount > facts.revisionCount ||
    facts.expectedHeadMatchCount > facts.headCount ||
    facts.expectedHeadMatchCount > facts.revisionCount ||
    (expectedRevision === null && facts.expectedHeadMatchCount !== 0) ||
    (facts.candidateCount > 0 &&
      (facts.revisionMinimum === null ||
        facts.revisionMaximum === null ||
        facts.revisionMinimum > nextRevision ||
        facts.revisionMaximum < nextRevision)) ||
    (facts.candidateCount > 0 && facts.expectedHeadMatchCount !== 0) ||
    (facts.expectedHeadMatchCount > 0 &&
      (expectedRevision === null ||
        facts.revisionMinimum === null ||
        facts.revisionMaximum === null ||
        facts.revisionMinimum > expectedRevision ||
        facts.revisionMaximum < expectedRevision)) ||
    (facts.expectedHeadMatchCount === 1 && facts.headRevision !== expectedRevision) ||
    (facts.exactInitialRevisionCount > 0 && facts.revisionMinimum !== 0) ||
    (facts.runtimeReady &&
      (!snapshot.transactionReadOnly ||
        !snapshot.databasePrimary ||
        !snapshot.sessionReplicationRoleOrigin)) ||
    ((!facts.inputValid || !facts.runtimeReady || !facts.fullLedgerShapeVerified) &&
      !dataFactsAreEmpty(facts))
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-invalid')
  }
}

function ledgerHealthy(facts: SupabaseAutomationIdempotencyCASReconciliationFactsV1): boolean {
  if (facts.headCount === 0) {
    return (
      facts.headRevision === null &&
      facts.revisionCount === 0 &&
      facts.revisionMinimum === null &&
      facts.revisionMaximum === null &&
      facts.exactInitialRevisionCount === 0 &&
      facts.exactPredecessorLinkCount === 0 &&
      facts.exactHeadTipCount === 0
    )
  }
  return (
    facts.headCount === 1 &&
    facts.headRevision !== null &&
    facts.headRevision >= 0 &&
    facts.headRevision <= 1024 &&
    facts.revisionCount === facts.headRevision + 1 &&
    facts.revisionMinimum === 0 &&
    facts.revisionMaximum === facts.headRevision &&
    facts.exactInitialRevisionCount === 1 &&
    facts.exactPredecessorLinkCount === facts.headRevision &&
    facts.exactHeadTipCount === 1
  )
}

function recomputeStatus(
  parsed: ParsedResponse,
  reviewContext: TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1
): SupabaseAutomationIdempotencyCASReconciliationStateV1 {
  const { facts } = parsed
  const nextRevision = reviewContext.parameters[14]
  const expectedRevision = reviewContext.parameters[15]
  if (
    !Number.isSafeInteger(nextRevision) ||
    (expectedRevision !== null && !Number.isSafeInteger(expectedRevision))
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-review-changed')
  }
  if (!facts.inputValid || !facts.runtimeReady || !facts.fullLedgerShapeVerified) {
    return 'precondition-failed'
  }
  if (
    !ledgerHealthy(facts) ||
    facts.headCount === 2 ||
    facts.revisionCount === 1026 ||
    facts.exactInitialRevisionCount === 2 ||
    facts.exactPredecessorLinkCount === 1025 ||
    facts.exactHeadTipCount === 2 ||
    facts.candidateCount === 2 ||
    facts.candidateDigestMatchCount === 2 ||
    facts.candidateExactCount === 2 ||
    facts.expectedHeadMatchCount === 2
  ) {
    return 'corruption'
  }
  if (
    facts.candidateCount === 1 &&
    facts.candidateDigestMatchCount === 1 &&
    facts.candidateExactCount === 0
  ) {
    return 'corruption'
  }
  if (facts.candidateCount === 1 && facts.candidateDigestMatchCount === 0) {
    return 'cas-conflict'
  }
  if (
    facts.candidateCount === 1 &&
    facts.candidateDigestMatchCount === 1 &&
    facts.candidateExactCount === 1 &&
    facts.headRevision === nextRevision
  ) {
    return 'exact-replay'
  }
  if (
    facts.candidateCount === 1 &&
    facts.candidateDigestMatchCount === 1 &&
    facts.candidateExactCount === 1 &&
    facts.headRevision !== null &&
    facts.headRevision > (nextRevision as number)
  ) {
    return 'advanced-head'
  }
  if (
    facts.candidateCount === 0 &&
    facts.headCount === 0 &&
    facts.revisionCount === 0 &&
    expectedRevision === null &&
    nextRevision === 0
  ) {
    return 'absent'
  }
  if (
    facts.candidateCount === 0 &&
    facts.headCount === 1 &&
    expectedRevision !== null &&
    facts.headRevision === expectedRevision &&
    facts.expectedHeadMatchCount === 1
  ) {
    return 'absent'
  }
  return 'cas-conflict'
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-digest-failed')
  }
}

function requireTrustedReview(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1 {
  const context = trustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1(value)
  if (!context || context.envelope !== value) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-proof-invalid')
  }
  const review = context.envelope.review
  if (
    context.envelope.previewSql !== context.sql ||
    review.query.responseColumn !==
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN ||
    review.query.responseFields !==
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS ||
    review.parameters.order !==
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER ||
    review.parameters.schema !==
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA ||
    review.query.schemaName !== context.schemaName ||
    review.artifact.schemaName !== context.schemaName
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-review-changed')
  }
  return context
}

async function currentReviewDigests(
  context: TrustedSupabaseAutomationIdempotencyCASReconciliationReviewContextV1
): Promise<
  Readonly<{
    reviewDigest: string
    sqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    queryDigest: string
  }>
> {
  const parameterSchemaDigestPromise = digest(
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_SCHEMA
  )
  const parameterValuesDigestPromise = digest(
    Object.freeze({
      format: 'openpencil.supabase-automation-idempotency-cas-parameters.v1' as const,
      version: 1 as const,
      order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_PARAMETER_ORDER,
      values: context.parameters
    })
  )
  const [reviewDigest, sqlDigest, parameterSchemaDigest, parameterValuesDigest] = await Promise.all(
    [
      digest(context.envelope.review),
      digestRawText(context.sql),
      parameterSchemaDigestPromise,
      parameterValuesDigestPromise
    ]
  )
  const queryDigest = await digest(
    Object.freeze({
      format: 'openpencil.supabase-automation-idempotency-cas-reconciliation-query.v1' as const,
      version: 1 as const,
      queryId: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_QUERY_VERSION,
      sqlTemplateDigest: context.envelope.review.bindings.reconciliationSqlTemplateDigest,
      parameterSchemaDigest,
      responseColumn: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_COLUMN,
      responseFields: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_FIELDS,
      responseMaximumBytes: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_RESPONSE_MAX_BYTES
    })
  )
  return Object.freeze({
    reviewDigest,
    sqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    queryDigest
  })
}

/** Parse one injected native fixed-read response. This testing adapter never authenticates DB state. */
export async function parseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingV1(
  input: ParseSupabaseAutomationIdempotencyCASReconciliationResponseForTestingOptionsV1
): Promise<SupabaseAutomationIdempotencyCASReconciliationObservationV1> {
  const source = exactRecord(
    input,
    INPUT_KEYS,
    'supabase-automation-idempotency-cas-reconciliation-response-input-invalid'
  )
  const reviewContext = requireTrustedReview(source.reconciliationReview)
  const native = exactNativeResponse(source.response)
  const canonicalResponse = strictFlatJSONObject(native.text)
  const parsed = parseResponse(canonicalResponse)

  assertCloneableWithoutProxy(
    source.response,
    'supabase-automation-idempotency-cas-reconciliation-response-metadata-invalid'
  )
  assertCloneableWithoutProxy(
    input,
    'supabase-automation-idempotency-cas-reconciliation-response-input-invalid'
  )

  validateFactRelations(parsed, reviewContext)
  const status = recomputeStatus(parsed, reviewContext)
  if (status !== parsed.reportedStatus) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-status-mismatch')
  }

  const [current, responseDigest] = await Promise.all([
    currentReviewDigests(reviewContext),
    digest(canonicalResponse)
  ])
  const review = reviewContext.envelope.review
  if (
    current.reviewDigest !== reviewContext.envelope.reviewDigest ||
    current.sqlDigest !== review.bindings.reconciliationSqlDigest ||
    current.parameterSchemaDigest !== review.bindings.parameterSchemaDigest ||
    current.parameterValuesDigest !== review.bindings.parameterValuesDigest ||
    current.queryDigest !== review.bindings.reconciliationQueryDigest
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-review-changed')
  }
  if (
    parsed.proposalDigest !== review.bindings.proposalDigest ||
    parsed.recordDigest !== review.bindings.recordDigest ||
    (parsed.facts.fullLedgerShapeVerified
      ? parsed.schemaMarkerDigest !== review.bindings.schemaMarkerDigest
      : parsed.schemaMarkerDigest !== null)
  ) {
    return fail('supabase-automation-idempotency-cas-reconciliation-response-binding-mismatch')
  }

  const observation: SupabaseAutomationIdempotencyCASReconciliationObservationV1 = Object.freeze({
    format: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RECONCILIATION_OBSERVATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    reportedStatus: parsed.reportedStatus,
    status,
    bindings: Object.freeze({
      reconciliationReviewDigest: current.reviewDigest,
      reconciliationSqlDigest: current.sqlDigest,
      reconciliationQueryDigest: current.queryDigest,
      casReviewDigest: review.bindings.casReviewDigest,
      proposalDigest: parsed.proposalDigest,
      recordDigest: parsed.recordDigest,
      parameterSchemaDigest: current.parameterSchemaDigest,
      parameterValuesDigest: current.parameterValuesDigest,
      expectedSchemaMarkerDigest: review.bindings.schemaMarkerDigest,
      observedSchemaMarkerDigest: parsed.schemaMarkerDigest,
      responseDigest,
      responseByteLength: native.byteLength
    }),
    facts: parsed.facts,
    snapshot: parsed.snapshot,
    reportedStatusMatchesRecomputedFacts: true as const,
    statusRecomputedByHost: true as const,
    advancedHeadClassificationIsRelationalOnly: true as const,
    absentProvesPriorMutationStopped: false as const,
    reportedStatusAuthenticated: false as const,
    statusProvesDatabaseState: false as const,
    specificInstallationAuthenticated: false as const,
    productionTransportAuthenticated: false as const,
    readOnlyReconciliationCompleted: false as const,
    commitOutcomeResolved: false as const,
    databaseCASCommitted: false as const,
    automaticRetryAllowed: false as const,
    captureConsumed: false as const,
    operationAuthorityAuthenticated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    persistenceAuthorityGranted: false as const,
    dispatchAuthorityGranted: false as const,
    releaseReady: false as const
  })
  trustedObservations.set(
    observation,
    Object.freeze({ observation, reviewContext, canonicalResponse })
  )
  return observation
}

/** Identity-only lookup; copied observations never become authenticated evidence. */
export function trustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASReconciliationObservationContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  return trustedObservations.get(value) ?? null
}
