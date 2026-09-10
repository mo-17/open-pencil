/* oxlint-disable eslint(max-lines) -- One data-only size certificate, its strict wire decoder, and deterministic verifiers form one audit boundary. */

import { BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import { SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER } from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/review'

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-transport-size-certificate.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_REQUEST_SIZE_CERTIFICATE_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-request-size-certificate.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_REQUEST_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-page-request.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID =
  'backfill-receipt-v2-chain-page' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION =
  'openpencil-supabase-backfill-receipt-v2-chain-page-v1' as const

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER = Object.freeze([
  ...SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  'afterRevision',
  'anchorRevision',
  'anchorEventId',
  'anchorReceiptDigest',
  'anchorUpdatedAt'
] as const)

/**
 * Static arithmetic certificate for the only Receipt V2 page wire accepted by a future Host.
 * It is data-only and grants no credential, transport, database, or release authority.
 */
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1 = Object.freeze({
  format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_FORMAT,
  version: 1 as const,
  providerId: 'supabase' as const,
  queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
  queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
  parameterCount: 33 as const,
  pageSize: 4 as const,
  lookaheadSize: 5 as const,
  maximumReceiptCount: BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS,
  maximumPageCount: 2_500 as const,
  maximumParameterStringBytes: 87_384 as const,
  maximumCanonicalRequestBytes: 262_144 as const,
  maximumRequestFramingBytes: 32_768 as const,
  maximumCanonicalReceiptBytesEach: 65_536 as const,
  maximumBase64CharactersEach: 87_384 as const,
  maximumBase64CharactersPerPage: 349_536 as const,
  maximumResponseFramingBytes: 131_072 as const,
  maximumResponseBytes: 480_608 as const,
  maximumDecodedReceiptBytesPerPage: 262_144 as const,
  maximumDecodedReceiptBytesPerCollection: 655_360_000 as const,
  requestEncoding: 'utf-8-compact-json-fixed-key-order' as const,
  responseEncoding: 'utf-8-compact-json' as const,
  responseCapRequiredBeforeCopyAndParse: true as const,
  fatalUTF8Required: true as const,
  staticArithmeticVerified: true as const,
  requestDispatched: false as const,
  productionResponseAuthenticated: false as const,
  credentialAuthorityCreated: false as const,
  transportAuthorityCreated: false as const,
  databaseAuthorityCreated: false as const,
  releaseAuthorityCreated: false as const
})

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.pageSize
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.lookaheadSize
export const SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumCanonicalReceiptBytesEach
export const SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumBase64CharactersEach
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumBase64CharactersPerPage
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_MAX_PAGE_COUNT =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumPageCount
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_MAX_DECODED_RECEIPT_BYTES =
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumDecodedReceiptBytesPerCollection

type ParameterValue = string | null

export interface SupabaseBackfillReceiptV2ChainRequestSizeCertificateV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_REQUEST_SIZE_CERTIFICATE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly queryId: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID
  readonly queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION
  readonly limitsCertificateDigest: string
  readonly canonicalRequestDigest: string
  readonly parameterCount: 33
  readonly parameterValuesExposed: false
  readonly canonicalRequestByteLength: number
  readonly parameterPayloadByteLength: number
  readonly requestFramingByteLength: number
  readonly maximumParameterStringBytes: number
  readonly maximumCanonicalRequestBytes: number
  readonly maximumRequestFramingBytes: number
  readonly requestSizeCertified: true
  readonly requestFramingCertified: true
  readonly requestDispatched: false
  readonly productionTransportAuthenticated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

export interface SupabaseBackfillReceiptV2ChainBoundedResponseJSONV1 {
  readonly response: unknown
  readonly responseByteLength: number
}

export interface SupabaseBackfillReceiptV2ChainResponseSizeV1 {
  readonly responseByteLength: number
  readonly base64PayloadCharacterCount: number
  readonly responseFramingByteLength: number
  readonly responseSizeCertified: true
  readonly responseFramingCertified: true
}

export interface SupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1 {
  readonly decodedReceiptByteLength: number
  readonly maximumDecodedReceiptBytes: number
  readonly decodedAggregateBoundCertified: true
}

export interface SupabaseBackfillReceiptV2ChainTransportSizeReviewV1 {
  readonly limits: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
  readonly request: SupabaseBackfillReceiptV2ChainRequestSizeCertificateV1
  readonly localRequestAndResponseBoundsCertified: true
  readonly decodedAggregateBoundCertified: true
  readonly productionResponseProvenanceAuthenticated: false
  readonly productionTransportAuthenticated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

export type SupabaseBackfillReceiptV2ChainTransportSizeErrorCode =
  | 'supabase-backfill-receipt-v2-chain-transport-size-certificate-invalid'
  | 'supabase-backfill-receipt-v2-chain-request-invalid'
  | 'supabase-backfill-receipt-v2-chain-request-too-large'
  | 'supabase-backfill-receipt-v2-chain-request-framing-too-large'
  | 'supabase-backfill-receipt-v2-chain-response-invalid'
  | 'supabase-backfill-receipt-v2-chain-response-too-large'
  | 'supabase-backfill-receipt-v2-chain-response-framing-too-large'
  | 'supabase-backfill-receipt-v2-chain-decoded-aggregate-too-large'
  | 'supabase-backfill-receipt-v2-chain-transport-size-digest-failed'

export class SupabaseBackfillReceiptV2ChainTransportSizeError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptV2ChainTransportSizeErrorCode) {
    super(`Supabase backfill Receipt V2 chain transport-size certification failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptV2ChainTransportSizeError'
  }
}

interface TransportSizeArithmeticViewV1 {
  readonly parameterCount: number
  readonly pageSize: number
  readonly maximumReceiptCount: number
  readonly maximumPageCount: number
  readonly maximumCanonicalRequestBytes: number
  readonly maximumRequestFramingBytes: number
  readonly maximumCanonicalReceiptBytesEach: number
  readonly maximumBase64CharactersEach: number
  readonly maximumBase64CharactersPerPage: number
  readonly maximumResponseFramingBytes: number
  readonly maximumResponseBytes: number
  readonly maximumDecodedReceiptBytesPerPage: number
  readonly maximumDecodedReceiptBytesPerCollection: number
  readonly responseCapRequiredBeforeCopyAndParse: boolean
  readonly fatalUTF8Required: boolean
  readonly staticArithmeticVerified: boolean
  readonly requestDispatched: boolean
  readonly productionResponseAuthenticated: boolean
  readonly credentialAuthorityCreated: boolean
  readonly transportAuthorityCreated: boolean
  readonly databaseAuthorityCreated: boolean
  readonly releaseAuthorityCreated: boolean
}

const REQUEST_CERTIFICATE_KEYS = Object.freeze([
  'format',
  'version',
  'providerId',
  'queryId',
  'queryVersion',
  'limitsCertificateDigest',
  'canonicalRequestDigest',
  'parameterCount',
  'parameterValuesExposed',
  'canonicalRequestByteLength',
  'parameterPayloadByteLength',
  'requestFramingByteLength',
  'maximumParameterStringBytes',
  'maximumCanonicalRequestBytes',
  'maximumRequestFramingBytes',
  'requestSizeCertified',
  'requestFramingCertified',
  'requestDispatched',
  'productionTransportAuthenticated',
  'credentialAuthorityCreated',
  'transportAuthorityCreated',
  'databaseAuthorityCreated',
  'releaseAuthorityCreated'
] as const)

const TRANSPORT_SIZE_CERTIFICATE_KEYS = Object.freeze([
  'format',
  'version',
  'providerId',
  'queryId',
  'queryVersion',
  'parameterCount',
  'pageSize',
  'lookaheadSize',
  'maximumReceiptCount',
  'maximumPageCount',
  'maximumParameterStringBytes',
  'maximumCanonicalRequestBytes',
  'maximumRequestFramingBytes',
  'maximumCanonicalReceiptBytesEach',
  'maximumBase64CharactersEach',
  'maximumBase64CharactersPerPage',
  'maximumResponseFramingBytes',
  'maximumResponseBytes',
  'maximumDecodedReceiptBytesPerPage',
  'maximumDecodedReceiptBytesPerCollection',
  'requestEncoding',
  'responseEncoding',
  'responseCapRequiredBeforeCopyAndParse',
  'fatalUTF8Required',
  'staticArithmeticVerified',
  'requestDispatched',
  'productionResponseAuthenticated',
  'credentialAuthorityCreated',
  'transportAuthorityCreated',
  'databaseAuthorityCreated',
  'releaseAuthorityCreated'
] as const)

function fail(code: SupabaseBackfillReceiptV2ChainTransportSizeErrorCode): never {
  throw new SupabaseBackfillReceiptV2ChainTransportSizeError(code)
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

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-request-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-v2-chain-request-invalid')
  }
  return descriptor.value
}

function parameterSnapshot(value: unknown): readonly ParameterValue[] {
  let prototype: object | null
  let keys: readonly PropertyKey[]
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    if (!Array.isArray(value)) return fail('supabase-backfill-receipt-v2-chain-request-invalid')
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-request-invalid')
  }
  const expectedLength = SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length
  if (
    prototype !== Array.prototype ||
    lengthDescriptor?.value !== expectedLength ||
    keys.length !== expectedLength + 1 ||
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= expectedLength))
    )
  ) {
    return fail('supabase-backfill-receipt-v2-chain-request-invalid')
  }
  const encoder = new TextEncoder()
  const values: ParameterValue[] = []
  for (let index = 0; index < expectedLength; index += 1) {
    const entry = ownData(value, String(index))
    if (entry === null) {
      values.push(null)
      continue
    }
    if (typeof entry !== 'string' || hasUnpairedUTF16Surrogate(entry)) {
      return fail('supabase-backfill-receipt-v2-chain-request-invalid')
    }
    if (
      encoder.encode(entry).byteLength >
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumParameterStringBytes
    ) {
      return fail('supabase-backfill-receipt-v2-chain-request-too-large')
    }
    values.push(entry)
  }
  return Object.freeze(values)
}

function canonicalRequest(
  parameters: readonly ParameterValue[]
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_REQUEST_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
    statementCount: 1 as const,
    accessMode: 'read-only' as const,
    parameterOrder: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
    parameters,
    rawSqlIncluded: false as const,
    endpointIncluded: false as const,
    requestDispatched: false as const
  })
}

function JSONBytes(value: unknown): Uint8Array {
  try {
    return new TextEncoder().encode(JSON.stringify(value))
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-request-invalid')
  }
}

async function rawDigest(bytes: Uint8Array): Promise<string> {
  try {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-transport-size-digest-failed')
  }
}

async function certificateDigest(): Promise<string> {
  try {
    return await digestCanonicalManifest(
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
    )
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-transport-size-digest-failed')
  }
}

function fixedTransportSizeArithmeticIsValid(): boolean {
  const certificate: TransportSizeArithmeticViewV1 =
    SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
  return [
    certificate.parameterCount === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length,
    certificate.maximumReceiptCount === BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS,
    certificate.maximumPageCount ===
      Math.ceil(certificate.maximumReceiptCount / certificate.pageSize),
    certificate.maximumBase64CharactersEach ===
      4 * Math.ceil(certificate.maximumCanonicalReceiptBytesEach / 3),
    certificate.maximumBase64CharactersPerPage ===
      certificate.pageSize * certificate.maximumBase64CharactersEach,
    certificate.maximumResponseBytes ===
      certificate.maximumBase64CharactersPerPage + certificate.maximumResponseFramingBytes,
    certificate.maximumCanonicalRequestBytes > certificate.maximumRequestFramingBytes,
    certificate.maximumResponseBytes > certificate.maximumResponseFramingBytes,
    certificate.maximumDecodedReceiptBytesPerPage ===
      certificate.pageSize * certificate.maximumCanonicalReceiptBytesEach,
    certificate.maximumDecodedReceiptBytesPerCollection ===
      certificate.maximumReceiptCount * certificate.maximumCanonicalReceiptBytesEach,
    certificate.responseCapRequiredBeforeCopyAndParse,
    certificate.fatalUTF8Required,
    certificate.staticArithmeticVerified,
    !certificate.requestDispatched,
    !certificate.productionResponseAuthenticated,
    !certificate.credentialAuthorityCreated,
    !certificate.transportAuthorityCreated,
    !certificate.databaseAuthorityCreated,
    !certificate.releaseAuthorityCreated
  ].every(Boolean)
}

/** Recompute the fixed arithmetic without trusting the certificate's boolean claim. */
export function verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(
  value: unknown
): value is typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return false
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== TRANSPORT_SIZE_CERTIFICATE_KEYS.length ||
    keys.some(
      (key) => typeof key !== 'string' || !TRANSPORT_SIZE_CERTIFICATE_KEYS.includes(key as never)
    )
  ) {
    return false
  }
  for (const key of TRANSPORT_SIZE_CERTIFICATE_KEYS) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return false
    }
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.value !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1[key]
    ) {
      return false
    }
  }
  return fixedTransportSizeArithmeticIsValid()
}

/**
 * Bind exact canonical request bytes to one hidden parameter vector. The certificate exposes only
 * lengths and digests, performs no dispatch, and is reproducible from the same trusted values.
 */
export async function createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(
  parameterValues: unknown
): Promise<SupabaseBackfillReceiptV2ChainRequestSizeCertificateV1> {
  if (
    !verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
    )
  ) {
    return fail('supabase-backfill-receipt-v2-chain-transport-size-certificate-invalid')
  }
  const parameters = parameterSnapshot(parameterValues)
  const requestBytes = JSONBytes(canonicalRequest(parameters))
  const encoder = new TextEncoder()
  const parameterPayloadByteLength = parameters.reduce(
    (total, value) => total + (value === null ? 0 : encoder.encode(value).byteLength),
    0
  )
  const requestFramingByteLength = requestBytes.byteLength - parameterPayloadByteLength
  const limits = SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
  if (requestBytes.byteLength > limits.maximumCanonicalRequestBytes) {
    return fail('supabase-backfill-receipt-v2-chain-request-too-large')
  }
  if (
    requestFramingByteLength < 0 ||
    requestFramingByteLength > limits.maximumRequestFramingBytes
  ) {
    return fail('supabase-backfill-receipt-v2-chain-request-framing-too-large')
  }
  const [limitsCertificateDigest, canonicalRequestDigest] = await Promise.all([
    certificateDigest(),
    rawDigest(requestBytes)
  ])
  return Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_REQUEST_SIZE_CERTIFICATE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
    limitsCertificateDigest,
    canonicalRequestDigest,
    parameterCount: 33 as const,
    parameterValuesExposed: false as const,
    canonicalRequestByteLength: requestBytes.byteLength,
    parameterPayloadByteLength,
    requestFramingByteLength,
    maximumParameterStringBytes: limits.maximumParameterStringBytes,
    maximumCanonicalRequestBytes: limits.maximumCanonicalRequestBytes,
    maximumRequestFramingBytes: limits.maximumRequestFramingBytes,
    requestSizeCertified: true as const,
    requestFramingCertified: true as const,
    requestDispatched: false as const,
    productionTransportAuthenticated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const
  })
}

/** Verify a serialized/local copy by recomputing the exact request certificate. */
export async function verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(
  parameterValues: unknown,
  value: unknown
): Promise<boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return false
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }
  if (
    keys.length !== REQUEST_CERTIFICATE_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !REQUEST_CERTIFICATE_KEYS.includes(key as never))
  ) {
    return false
  }
  let expected: SupabaseBackfillReceiptV2ChainRequestSizeCertificateV1
  try {
    expected = await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(parameterValues)
  } catch {
    return false
  }
  for (const key of REQUEST_CERTIFICATE_KEYS) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return false
    }
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      descriptor.value !== expected[key]
    ) {
      return false
    }
  }
  return true
}

/** Cap, copy, fatal-decode, and require compact JSON framing before returning untrusted data. */
export function parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(
  value: unknown
): SupabaseBackfillReceiptV2ChainBoundedResponseJSONV1 {
  let prototype: object | null
  let byteLength: number
  try {
    if (!(value instanceof Uint8Array)) {
      return fail('supabase-backfill-receipt-v2-chain-response-invalid')
    }
    prototype = Object.getPrototypeOf(value)
    byteLength = value.byteLength
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-response-invalid')
  }
  if (prototype !== Uint8Array.prototype || byteLength < 1) {
    return fail('supabase-backfill-receipt-v2-chain-response-invalid')
  }
  if (
    byteLength >
    SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumResponseBytes
  ) {
    return fail('supabase-backfill-receipt-v2-chain-response-too-large')
  }
  let bytes: Uint8Array
  let text: string
  let response: unknown
  try {
    bytes = new Uint8Array(byteLength)
    bytes.set(value)
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    response = JSON.parse(text) as unknown
    if (JSON.stringify(response) !== text) {
      return fail('supabase-backfill-receipt-v2-chain-response-invalid')
    }
  } catch (cause) {
    if (cause instanceof SupabaseBackfillReceiptV2ChainTransportSizeError) throw cause
    return fail('supabase-backfill-receipt-v2-chain-response-invalid')
  }
  return Object.freeze({ response, responseByteLength: byteLength })
}

/** Bind the accepted wire size to the already validated ASCII Base64 payload count. */
export function certifySupabaseBackfillReceiptV2ChainResponseSizeV1(
  responseByteLength: number,
  base64PayloadCharacterCount: number
): SupabaseBackfillReceiptV2ChainResponseSizeV1 {
  const limits = SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
  if (
    !Number.isSafeInteger(responseByteLength) ||
    responseByteLength < 1 ||
    !Number.isSafeInteger(base64PayloadCharacterCount) ||
    base64PayloadCharacterCount < 0 ||
    base64PayloadCharacterCount > limits.maximumBase64CharactersPerPage
  ) {
    return fail('supabase-backfill-receipt-v2-chain-response-invalid')
  }
  if (responseByteLength > limits.maximumResponseBytes) {
    return fail('supabase-backfill-receipt-v2-chain-response-too-large')
  }
  const responseFramingByteLength = responseByteLength - base64PayloadCharacterCount
  if (
    responseFramingByteLength < 0 ||
    responseFramingByteLength > limits.maximumResponseFramingBytes
  ) {
    return fail('supabase-backfill-receipt-v2-chain-response-framing-too-large')
  }
  return Object.freeze({
    responseByteLength,
    base64PayloadCharacterCount,
    responseFramingByteLength,
    responseSizeCertified: true as const,
    responseFramingCertified: true as const
  })
}

/** Certify the running decoded canonical-Receipt total without retaining any Receipt bytes. */
export function certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1(
  decodedReceiptByteLength: number
): SupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1 {
  const maximumDecodedReceiptBytes =
    SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1.maximumDecodedReceiptBytesPerCollection
  if (
    !Number.isSafeInteger(decodedReceiptByteLength) ||
    decodedReceiptByteLength < 0 ||
    decodedReceiptByteLength > maximumDecodedReceiptBytes
  ) {
    return fail('supabase-backfill-receipt-v2-chain-decoded-aggregate-too-large')
  }
  return Object.freeze({
    decodedReceiptByteLength,
    maximumDecodedReceiptBytes,
    decodedAggregateBoundCertified: true as const
  })
}
