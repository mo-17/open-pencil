import {
  backendSha256,
  canonicalBackendBytes,
  canonicalBackendValue,
  freezeBackendValue
} from '#compiler/backend/canonical'
import { createBackendProviderPlanV2 } from '#compiler/backend/v2/plan'
import { createBackendProviderRegistryV2 } from '#compiler/backend/v2/registry'

import {
  parseBackendApplicationSpecV2,
  type BackendApplicationSpecV2
} from '@open-pencil/lowcode/backend'

import { SUPABASE_BACKEND_PROVIDER_BUNDLE_V2 } from '../bundle'
import {
  createSupabaseBackfillCompilerBuildAuthorityV1,
  createSupabaseBackfillCompilerSelectionV1,
  parseSupabaseBackfillCompilerBuildAuthorityV1,
  SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1,
  type SupabaseBackfillCompilerBuildAuthorityV1
} from '../compiler-authority'
import {
  createSupabaseBackfillInspectionSubjectV1,
  type SupabaseBackfillInspectionSubjectEnvelopeV1
} from './inspection'

export const SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1 = Object.freeze({
  maxRequestBytes: 1_048_576,
  maxResponseBytes: 1_048_576
})

export const SUPABASE_BACKFILL_INSPECTION_REQUEST_DIGEST_DOMAIN_V1 =
  'openpencil.compiler.supabase-backfill-inspection-request.v1' as const

export type SupabaseBackfillInspectionWireTargetV1 = 'react' | 'vue'

export interface SupabaseBackfillInspectionWireRequestV1 {
  readonly version: typeof SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1
  readonly requestNonce: string
  readonly target: SupabaseBackfillInspectionWireTargetV1
  readonly application: BackendApplicationSpecV2
}

export interface ParsedSupabaseBackfillInspectionWireRequestV1 {
  readonly request: SupabaseBackfillInspectionWireRequestV1
  readonly requestDigest: string
}

export interface SupabaseBackfillInspectionWireResponseV1 {
  readonly version: typeof SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1
  readonly requestNonce: string
  readonly requestDigest: string
  readonly compilerBuildAuthority: SupabaseBackfillCompilerBuildAuthorityV1
  readonly subjectEnvelope: SupabaseBackfillInspectionSubjectEnvelopeV1
}

export interface CreateSupabaseBackfillInspectionWireResponseInputV1 {
  readonly request: SupabaseBackfillInspectionWireRequestV1
  readonly requestDigest: string
  readonly subjectEnvelope: SupabaseBackfillInspectionSubjectEnvelopeV1
}

export type ExpectedSupabaseBackfillInspectionWireResponseV1 =
  ParsedSupabaseBackfillInspectionWireRequestV1

const REQUEST_KEYS = ['application', 'requestNonce', 'target', 'version'] as const
const RESPONSE_KEYS = [
  'compilerBuildAuthority',
  'requestDigest',
  'requestNonce',
  'subjectEnvelope',
  'version'
] as const
const RESPONSE_INPUT_KEYS = ['request', 'requestDigest', 'subjectEnvelope'] as const
const EXPECTED_RESPONSE_KEYS = ['request', 'requestDigest'] as const
const SUBJECT_ENVELOPE_KEYS = ['subject', 'subjectDigest'] as const
const CANONICAL_SHA256_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

