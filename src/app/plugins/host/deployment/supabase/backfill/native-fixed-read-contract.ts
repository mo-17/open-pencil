/* oxlint-disable eslint(max-lines) -- Request/result schemas and their fail-closed decoders form one IPC audit boundary. */

import {
  canonicalBackendBackfillExecutionReceiptV2Bytes,
  canonicalBackendBackfillExecutionScopeV2Bytes,
  parseBackendBackfillExecutionReceiptV2,
  parseBackendBackfillExecutionScopeV2,
  type BackendBackfillExecutionReceiptV2,
  type BackendBackfillExecutionScopeV2
} from '@open-pencil/lowcode/backend'
import { decodeBase64URL, digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA
} from './receipt/zero/cas/review'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
} from './receipt/zero/reconciliation/review'

export const SUPABASE_BACKFILL_NATIVE_FIXED_READ_REQUEST_FORMAT =
  'openpencil.supabase-backfill-native-fixed-read-request.v1' as const
export const SUPABASE_BACKFILL_NATIVE_FIXED_READ_RESULT_FORMAT =
  'openpencil.supabase-backfill-native-fixed-read-result.v1' as const

export const SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS = Object.freeze({
  requestBytes: 262_144,
  responseBytes: 131_072,
  parameterStringBytes: 87_384,
  canonicalParameterBytes: 65_536,
  serverStatementTimeoutMs: 15_000
})

/** Fixed shared-artifact facts. These are data-plane identity only and grant no dispatch authority. */
export const SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1 = Object.freeze({
  sqlByteLength: 115_192,
  sqlDigest: 'IUs7VRmTI8SSyB0K-AjP8z_86MBmwcSA4W4bqcDTP1o',
  queryDigest: '4Ut9gb_dOvGNffTumgrqM5AL6gF2ejhe0SaNyltdpyU',
  queryContractDigest: 'fhz-SI32anCJ8t_vAXVIXKA3KJRB638dpdEzncH_F9I',
  parameterOrderDigest: 'AlALe35W3Rzj9DD2CwHeTz9geSumjoRBaER2qZBcslk',
  parameterSchemaDigest: '3j14xx4T8NmZ8gNpc3OlylDz4zSt3sIj2zVnykaHumo',
  responseFieldsDigest: 'UmqkaYgcqtW0tx19l8dlCsIIJ0Db3NvIXdR7-HWxM6k'
})

const REQUEST_DIGEST_FORMAT =
  'openpencil.supabase-backfill-native-fixed-read-request-digest.v1' as const
const RESULT_DIGEST_FORMAT =
  'openpencil.supabase-backfill-native-fixed-read-result-digest.v1' as const
const SAFE_SEARCH_PATH = Object.freeze(['pg_catalog'] as const)
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const DECIMAL_TEXT = /^(?:0|[1-9]\d*)$/u
const RFC3339_MILLISECONDS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const POSTGRES_BIGINT_MAX_DECIMAL = '9223372036854775807'
const POSTGRES_INTEGER_MAX_DECIMAL = '2147483647'
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Serializable shape validation only. This module intentionally registers no Tauri command,
 * opens no database connection, resolves no credential, and dispatches no request. Create/parse
 * proves only a self-consistent wire shape: a renderer can recompute every digest here, and dynamic
 * binding digests remain unauthenticated until a genuine Host session binds them.
 */