function assertWellFormedUnicode(value: unknown): void {
  if (typeof value === 'string') {
    if (!isWellFormedUtf16(value)) {
      throw new TypeError(
        'Supabase backfill inspection request must contain only well-formed Unicode strings.'
      )
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertWellFormedUnicode(entry)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    assertWellFormedUnicode(key)
    assertWellFormedUnicode(entry)
  }
}

function canonicalText(value: unknown, path: string): string {
  return new TextDecoder().decode(canonicalBackendBytes(value, path))
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  label: string
): Record<Keys[number], unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} must contain only its exact protocol fields.`)
  }
  return value as Record<Keys[number], unknown>
}

function canonicalDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CANONICAL_SHA256_BASE64URL.test(value)) {
    throw new TypeError(`${label} must be a canonical SHA-256 base64url digest.`)
  }
  return value
}

function requestNonce(value: unknown): string {
  return canonicalDigest(value, 'Supabase backfill inspection request nonce')
}

function parseCanonicalFrame(input: string, maximumBytes: number, label: string): unknown {
  if (typeof input !== 'string' || byteLength(input) < 2 || byteLength(input) > maximumBytes) {
    throw new RangeError(`${label} exceeds its byte limit.`)
  }
  let value: unknown
  try {
    value = JSON.parse(input) as unknown
  } catch {
    throw new TypeError(`${label} must be one JSON frame.`)
  }
  let canonical: string
  try {
    canonical = canonicalText(value, `$.${label}`)
  } catch {
    throw new TypeError(`${label} must contain bounded inert JSON data.`)
  }
  if (canonical !== input) {
    throw new TypeError(`${label} must use the exact canonical JSON encoding.`)
  }
  return value
}

function normalizedApplication(value: unknown): BackendApplicationSpecV2 {
  const parsed = parseBackendApplicationSpecV2(value)
  if (!parsed.ok) {
    throw new TypeError('Supabase backfill inspection application must be valid Backend V2 data.')
  }
  if (
    canonicalText(value, '$.supabaseBackfillInspectionWire.application.input') !==
    canonicalText(parsed.value, '$.supabaseBackfillInspectionWire.application.normalized')
  ) {
    throw new TypeError('Supabase backfill inspection application must already be normalized.')
  }
  return parsed.value
}

function normalizeRequest(value: unknown): SupabaseBackfillInspectionWireRequestV1 {
  let snapshot: unknown
  try {
    snapshot = canonicalBackendValue(value, '$.supabaseBackfillInspectionWire.request')
  } catch {
    throw new TypeError('Supabase backfill inspection request must be bounded inert data.')
  }
  assertWellFormedUnicode(snapshot)
  const source = exactRecord(snapshot, REQUEST_KEYS, 'Supabase backfill inspection request')
  if (source.version !== SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1) {
    throw new TypeError('Supabase backfill inspection request version is unsupported.')
  }
  if (source.target !== 'react' && source.target !== 'vue') {
    throw new TypeError('Supabase backfill inspection request target is unsupported.')
  }
  return freezeBackendValue({
    version: SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1,
    requestNonce: requestNonce(source.requestNonce),
    target: source.target,
    application: normalizedApplication(source.application)
  }) as SupabaseBackfillInspectionWireRequestV1
}

function requestDigestPayload(request: SupabaseBackfillInspectionWireRequestV1) {
  return {
    version: request.version,
    target: request.target,
    application: request.application
  }
}

export function supabaseBackfillInspectionWireRequestDigestV1(
  value: SupabaseBackfillInspectionWireRequestV1
): string {
  const request = normalizeRequest(value)
  const prefix = new TextEncoder().encode(
    `${SUPABASE_BACKFILL_INSPECTION_REQUEST_DIGEST_DOMAIN_V1}\0`
  )
  const payload = canonicalBackendBytes(
    requestDigestPayload(request),
    '$.supabaseBackfillInspectionWire.requestDigest'
  )
  const framed = new Uint8Array(prefix.byteLength + payload.byteLength)
  framed.set(prefix)
  framed.set(payload, prefix.byteLength)
  return backendSha256(framed)
}

export function serializeSupabaseBackfillInspectionWireRequestV1(
  value: SupabaseBackfillInspectionWireRequestV1
): string {
  const request = normalizeRequest(value)
  const serialized = canonicalText(request, '$.supabaseBackfillInspectionWire.request')
  if (byteLength(serialized) > SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1.maxRequestBytes) {
    throw new RangeError('Supabase backfill inspection request exceeds its byte limit.')
  }
  return serialized
}

export function parseSupabaseBackfillInspectionWireRequestV1(
  input: string
): ParsedSupabaseBackfillInspectionWireRequestV1 {
  const frame = parseCanonicalFrame(
    input,
    SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1.maxRequestBytes,
    'Supabase backfill inspection request'
  )
  const request = normalizeRequest(frame)
  if (serializeSupabaseBackfillInspectionWireRequestV1(request) !== input) {
    throw new TypeError('Supabase backfill inspection request is not normalized.')
  }
  return Object.freeze({
    request,
    requestDigest: supabaseBackfillInspectionWireRequestDigestV1(request)
  })
}

function expectedSubjectEnvelope(
  request: SupabaseBackfillInspectionWireRequestV1
): SupabaseBackfillInspectionSubjectEnvelopeV1 {
  const registry = createBackendProviderRegistryV2([SUPABASE_BACKEND_PROVIDER_BUNDLE_V2])
  const selection = createSupabaseBackfillCompilerSelectionV1()
  const planned = createBackendProviderPlanV2(registry, {
    selection,
    application: request.application,
    target: request.target,
    mode: 'production'
  })
  if (!planned.ok) {
    throw new TypeError(
      'Supabase backfill inspection request is outside the trusted Compiler subset.'
    )
  }
  return createSupabaseBackfillInspectionSubjectV1(registry, {
    plan: planned.plan,
    selection
  })
}

function normalizeSubjectEnvelope(
  value: unknown,
  request: SupabaseBackfillInspectionWireRequestV1
): SupabaseBackfillInspectionSubjectEnvelopeV1 {
  let snapshot: unknown
  try {
    snapshot = canonicalBackendValue(value, '$.supabaseBackfillInspectionWire.subjectEnvelope')
  } catch {
    throw new TypeError('Supabase backfill inspection subject envelope must be bounded inert data.')
  }
  const source = exactRecord(
    snapshot,
    SUBJECT_ENVELOPE_KEYS,
    'Supabase backfill inspection subject envelope'
  )
  canonicalDigest(source.subjectDigest, 'Supabase backfill inspection subject digest')
  const expected = expectedSubjectEnvelope(request)
  if (
    canonicalText(snapshot, '$.supabaseBackfillInspectionWire.subjectEnvelope.actual') !==
    canonicalText(expected, '$.supabaseBackfillInspectionWire.subjectEnvelope.expected')
  ) {
    throw new TypeError(
      'Supabase backfill inspection subject is not the deterministic Compiler result for its request.'
    )
  }
  return expected
}

export function createSupabaseBackfillInspectionWireResponseV1(
  value: CreateSupabaseBackfillInspectionWireResponseInputV1
): SupabaseBackfillInspectionWireResponseV1 {
  let snapshot: unknown
  try {
    snapshot = canonicalBackendValue(value, '$.supabaseBackfillInspectionWire.responseInput')
  } catch {
    throw new TypeError('Supabase backfill inspection response input must be bounded inert data.')
  }
  const source = exactRecord(
    snapshot,
    RESPONSE_INPUT_KEYS,
    'Supabase backfill inspection response input'
  )
  const request = normalizeRequest(source.request)
  const requestDigest = canonicalDigest(
    source.requestDigest,
    'Supabase backfill inspection response request digest'
  )
  if (requestDigest !== supabaseBackfillInspectionWireRequestDigestV1(request)) {
    throw new TypeError('Supabase backfill inspection response request digest does not match.')
  }
  return freezeBackendValue({
    version: SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1,
    requestNonce: request.requestNonce,
    requestDigest,
    compilerBuildAuthority: createSupabaseBackfillCompilerBuildAuthorityV1(),
    subjectEnvelope: normalizeSubjectEnvelope(source.subjectEnvelope, request)
  }) as SupabaseBackfillInspectionWireResponseV1
}

export function serializeSupabaseBackfillInspectionWireResponseV1(
  value: CreateSupabaseBackfillInspectionWireResponseInputV1
): string {
  const response = createSupabaseBackfillInspectionWireResponseV1(value)
  const serialized = canonicalText(response, '$.supabaseBackfillInspectionWire.response')
  if (byteLength(serialized) > SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1.maxResponseBytes) {
    throw new RangeError('Supabase backfill inspection response exceeds its byte limit.')
  }
  return serialized
}

export function parseSupabaseBackfillInspectionWireResponseV1(
  input: string,
  expected: ExpectedSupabaseBackfillInspectionWireResponseV1
): SupabaseBackfillInspectionWireResponseV1 {
  const frame = parseCanonicalFrame(
    input,
    SUPABASE_BACKFILL_INSPECTION_WIRE_LIMITS_V1.maxResponseBytes,
    'Supabase backfill inspection response'
  )
  const source = exactRecord(frame, RESPONSE_KEYS, 'Supabase backfill inspection response')
  if (source.version !== SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1) {
    throw new TypeError('Supabase backfill inspection response version is unsupported.')
  }
  const nonce = requestNonce(source.requestNonce)
  const requestDigest = canonicalDigest(
    source.requestDigest,
    'Supabase backfill inspection response request digest'
  )
  let expectedSnapshot: unknown
  try {
    expectedSnapshot = canonicalBackendValue(
      expected,
      '$.supabaseBackfillInspectionWire.expectedResponse'
    )
  } catch {
    throw new TypeError('Expected Supabase backfill inspection request must be bounded inert data.')
  }
  const expectedSource = exactRecord(
    expectedSnapshot,
    EXPECTED_RESPONSE_KEYS,
    'Expected Supabase backfill inspection request'
  )
  const expectedRequest = normalizeRequest(expectedSource.request)
  const expectedRequestDigest = canonicalDigest(
    expectedSource.requestDigest,
    'Expected request digest'
  )
  if (
    expectedRequestDigest !== supabaseBackfillInspectionWireRequestDigestV1(expectedRequest) ||
    nonce !== expectedRequest.requestNonce ||
    requestDigest !== expectedRequestDigest
  ) {
    throw new TypeError('Supabase backfill inspection response request binding does not match.')
  }
  const response = freezeBackendValue({
    version: SUPABASE_BACKFILL_INSPECTION_WIRE_VERSION_V1,
    requestNonce: nonce,
    requestDigest,
    compilerBuildAuthority: parseSupabaseBackfillCompilerBuildAuthorityV1(
      source.compilerBuildAuthority
    ),
    subjectEnvelope: normalizeSubjectEnvelope(source.subjectEnvelope, expectedRequest)
  }) as SupabaseBackfillInspectionWireResponseV1
  if (canonicalText(response, '$.supabaseBackfillInspectionWire.response.normalized') !== input) {
    throw new TypeError('Supabase backfill inspection response is not normalized.')
  }
  return response
}