const BINDING_KEYS = [
  'reconciliationReviewDigest',
  'staticSqlSafetyCertificateDigest',
  'reconciliationSqlDigest',
  'reconciliationQueryDigest',
  'queryContractDigest',
  'analysisProfileDigest',
  'parameterSchemaDigest',
  'parameterValuesDigest',
  'parameterOrderDigest',
  'responseFieldsDigest',
  'ledgerShapeDigest',
  'expectedColumnInventoryDigest',
  'expectedConstraintInventoryDigest',
  'scopeDigest',
  'receiptDigest',
  'candidateOperationEvidenceDigest',
  'historicalInstallMarkerDigest'
] as const
const CREATE_REQUEST_KEYS = ['bindings', 'parameters'] as const
const REQUEST_KEYS = [
  'format',
  'version',
  'providerId',
  'environment',
  'variant',
  'contractOnly',
  'nativeCommandRegistered',
  'requestDispatched',
  'query',
  'requirements',
  'bindings',
  'parameters',
  'requestDigest',
  'productionTransportCreated',
  'productionTransportAuthenticated',
  'productionRequestDispatchAuthenticated',
  'adapterAuthenticated',
  'dynamicBindingsAuthenticated',
  'readOnlyBoundaryAuthenticated',
  'configuredSearchPathAuthenticated',
  'liveCatalogSemanticsAuthenticated',
  'serverStatementTimeoutAuthenticated',
  'serverCancellationAuthenticated',
  'singleStatementSnapshotAuthenticated',
  'credentialAuthorityCreated',
  'transportAuthorityCreated',
  'databaseAuthorityCreated',
  'mutationAuthorityCreated',
  'executionAuthorityCreated',
  'receiptAuthorityCreated',
  'releaseAuthorityCreated',
  'releaseReady'
] as const
const QUERY_KEYS = [
  'queryId',
  'queryVersion',
  'statementCount',
  'accessMode',
  'snapshotScope',
  'sqlByteLength',
  'parameterCount',
  'parameterOrder',
  'responseFields',
  'rawSqlIncluded',
  'endpointIncluded'
] as const
const REQUIREMENT_KEYS = [
  'configuredSearchPath',
  'requiresTransportEnforcedReadOnlyBoundary',
  'requiresLiveCatalogSemanticsAuthentication',
  'serverStatementTimeoutMs',
  'maximumResponseBytes'
] as const
const CREATE_RESULT_KEYS = ['request', 'responseBytes'] as const
const PARSE_RESULT_KEYS = ['request', 'result'] as const
const RESULT_KEYS = [
  'format',
  'version',
  'providerId',
  'environment',
  'variant',
  'contractOnly',
  'nativeCommandRegistered',
  'requestDigest',
  'responseBytes',
  'responseByteLength',
  'responseDigest',
  'resultDigest',
  'productionRequestDispatchAuthenticated',
  'productionTransportCreationAuthenticated',
  'productionTransportAuthenticated',
  'adapterAuthenticated',
  'dynamicBindingsAuthenticated',
  'readOnlyBoundaryAuthenticated',
  'configuredSearchPathAuthenticated',
  'liveCatalogSemanticsAuthenticated',
  'serverStatementTimeoutAuthenticated',
  'serverCancellationAuthenticated',
  'singleStatementSnapshotAuthenticated',
  'responseSnapshotAuthenticated',
  'automaticRetryAllowed',
  'credentialAuthorityCreated',
  'transportAuthorityCreated',
  'databaseAuthorityCreated',
  'mutationAuthorityCreated',
  'executionAuthorityCreated',
  'receiptAuthorityCreated',
  'releaseAuthorityCreated',
  'releaseReady'
] as const

type ParameterValue = string | null
type UnknownRecord = Record<PropertyKey, unknown>

export interface SupabaseBackfillNativeFixedReadBindingsV1 {
  readonly reconciliationReviewDigest: string
  readonly staticSqlSafetyCertificateDigest: string
  readonly reconciliationSqlDigest: string
  readonly reconciliationQueryDigest: string
  readonly queryContractDigest: string
  readonly analysisProfileDigest: string
  readonly parameterSchemaDigest: string
  readonly parameterValuesDigest: string
  readonly parameterOrderDigest: string
  readonly responseFieldsDigest: string
  readonly ledgerShapeDigest: string
  readonly expectedColumnInventoryDigest: string
  readonly expectedConstraintInventoryDigest: string
  readonly scopeDigest: string
  readonly receiptDigest: string
  readonly candidateOperationEvidenceDigest: string
  readonly historicalInstallMarkerDigest: string
}

export interface CreateSupabaseBackfillNativeFixedReadRequestV1 {
  readonly bindings: SupabaseBackfillNativeFixedReadBindingsV1
  readonly parameters: readonly ParameterValue[]
}

export interface SupabaseBackfillNativeFixedReadRequestV1 {
  readonly format: typeof SUPABASE_BACKFILL_NATIVE_FIXED_READ_REQUEST_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly variant: 'receipt-zero-reconciliation'
  readonly contractOnly: true
  readonly nativeCommandRegistered: false
  readonly requestDispatched: false
  readonly query: Readonly<{
    queryId: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID
    queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION
    statementCount: 1
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
    sqlByteLength: typeof SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlByteLength
    parameterCount: 28
    parameterOrder: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER
    responseFields: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
    rawSqlIncluded: false
    endpointIncluded: false
  }>
  readonly requirements: Readonly<{
    configuredSearchPath: typeof SAFE_SEARCH_PATH
    requiresTransportEnforcedReadOnlyBoundary: true
    requiresLiveCatalogSemanticsAuthentication: true
    serverStatementTimeoutMs: typeof SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.serverStatementTimeoutMs
    maximumResponseBytes: typeof SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.responseBytes
  }>
  readonly bindings: Readonly<SupabaseBackfillNativeFixedReadBindingsV1>
  readonly parameters: readonly ParameterValue[]
  readonly requestDigest: string
  readonly productionTransportCreated: false
  readonly productionTransportAuthenticated: false
  readonly productionRequestDispatchAuthenticated: false
  readonly adapterAuthenticated: false
  readonly dynamicBindingsAuthenticated: false
  readonly readOnlyBoundaryAuthenticated: false
  readonly configuredSearchPathAuthenticated: false
  readonly liveCatalogSemanticsAuthenticated: false
  readonly serverStatementTimeoutAuthenticated: false
  readonly serverCancellationAuthenticated: false
  readonly singleStatementSnapshotAuthenticated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export interface SupabaseBackfillNativeFixedReadResultV1 {
  readonly format: typeof SUPABASE_BACKFILL_NATIVE_FIXED_READ_RESULT_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly variant: 'receipt-zero-reconciliation'
  readonly contractOnly: true
  readonly nativeCommandRegistered: false
  readonly requestDigest: string
  readonly responseBytes: readonly number[]
  readonly responseByteLength: number
  readonly responseDigest: string
  readonly resultDigest: string
  readonly productionRequestDispatchAuthenticated: false
  readonly productionTransportCreationAuthenticated: false
  readonly productionTransportAuthenticated: false
  readonly adapterAuthenticated: false
  readonly dynamicBindingsAuthenticated: false
  readonly readOnlyBoundaryAuthenticated: false
  readonly configuredSearchPathAuthenticated: false
  readonly liveCatalogSemanticsAuthenticated: false
  readonly serverStatementTimeoutAuthenticated: false
  readonly serverCancellationAuthenticated: false
  readonly singleStatementSnapshotAuthenticated: false
  readonly responseSnapshotAuthenticated: false
  readonly automaticRetryAllowed: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillNativeFixedReadContractErrorCode =
  | 'supabase-backfill-native-fixed-read-input-invalid'
  | 'supabase-backfill-native-fixed-read-request-invalid'
  | 'supabase-backfill-native-fixed-read-request-too-large'
  | 'supabase-backfill-native-fixed-read-result-invalid'
  | 'supabase-backfill-native-fixed-read-response-too-large'
  | 'supabase-backfill-native-fixed-read-binding-mismatch'
  | 'supabase-backfill-native-fixed-read-digest-failed'

export class SupabaseBackfillNativeFixedReadContractError extends Error {
  constructor(readonly code: SupabaseBackfillNativeFixedReadContractErrorCode) {
    super(`Supabase backfill Native fixed-read contract failed: ${code}.`)
    this.name = 'SupabaseBackfillNativeFixedReadContractError'
  }
}

function fail(code: SupabaseBackfillNativeFixedReadContractErrorCode): never {
  throw new SupabaseBackfillNativeFixedReadContractError(code)
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: SupabaseBackfillNativeFixedReadContractErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object') return fail(code)
  let isArray: boolean
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
  if (
    isArray ||
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail(code)
  }
  const snapshot: UnknownRecord = Object.create(null)
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return fail(code)
    }
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function exactArray(
  value: unknown,
  expectedLength: number | null,
  code: SupabaseBackfillNativeFixedReadContractErrorCode
): readonly unknown[] {
  if (value === null || typeof value !== 'object') return fail(code)
  let isArray: boolean
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  let length: number
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
    length = (value as unknown[]).length
  } catch {
    return fail(code)
  }
  if (
    !isArray ||
    prototype !== Array.prototype ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    (expectedLength !== null && length !== expectedLength)
  ) {
    return fail(code)
  }
  if (
    ownKeys.length !== length + 1 ||
    ownKeys.some((key) => {
      if (key === 'length') return false
      return typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length
    })
  ) {
    return fail(code)
  }
  const snapshot: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    } catch {
      return fail(code)
    }
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
    snapshot.push(descriptor.value)
  }
  return Object.freeze(snapshot)
}

function fixed(
  value: unknown,
  expected: unknown,
  code: SupabaseBackfillNativeFixedReadContractErrorCode
): void {
  if (value !== expected) fail(code)
}

function digestValue(
  value: unknown,
  code: SupabaseBackfillNativeFixedReadContractErrorCode
): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return fail(code)
  let bytes: Uint8Array
  try {
    bytes = decodeBase64URL(value)
  } catch {
    return fail(code)
  }
  if (bytes.byteLength !== 32 || encodeBase64URL(bytes) !== value) return fail(code)
  return value
}

function hasUnpairedUTF16Surrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function canonicalStandardBase64Bytes(value: string): Uint8Array {
  if (value.length === 0 || !STANDARD_BASE64.test(value)) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  const paddedByTwo = value.endsWith('==')
  const paddedByOne = !paddedByTwo && value.endsWith('=')
  let paddingCharacters = 0
  if (paddedByTwo) paddingCharacters = 2
  else if (paddedByOne) paddingCharacters = 1
  const finalDataIndex = value.length - paddingCharacters - 1
  const finalValue = BASE64_ALPHABET.indexOf(value[finalDataIndex] ?? '')
  if (
    finalValue === -1 ||
    (paddedByTwo && (finalValue & 0b1111) !== 0) ||
    (paddedByOne && (finalValue & 0b11) !== 0)
  ) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  let bytes: Uint8Array
  try {
    bytes = decodeBase64URL(value.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''))
  } catch {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  if (bytes.byteLength > SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.canonicalParameterBytes) {
    return fail('supabase-backfill-native-fixed-read-request-too-large')
  }
  return bytes
}

function decodedEmbeddedDocument(value: string): Readonly<{ bytes: Uint8Array; value: unknown }> {
  const bytes = canonicalStandardBase64Bytes(value)
  let decoded: unknown
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  return Object.freeze({ bytes, value: decoded })
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

function canonicalEmbeddedScope(value: string): Readonly<{
  bytes: Uint8Array
  scope: BackendBackfillExecutionScopeV2
}> {
  const decoded = decodedEmbeddedDocument(value)
  let scope: BackendBackfillExecutionScopeV2
  let canonical: Uint8Array
  try {
    scope = parseBackendBackfillExecutionScopeV2(decoded.value, '$.parameters.canonicalScopeBase64')
    canonical = canonicalBackendBackfillExecutionScopeV2Bytes(scope)
  } catch {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  if (!equalBytes(canonical, decoded.bytes)) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  return Object.freeze({ bytes: decoded.bytes, scope })
}

function canonicalEmbeddedReceipt(value: string): Readonly<{
  bytes: Uint8Array
  receipt: BackendBackfillExecutionReceiptV2
}> {
  const decoded = decodedEmbeddedDocument(value)
  let receipt: BackendBackfillExecutionReceiptV2
  let canonical: Uint8Array
  try {
    receipt = parseBackendBackfillExecutionReceiptV2(
      decoded.value,
      '$.parameters.canonicalReceiptBase64'
    )
    canonical = canonicalBackendBackfillExecutionReceiptV2Bytes(receipt)
  } catch {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  if (!equalBytes(canonical, decoded.bytes)) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  return Object.freeze({ bytes: decoded.bytes, receipt })
}

function boundedDecimalText(value: string, pgType: string): boolean {
  if (!DECIMAL_TEXT.test(value)) return false
  let maximum: string | null = null
  if (pgType === 'bigint') maximum = POSTGRES_BIGINT_MAX_DECIMAL
  else if (pgType === 'integer') maximum = POSTGRES_INTEGER_MAX_DECIMAL
  return (
    maximum !== null &&
    (value.length < maximum.length || (value.length === maximum.length && value <= maximum))
  )
}

function canonicalRFC3339MillisecondsUTC(value: string): boolean {
  if (!RFC3339_MILLISECONDS_UTC.test(value)) return false
  try {
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
  } catch {
    return false
  }
}

function boundedParameter(value: unknown, index: number): ParameterValue {
  const schema = SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA[index]
  if (value === null) {
    if (!schema.nullable) return fail('supabase-backfill-native-fixed-read-request-invalid')
    return null
  }
  if (typeof value !== 'string' || /\p{Cc}/u.test(value) || hasUnpairedUTF16Surrogate(value)) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  let bytes: number
  try {
    bytes = new TextEncoder().encode(value).byteLength
  } catch {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  if (bytes > SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.parameterStringBytes) {
    return fail('supabase-backfill-native-fixed-read-request-too-large')
  }
  if (
    value.length === 0 ||
    (schema.name.endsWith('Digest') &&
      digestValue(value, 'supabase-backfill-native-fixed-read-request-invalid') !== value) ||
    (schema.encoding === 'decimal-text' && !boundedDecimalText(value, schema.pgType)) ||
    (schema.encoding === 'rfc3339' && !canonicalRFC3339MillisecondsUTC(value))
  ) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  if (schema.encoding === 'standard-base64') canonicalStandardBase64Bytes(value)
  return value
}

function parameterSnapshot(
  value: unknown,
  code: SupabaseBackfillNativeFixedReadContractErrorCode = 'supabase-backfill-native-fixed-read-request-invalid'
): readonly ParameterValue[] {
  const values = exactArray(value, SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length, code)
  return Object.freeze(values.map((entry, index) => boundedParameter(entry, index)))
}

function bindingSnapshot(
  value: unknown,
  code: SupabaseBackfillNativeFixedReadContractErrorCode = 'supabase-backfill-native-fixed-read-request-invalid'
): Readonly<SupabaseBackfillNativeFixedReadBindingsV1> {
  const source = exactRecord(value, BINDING_KEYS, code)
  const bindings: Readonly<SupabaseBackfillNativeFixedReadBindingsV1> = Object.freeze({
    reconciliationReviewDigest: digestValue(source.reconciliationReviewDigest, code),
    staticSqlSafetyCertificateDigest: digestValue(source.staticSqlSafetyCertificateDigest, code),
    reconciliationSqlDigest: digestValue(source.reconciliationSqlDigest, code),
    reconciliationQueryDigest: digestValue(source.reconciliationQueryDigest, code),
    queryContractDigest: digestValue(source.queryContractDigest, code),
    analysisProfileDigest: digestValue(source.analysisProfileDigest, code),
    parameterSchemaDigest: digestValue(source.parameterSchemaDigest, code),
    parameterValuesDigest: digestValue(source.parameterValuesDigest, code),
    parameterOrderDigest: digestValue(source.parameterOrderDigest, code),
    responseFieldsDigest: digestValue(source.responseFieldsDigest, code),
    ledgerShapeDigest: digestValue(source.ledgerShapeDigest, code),
    expectedColumnInventoryDigest: digestValue(source.expectedColumnInventoryDigest, code),
    expectedConstraintInventoryDigest: digestValue(source.expectedConstraintInventoryDigest, code),
    scopeDigest: digestValue(source.scopeDigest, code),
    receiptDigest: digestValue(source.receiptDigest, code),
    candidateOperationEvidenceDigest: digestValue(source.candidateOperationEvidenceDigest, code),
    historicalInstallMarkerDigest: digestValue(source.historicalInstallMarkerDigest, code)
  })
  if (
    bindings.reconciliationSqlDigest !==
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlDigest ||
    bindings.reconciliationQueryDigest !==
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.queryDigest ||
    bindings.queryContractDigest !==
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.queryContractDigest ||
    bindings.parameterOrderDigest !==
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.parameterOrderDigest ||
    bindings.parameterSchemaDigest !==
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.parameterSchemaDigest ||
    bindings.responseFieldsDigest !==
      SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.responseFieldsDigest
  ) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
  return bindings
}

function fixedArray<T extends readonly unknown[]>(
  value: unknown,
  expected: T,
  code: SupabaseBackfillNativeFixedReadContractErrorCode
): T {
  const values = exactArray(value, expected.length, code)
  if (values.some((entry, index) => entry !== expected[index])) return fail(code)
  return expected
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-native-fixed-read-digest-failed')
  }
}

async function rawDigest(bytes: Uint8Array): Promise<string> {
  try {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-native-fixed-read-digest-failed')
  }
}

function byteLength(value: unknown): number {
  let length: number
  try {
    length = new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return fail('supabase-backfill-native-fixed-read-digest-failed')
  }
  return length
}

function requestWithoutDigest(
  bindings: Readonly<SupabaseBackfillNativeFixedReadBindingsV1>,
  parameters: readonly ParameterValue[]
) {
  return Object.freeze({
    format: SUPABASE_BACKFILL_NATIVE_FIXED_READ_REQUEST_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    variant: 'receipt-zero-reconciliation' as const,
    contractOnly: true as const,
    nativeCommandRegistered: false as const,
    requestDispatched: false as const,
    query: Object.freeze({
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      statementCount: 1 as const,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const,
      sqlByteLength: SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlByteLength,
      parameterCount: 28 as const,
      parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
      rawSqlIncluded: false as const,
      endpointIncluded: false as const
    }),
    requirements: Object.freeze({
      configuredSearchPath: SAFE_SEARCH_PATH,
      requiresTransportEnforcedReadOnlyBoundary: true as const,
      requiresLiveCatalogSemanticsAuthentication: true as const,
      serverStatementTimeoutMs: SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.serverStatementTimeoutMs,
      maximumResponseBytes: SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.responseBytes
    }),
    bindings,
    parameters,
    productionTransportCreated: false as const,
    productionTransportAuthenticated: false as const,
    productionRequestDispatchAuthenticated: false as const,
    adapterAuthenticated: false as const,
    dynamicBindingsAuthenticated: false as const,
    readOnlyBoundaryAuthenticated: false as const,
    configuredSearchPathAuthenticated: false as const,
    liveCatalogSemanticsAuthenticated: false as const,
    serverStatementTimeoutAuthenticated: false as const,
    serverCancellationAuthenticated: false as const,
    singleStatementSnapshotAuthenticated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  })
}

async function requestDigest(value: ReturnType<typeof requestWithoutDigest>): Promise<string> {
  return digest(
    Object.freeze({ format: REQUEST_DIGEST_FORMAT, version: 1 as const, request: value })
  )
}

function zeroCounts(value: BackendBackfillExecutionReceiptV2['batchCounts']): boolean {
  return value.scannedRowCount === 0 && value.matchedRowCount === 0 && value.updatedRowCount === 0
}

function requireReceiptZeroDomain(
  scope: BackendBackfillExecutionScopeV2,
  receipt: BackendBackfillExecutionReceiptV2
): void {
  const matchedRowCountSatisfied =
    scope.requiredMatchedRowCount === null || scope.requiredMatchedRowCount === 0
  const alreadySatisfied = scope.initialRemainingTargetRowCount === 0 && matchedRowCountSatisfied
  const valid = [
    scope.providerId === 'supabase',
    scope.environment === 'staging',
    receipt.checkpointKind === 'capture',
    receipt.batchIndex === 0,
    receipt.previousCursor === null,
    receipt.lastProcessedKey === null,
    zeroCounts(receipt.batchCounts),
    zeroCounts(receipt.cumulativeCounts),
    receipt.exhaustion.checked,
    receipt.exhaustion.remainingEligibleRowCount === scope.initialRemainingEligibleRowCount,
    receipt.exhaustion.remainingTargetRowCount === scope.initialRemainingTargetRowCount,
    receipt.postconditions.fieldNotNull === (scope.initialRemainingTargetRowCount === 0),
    receipt.postconditions.requiredMatchedRowCount === scope.requiredMatchedRowCount,
    receipt.postconditions.matchedRowCountSatisfied === matchedRowCountSatisfied,
    receipt.outcome === (alreadySatisfied ? 'completed' : 'in-progress'),
    receipt.terminalReason === (alreadySatisfied ? 'already-satisfied' : null),
    receipt.stableErrorCode === null,
    receipt.previousReceiptDigest === null,
    receipt.catalogEvidenceDigest === scope.catalogPreconditionDigest,
    receipt.databaseHeadVersion === 1,
    receipt.evidenceDigest === scope.receiptZeroEvidenceDigest
  ].every(Boolean)
  if (!valid) {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
}

function decimalParameterMatches(value: ParameterValue, expected: number | null): boolean {
  return value === (expected === null ? null : String(expected))
}

function requireEmbeddedDocumentBindings(
  bindings: Readonly<SupabaseBackfillNativeFixedReadBindingsV1>,
  parameters: readonly ParameterValue[],
  scope: BackendBackfillExecutionScopeV2,
  receipt: BackendBackfillExecutionReceiptV2,
  scopeBytes: Uint8Array,
  scopeDigest: string,
  receiptDigest: string
): void {
  let receiptScopeBytes: Uint8Array
  try {
    receiptScopeBytes = canonicalBackendBackfillExecutionScopeV2Bytes(receipt.scope)
  } catch {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  const executionStatus = receipt.outcome === 'completed' ? 'completed' : 'running'
  const bound = [
    equalBytes(scopeBytes, receiptScopeBytes),
    receipt.scopeDigest === scopeDigest,
    bindings.scopeDigest === scopeDigest,
    bindings.receiptDigest === receiptDigest,
    parameters[0] === receipt.executionId,
    parameters[1] === scope.applicationId,
    parameters[2] === scope.applicationDigest,
    parameters[3] === scope.migrationId,
    parameters[4] === scope.migrationDigest,
    parameters[5] === scope.migrationPlanDigest,
    parameters[6] === scope.providerAuthorityDigest,
    parameters[7] === scope.sourceLedgerDigest,
    parameters[8] === scopeDigest,
    parameters[9] === scope.resourceIdentityDigest,
    parameters[10] === scope.catalogPreconditionDigest,
    parameters[12] === scope.captureDigest,
    decimalParameterMatches(parameters[13], scope.capturedHighWater),
    decimalParameterMatches(parameters[14], scope.initialRemainingEligibleRowCount),
    decimalParameterMatches(parameters[15], scope.initialRemainingTargetRowCount),
    decimalParameterMatches(parameters[16], scope.requiredMatchedRowCount),
    decimalParameterMatches(parameters[17], scope.requiredBatchCount),
    decimalParameterMatches(parameters[18], scope.batchSize),
    parameters[19] === executionStatus,
    parameters[20] === receipt.committedAt,
    parameters[21] === receipt.databaseEventId,
    parameters[22] === receipt.receiptId,
    parameters[23] === receipt.idempotencyKey,
    parameters[24] === receipt.requestDigest,
    parameters[25] === receiptDigest,
    parameters[27] === receipt.operationAuthorityDigest,
    parameters[27] === bindings.candidateOperationEvidenceDigest
  ].every(Boolean)
  if (!bound) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
}

async function requireParameterValuesBinding(
  bindings: Readonly<SupabaseBackfillNativeFixedReadBindingsV1>,
  parameters: readonly ParameterValue[]
): Promise<void> {
  const canonicalScopeBase64 = parameters[11]
  const canonicalReceiptBase64 = parameters[26]
  if (typeof canonicalScopeBase64 !== 'string' || typeof canonicalReceiptBase64 !== 'string') {
    return fail('supabase-backfill-native-fixed-read-request-invalid')
  }
  const embeddedScope = canonicalEmbeddedScope(canonicalScopeBase64)
  const embeddedReceipt = canonicalEmbeddedReceipt(canonicalReceiptBase64)
  requireReceiptZeroDomain(embeddedScope.scope, embeddedReceipt.receipt)
  const [parameterValuesDigest, scopeDigest, receiptDigest] = await Promise.all([
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        values: parameters
      })
    ),
    rawDigest(embeddedScope.bytes),
    rawDigest(embeddedReceipt.bytes)
  ])
  if (bindings.parameterValuesDigest !== parameterValuesDigest) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
  requireEmbeddedDocumentBindings(
    bindings,
    parameters,
    embeddedScope.scope,
    embeddedReceipt.receipt,
    embeddedScope.bytes,
    scopeDigest,
    receiptDigest
  )
}

/**
 * Canonicalize a contract-only request. This checks internal wire consistency, not genuine Host
 * provenance; renderer-controlled dynamic binding digests remain untrusted.
 */
export async function createSupabaseBackfillNativeFixedReadRequestV1(
  input: CreateSupabaseBackfillNativeFixedReadRequestV1
): Promise<SupabaseBackfillNativeFixedReadRequestV1> {
  const source = exactRecord(
    input,
    CREATE_REQUEST_KEYS,
    'supabase-backfill-native-fixed-read-input-invalid'
  )
  const bindings = bindingSnapshot(source.bindings)
  const parameters = parameterSnapshot(source.parameters)
  await requireParameterValuesBinding(bindings, parameters)
  const withoutDigest = requestWithoutDigest(bindings, parameters)
  const request = Object.freeze({
    ...withoutDigest,
    requestDigest: await requestDigest(withoutDigest)
  }) satisfies SupabaseBackfillNativeFixedReadRequestV1
  if (byteLength(request) > SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.requestBytes) {
    return fail('supabase-backfill-native-fixed-read-request-too-large')
  }
  return request
}

export async function parseSupabaseBackfillNativeFixedReadRequestV1(
  value: unknown
): Promise<SupabaseBackfillNativeFixedReadRequestV1> {
  const source = exactRecord(
    value,
    REQUEST_KEYS,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    source.format,
    SUPABASE_BACKFILL_NATIVE_FIXED_READ_REQUEST_FORMAT,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(source.version, 1, 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(source.providerId, 'supabase', 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(source.environment, 'staging', 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(
    source.variant,
    'receipt-zero-reconciliation',
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(source.contractOnly, true, 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(
    source.nativeCommandRegistered,
    false,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(source.requestDispatched, false, 'supabase-backfill-native-fixed-read-request-invalid')
  const query = exactRecord(
    source.query,
    QUERY_KEYS,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    query.queryId,
    SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    query.queryVersion,
    SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(query.statementCount, 1, 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(query.accessMode, 'read-only', 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(
    query.snapshotScope,
    'single-statement',
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    query.sqlByteLength,
    SUPABASE_BACKFILL_NATIVE_FIXED_READ_ARTIFACT_V1.sqlByteLength,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(query.parameterCount, 28, 'supabase-backfill-native-fixed-read-request-invalid')
  fixedArray(
    query.parameterOrder,
    SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixedArray(
    query.responseFields,
    SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(query.rawSqlIncluded, false, 'supabase-backfill-native-fixed-read-request-invalid')
  fixed(query.endpointIncluded, false, 'supabase-backfill-native-fixed-read-request-invalid')
  const requirements = exactRecord(
    source.requirements,
    REQUIREMENT_KEYS,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixedArray(
    requirements.configuredSearchPath,
    SAFE_SEARCH_PATH,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    requirements.requiresTransportEnforcedReadOnlyBoundary,
    true,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    requirements.requiresLiveCatalogSemanticsAuthentication,
    true,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    requirements.serverStatementTimeoutMs,
    SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.serverStatementTimeoutMs,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  fixed(
    requirements.maximumResponseBytes,
    SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.responseBytes,
    'supabase-backfill-native-fixed-read-request-invalid'
  )
  for (const key of REQUEST_KEYS.slice(13)) {
    fixed(source[key], false, 'supabase-backfill-native-fixed-read-request-invalid')
  }
  const bindings = bindingSnapshot(source.bindings)
  const parameters = parameterSnapshot(source.parameters)
  await requireParameterValuesBinding(bindings, parameters)
  const withoutDigest = requestWithoutDigest(bindings, parameters)
  const expectedDigest = await requestDigest(withoutDigest)
  if (
    digestValue(source.requestDigest, 'supabase-backfill-native-fixed-read-request-invalid') !==
    expectedDigest
  ) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
  const request = Object.freeze({ ...withoutDigest, requestDigest: expectedDigest })
  if (byteLength(request) > SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.requestBytes) {
    return fail('supabase-backfill-native-fixed-read-request-too-large')
  }
  return request
}

function responseByteSnapshot(value: unknown): readonly number[] {
  let length: number
  try {
    if (!Array.isArray(value)) {
      return fail('supabase-backfill-native-fixed-read-result-invalid')
    }
    length = value.length
  } catch {
    return fail('supabase-backfill-native-fixed-read-result-invalid')
  }
  if (length < 1) {
    return fail('supabase-backfill-native-fixed-read-result-invalid')
  }
  if (length > SUPABASE_BACKFILL_NATIVE_FIXED_READ_LIMITS.responseBytes) {
    return fail('supabase-backfill-native-fixed-read-response-too-large')
  }
  const entries = exactArray(value, null, 'supabase-backfill-native-fixed-read-result-invalid')
  return Object.freeze(
    entries.map((entry) => {
      if (
        !Number.isSafeInteger(entry) ||
        Object.is(entry, -0) ||
        (entry as number) < 0 ||
        (entry as number) > 255
      ) {
        return fail('supabase-backfill-native-fixed-read-result-invalid')
      }
      return entry as number
    })
  )
}

function resultWithoutDigest(
  requestDigestValue: string,
  responseBytes: readonly number[],
  responseDigest: string
) {
  return Object.freeze({
    format: SUPABASE_BACKFILL_NATIVE_FIXED_READ_RESULT_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    variant: 'receipt-zero-reconciliation' as const,
    contractOnly: true as const,
    nativeCommandRegistered: false as const,
    requestDigest: requestDigestValue,
    responseBytes,
    responseByteLength: responseBytes.length,
    responseDigest,
    productionRequestDispatchAuthenticated: false as const,
    productionTransportCreationAuthenticated: false as const,
    productionTransportAuthenticated: false as const,
    adapterAuthenticated: false as const,
    dynamicBindingsAuthenticated: false as const,
    readOnlyBoundaryAuthenticated: false as const,
    configuredSearchPathAuthenticated: false as const,
    liveCatalogSemanticsAuthenticated: false as const,
    serverStatementTimeoutAuthenticated: false as const,
    serverCancellationAuthenticated: false as const,
    singleStatementSnapshotAuthenticated: false as const,
    responseSnapshotAuthenticated: false as const,
    automaticRetryAllowed: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  })
}

async function resultDigest(value: ReturnType<typeof resultWithoutDigest>): Promise<string> {
  return digest(Object.freeze({ format: RESULT_DIGEST_FORMAT, version: 1 as const, result: value }))
}

export async function createSupabaseBackfillNativeFixedReadResultV1(input: {
  readonly request: SupabaseBackfillNativeFixedReadRequestV1
  readonly responseBytes: readonly number[]
}): Promise<SupabaseBackfillNativeFixedReadResultV1> {
  const source = exactRecord(
    input,
    CREATE_RESULT_KEYS,
    'supabase-backfill-native-fixed-read-input-invalid'
  )
  const request = await parseSupabaseBackfillNativeFixedReadRequestV1(source.request)
  const bytes = responseByteSnapshot(source.responseBytes)
  const responseDigest = await rawDigest(Uint8Array.from(bytes))
  const withoutDigest = resultWithoutDigest(request.requestDigest, bytes, responseDigest)
  return Object.freeze({
    ...withoutDigest,
    resultDigest: await resultDigest(withoutDigest)
  })
}

/** Parse self-consistent bytes only; this cannot authenticate an adapter, session, or dispatch. */
export async function parseSupabaseBackfillNativeFixedReadResultV1(input: {
  readonly request: SupabaseBackfillNativeFixedReadRequestV1
  readonly result: unknown
}): Promise<SupabaseBackfillNativeFixedReadResultV1> {
  const source = exactRecord(
    input,
    PARSE_RESULT_KEYS,
    'supabase-backfill-native-fixed-read-input-invalid'
  )
  const request = await parseSupabaseBackfillNativeFixedReadRequestV1(source.request)
  const result = exactRecord(
    source.result,
    RESULT_KEYS,
    'supabase-backfill-native-fixed-read-result-invalid'
  )
  fixed(
    result.format,
    SUPABASE_BACKFILL_NATIVE_FIXED_READ_RESULT_FORMAT,
    'supabase-backfill-native-fixed-read-result-invalid'
  )
  fixed(result.version, 1, 'supabase-backfill-native-fixed-read-result-invalid')
  fixed(result.providerId, 'supabase', 'supabase-backfill-native-fixed-read-result-invalid')
  fixed(result.environment, 'staging', 'supabase-backfill-native-fixed-read-result-invalid')
  fixed(
    result.variant,
    'receipt-zero-reconciliation',
    'supabase-backfill-native-fixed-read-result-invalid'
  )
  fixed(result.contractOnly, true, 'supabase-backfill-native-fixed-read-result-invalid')
  fixed(result.nativeCommandRegistered, false, 'supabase-backfill-native-fixed-read-result-invalid')
  const boundRequestDigest = digestValue(
    result.requestDigest,
    'supabase-backfill-native-fixed-read-result-invalid'
  )
  if (boundRequestDigest !== request.requestDigest) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
  const bytes = responseByteSnapshot(result.responseBytes)
  fixed(
    result.responseByteLength,
    bytes.length,
    'supabase-backfill-native-fixed-read-result-invalid'
  )
  const responseDigest = await rawDigest(Uint8Array.from(bytes))
  if (
    digestValue(result.responseDigest, 'supabase-backfill-native-fixed-read-result-invalid') !==
    responseDigest
  ) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
  for (const key of RESULT_KEYS.slice(12)) {
    fixed(result[key], false, 'supabase-backfill-native-fixed-read-result-invalid')
  }
  const withoutDigest = resultWithoutDigest(boundRequestDigest, bytes, responseDigest)
  const expectedResultDigest = await resultDigest(withoutDigest)
  if (
    digestValue(result.resultDigest, 'supabase-backfill-native-fixed-read-result-invalid') !==
    expectedResultDigest
  ) {
    return fail('supabase-backfill-native-fixed-read-binding-mismatch')
  }
  return Object.freeze({ ...withoutDigest, resultDigest: expectedResultDigest })
}
