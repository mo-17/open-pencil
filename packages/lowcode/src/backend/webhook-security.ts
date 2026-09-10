/* eslint-disable max-lines -- URL/IP policy, redacted authority, and raw-body-v1 parsing share one security boundary. */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  compareReleaseTimestamps,
  exactArray,
  exactRecord,
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  releaseTimestampInstantNanoseconds
} from './release/validation'
import type { BackendCredentialRef } from './types'
import { isBackendCredentialRef } from './validate'

export const BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT =
  'openpencil.backend-webhook-endpoint-observation' as const
export const BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT =
  'openpencil.backend-webhook-endpoint-authority' as const
export const BACKEND_WEBHOOK_RAW_BODY_SUBJECT_FORMAT =
  'openpencil.backend-webhook-raw-body-subject' as const
export const BACKEND_WEBHOOK_SECURITY_VERSION = 1 as const

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DNS_LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/u
const LOWER_HEX_SHA256 = /^[0-9a-f]{64}$/u
const PATH_PERCENT_AMBIGUITY = /%(?:0[0-9a-f]|1[0-9a-f]|25|2e|2f|5c|7f)/iu
const WIRE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u
const MAX_ENDPOINT_LENGTH = 2_048
const MAX_PATH_LENGTH = 1_024
const MAX_RESOLVED_ADDRESSES = 16
const MAX_DNS_OBSERVATION_MS = 5 * 60 * 1_000
const MAX_DNS_OBSERVATION_NS = BigInt(MAX_DNS_OBSERVATION_MS) * 1_000_000n
const NON_PUBLIC_DNS_SUFFIXES = new Set([
  'alt',
  'arpa',
  'example',
  'home',
  'internal',
  'invalid',
  'lan',
  'local',
  'localdomain',
  'localhost',
  'onion',
  'test'
])
const NON_PUBLIC_IPV4_RANGES: readonly (readonly [number, number])[] = [
  [0x0000_0000, 0x00ff_ffff],
  [0x0a00_0000, 0x0aff_ffff],
  [0x6440_0000, 0x647f_ffff],
  [0x7f00_0000, 0x7fff_ffff],
  [0xa9fe_0000, 0xa9fe_ffff],
  [0xac10_0000, 0xac1f_ffff],
  [0xc000_0000, 0xc000_00ff],
  [0xc000_0200, 0xc000_02ff],
  [0xc058_6300, 0xc058_63ff],
  [0xc0a8_0000, 0xc0a8_ffff],
  [0xc612_0000, 0xc613_ffff],
  [0xc633_6400, 0xc633_64ff],
  [0xcb00_7100, 0xcb00_71ff],
  [0xe000_0000, 0xffff_ffff]
]

const OBSERVATION_FIELDS = [
  'format',
  'version',
  'endpointCredentialRef',
  'credentialGeneration',
  'endpoint',
  'resolvedAddresses',
  'redirectCount',
  'observedAt',
  'expiresAt',
  'evaluatedAt'
] as const

const AUTHORITY_FIELDS = [
  'format',
  'version',
  'endpointCredentialReferenceDigest',
  'credentialGeneration',
  'endpointAuthorityDigest',
  'originDigest',
  'pathDigest',
  'resolvedAddressSetDigest',
  'observedAt',
  'expiresAt',
  'redirectPolicy',
  'dnsPinningRequired',
  'hostResolutionAuthenticated',
  'networkAuthorityCreated'
] as const

const RAW_BODY_SUBJECT_FIELDS = [
  'format',
  'version',
  'method',
  'path',
  'timestampUnixSeconds',
  'idempotencyKey',
  'rawBodySha256'
] as const

interface ParsedEndpoint {
  readonly canonicalEndpoint: string
  readonly canonicalOrigin: string
  readonly canonicalPath: string
  readonly literalAddress: string | null
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true
    }
  }
  return false
}

function hasNonCanonicalPercentEscape(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue
    if (!/^[0-9A-F]{2}$/u.test(value.slice(index + 1, index + 3))) return true
    index += 2
  }
  return false
}

function hasInvalidPercentEncodedUTF8(value: string): boolean {
  try {
    decodeURIComponent(value)
    return false
  } catch {
    return true
  }
}

export interface BackendWebhookEndpointObservationV1 {
  readonly format: typeof BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT
  readonly version: typeof BACKEND_WEBHOOK_SECURITY_VERSION
  readonly endpointCredentialRef: BackendCredentialRef
  readonly credentialGeneration: string
  /** Ephemeral Host-resolved credential value. Never retained in the returned authority subject. */
  readonly endpoint: string
  readonly resolvedAddresses: readonly string[]
  /** V1 rejects redirects instead of attempting to infer equivalent authority. */
  readonly redirectCount: 0
  readonly observedAt: string
  readonly expiresAt: string
  readonly evaluatedAt: string
}

/**
 * Secret-free subject for an accepted Host receipt. Shape validation does not authenticate the
 * resolver, DNS answers, credential store, clock, or network path.
 */
export interface BackendWebhookEndpointAuthorityV1 {
  readonly format: typeof BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT
  readonly version: typeof BACKEND_WEBHOOK_SECURITY_VERSION
  readonly endpointCredentialReferenceDigest: string
  readonly credentialGeneration: string
  readonly endpointAuthorityDigest: string
  readonly originDigest: string
  readonly pathDigest: string
  readonly resolvedAddressSetDigest: string
  readonly observedAt: string
  readonly expiresAt: string
  readonly redirectPolicy: 'reject'
  readonly dnsPinningRequired: true
  readonly hostResolutionAuthenticated: false
  readonly networkAuthorityCreated: false
}

export interface BackendWebhookRawBodySubjectV1 {
  readonly format: typeof BACKEND_WEBHOOK_RAW_BODY_SUBJECT_FORMAT
  readonly version: typeof BACKEND_WEBHOOK_SECURITY_VERSION
  readonly method: 'POST'
  readonly path: string
  readonly timestampUnixSeconds: number
  readonly idempotencyKey: string
  readonly rawBodySha256: string
}

function credentialRef(value: unknown, path: string): BackendCredentialRef {
  if (typeof value !== 'string' || !isBackendCredentialRef(value)) {
    throw new TypeError(`${path} must be an opaque Host credential reference`)
  }
  return value
}

function credentialGeneration(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new TypeError(`${path} must be a canonical UUID v4 generation`)
  }
  return value
}

function ephemeralEndpoint(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ENDPOINT_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    hasUnpairedSurrogate(value)
  ) {
    throw new TypeError('Webhook endpoint credential value is invalid')
  }
  return value
}

function parseIPv4(address: string): readonly number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const values: number[] = []
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    values.push(value)
  }
  return values
}

function publicIPv4(parts: readonly number[]): boolean {
  if (parts.length !== 4) return false
  const address = parts.reduce((current, part) => current * 256 + part, 0)
  return !NON_PUBLIC_IPV4_RANGES.some(([start, end]) => address >= start && address <= end)
}

function parseIPv6(address: string): readonly number[] | null {
  let source = address.toLowerCase()
  if (source.startsWith('[') && source.endsWith(']')) source = source.slice(1, -1)
  if (source.length === 0 || source.includes('%')) return null
  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':')
    const ipv4 = parseIPv4(source.slice(lastColon + 1))
    if (lastColon === -1 || !ipv4) return null
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0)
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0)
    source = `${source.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`
  }
  if ((source.match(/::/gu) ?? []).length > 1) return null
  const [leftSource, rightSource] = source.split('::')
  const left = leftSource ? leftSource.split(':') : []
  const right = rightSource ? rightSource.split(':') : []
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null
  const omitted = 8 - left.length - right.length
  if (source.includes('::') ? omitted < 1 : omitted !== 0) return null
  return [...left, ...Array.from({ length: omitted }, () => '0'), ...right].map((part) =>
    Number.parseInt(part, 16)
  )
}

function publicIPv6(parts: readonly number[]): boolean {
  if (parts.length !== 8) return false
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  // V1 deliberately accepts only native global-unicast space and rejects transition ranges.
  if (first < 0x2000 || first > 0x3fff) return false
  if (first === 0x2001 && second === 0x0db8) return false
  if (first === 0x2001 && second <= 0x01ff) return false
  if (first === 0x2002) return false
  if (first === 0x3ffe) return false
  if (first === 0x3fff && second <= 0x0fff) return false
  return true
}

export function isPublicBackendWebhookAddress(value: string): boolean {
  const ipv4 = parseIPv4(value)
  if (ipv4) return publicIPv4(ipv4)
  const ipv6 = parseIPv6(value)
  return ipv6 ? publicIPv6(ipv6) : false
}

function canonicalAddress(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 64 || !isPublicBackendWebhookAddress(value)) {
    throw new TypeError(`${path} must be a public unicast IP address`)
  }
  const ipv4 = parseIPv4(value)
  if (ipv4) return ipv4.join('.')
  const ipv6 = parseIPv6(value)
  if (!ipv6) throw new TypeError(`${path} must be a public unicast IP address`)
  return ipv6.map((part) => part.toString(16).padStart(4, '0')).join(':')
}

function dnsName(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253 || hostname.endsWith('.')) return false
  const labels = hostname.split('.')
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return false
  const suffix = labels.at(-1)
  return suffix !== undefined && !NON_PUBLIC_DNS_SUFFIXES.has(suffix)
}

function canonicalPath(pathname: string): string {
  const segments = pathname.split('/')
  if (
    pathname.length === 0 ||
    pathname.length > MAX_PATH_LENGTH ||
    !pathname.startsWith('/') ||
    pathname.includes('//') ||
    pathname.includes('\\') ||
    hasControlCharacter(pathname) ||
    hasUnpairedSurrogate(pathname) ||
    !WIRE_PATH.test(pathname) ||
    hasNonCanonicalPercentEscape(pathname) ||
    hasInvalidPercentEncodedUTF8(pathname) ||
    PATH_PERCENT_AMBIGUITY.test(pathname) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new TypeError('Webhook endpoint path is invalid')
  }
  return pathname
}

function parseEndpoint(value: string): ParsedEndpoint {
  if (value.includes('\\')) throw new TypeError('Webhook endpoint credential value is invalid')
  const pathStart = value.indexOf('/', value.indexOf('://') + 3)
  if (pathStart !== -1) canonicalPath(value.slice(pathStart))
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new TypeError('Webhook endpoint credential value is invalid')
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.hash !== '' ||
    endpoint.search !== '' ||
    (endpoint.port !== '' && endpoint.port !== '443')
  ) {
    throw new TypeError('Webhook endpoint authority is not supported')
  }
  const hostname = endpoint.hostname.toLowerCase()
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  const literalAddress = parseIPv4(literal) || parseIPv6(literal) ? literal : null
  if (literalAddress ? !isPublicBackendWebhookAddress(literalAddress) : !dnsName(hostname)) {
    throw new TypeError('Webhook endpoint host is not an accepted public authority')
  }
  const path = canonicalPath(endpoint.pathname)
  const origin = `https://${hostname}`
  return {
    canonicalEndpoint: `${origin}${path}`,
    canonicalOrigin: origin,
    canonicalPath: path,
    literalAddress
  }
}

function parsedAddresses(value: unknown, endpoint: ParsedEndpoint): readonly string[] {
  const entries = exactArray(value, '$.resolvedAddresses', MAX_RESOLVED_ADDRESSES)
  if (entries.length === 0) throw new TypeError('$.resolvedAddresses must not be empty')
  const addresses = entries
    .map((entry, index) => canonicalAddress(entry, `$.resolvedAddresses[${index}]`))
    .sort()
  if (new Set(addresses).size !== addresses.length) {
    throw new TypeError('$.resolvedAddresses must not contain duplicate addresses')
  }
  if (endpoint.literalAddress) {
    const literal = canonicalAddress(endpoint.literalAddress, '$.endpoint')
    if (addresses.length !== 1 || addresses[0] !== literal) {
      throw new TypeError('Literal endpoint must be pinned to exactly the same address')
    }
  }
  return Object.freeze(addresses)
}

function validateObservationWindow(
  observedAt: string,
  expiresAt: string,
  evaluatedAt: string
): void {
  if (compareReleaseTimestamps(expiresAt, observedAt) <= 0) {
    throw new TypeError('Webhook endpoint observation must expire after it was observed')
  }
  if (
    releaseTimestampInstantNanoseconds(expiresAt, '$.expiresAt') -
      releaseTimestampInstantNanoseconds(observedAt, '$.observedAt') >
    MAX_DNS_OBSERVATION_NS
  ) {
    throw new TypeError('Webhook endpoint observation lifetime is too long')
  }
  if (compareReleaseTimestamps(evaluatedAt, observedAt) < 0) {
    throw new TypeError('Webhook endpoint observation is future-dated')
  }
  if (compareReleaseTimestamps(evaluatedAt, expiresAt) >= 0) {
    throw new TypeError('Webhook endpoint observation is expired')
  }
}

function validateAuthorityWindow(observedAt: string, expiresAt: string): void {
  if (compareReleaseTimestamps(expiresAt, observedAt) <= 0) {
    throw new TypeError('Webhook endpoint authority must expire after it was observed')
  }
  if (
    releaseTimestampInstantNanoseconds(expiresAt, '$.expiresAt') -
      releaseTimestampInstantNanoseconds(observedAt, '$.observedAt') >
    MAX_DNS_OBSERVATION_NS
  ) {
    throw new TypeError('Webhook endpoint authority lifetime is too long')
  }
}

/**
 * Redact and bind one already-resolved endpoint credential. This pure function verifies syntax and
 * address classifications only; an authenticated Host resolver must issue and accept the receipt.
 */
export async function reviewBackendWebhookEndpointObservationV1(
  value: unknown
): Promise<BackendWebhookEndpointAuthorityV1> {
  const source = exactRecord(value, '$', OBSERVATION_FIELDS)
  if (source.format !== BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_WEBHOOK_SECURITY_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  if (source.redirectCount !== 0) throw new TypeError('Webhook endpoint redirects are forbidden')
  const reference = credentialRef(source.endpointCredentialRef, '$.endpointCredentialRef')
  const generation = credentialGeneration(source.credentialGeneration, '$.credentialGeneration')
  const endpoint = parseEndpoint(ephemeralEndpoint(source.endpoint))
  const addresses = parsedAddresses(source.resolvedAddresses, endpoint)
  const observedAt = releaseTimestamp(
    typeof source.observedAt === 'string' ? source.observedAt : '',
    '$.observedAt'
  )
  const expiresAt = releaseTimestamp(
    typeof source.expiresAt === 'string' ? source.expiresAt : '',
    '$.expiresAt'
  )
  const evaluatedAt = releaseTimestamp(
    typeof source.evaluatedAt === 'string' ? source.evaluatedAt : '',
    '$.evaluatedAt'
  )
  validateObservationWindow(observedAt, expiresAt, evaluatedAt)

  const snapshot = Object.freeze({
    format: BACKEND_WEBHOOK_ENDPOINT_OBSERVATION_FORMAT,
    version: BACKEND_WEBHOOK_SECURITY_VERSION,
    endpointCredentialRef: reference,
    credentialGeneration: generation,
    endpoint: endpoint.canonicalEndpoint,
    resolvedAddresses: addresses,
    redirectCount: 0,
    observedAt,
    expiresAt
  })
  const [referenceDigest, originDigest, pathDigest, addressDigest, authorityDigest] =
    await Promise.all([
      digestCanonicalManifest({ credentialRef: reference }),
      digestCanonicalManifest({ origin: endpoint.canonicalOrigin }),
      digestCanonicalManifest({ path: endpoint.canonicalPath }),
      digestCanonicalManifest({ resolvedAddresses: addresses }),
      digestCanonicalManifest(snapshot)
    ])
  return Object.freeze({
    format: BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT,
    version: BACKEND_WEBHOOK_SECURITY_VERSION,
    endpointCredentialReferenceDigest: referenceDigest,
    credentialGeneration: generation,
    endpointAuthorityDigest: authorityDigest,
    originDigest,
    pathDigest,
    resolvedAddressSetDigest: addressDigest,
    observedAt,
    expiresAt,
    redirectPolicy: 'reject',
    dnsPinningRequired: true,
    hostResolutionAuthenticated: false,
    networkAuthorityCreated: false
  })
}

export function parseBackendWebhookEndpointAuthorityV1(
  value: unknown
): BackendWebhookEndpointAuthorityV1 {
  const source = exactRecord(value, '$', AUTHORITY_FIELDS)
  if (source.format !== BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_WEBHOOK_SECURITY_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  if (
    source.redirectPolicy !== 'reject' ||
    source.dnsPinningRequired !== true ||
    source.hostResolutionAuthenticated !== false ||
    source.networkAuthorityCreated !== false
  ) {
    throw new TypeError('Webhook endpoint authority claims unsupported runtime authority')
  }
  const observedAt = releaseTimestamp(
    typeof source.observedAt === 'string' ? source.observedAt : '',
    '$.observedAt'
  )
  const expiresAt = releaseTimestamp(
    typeof source.expiresAt === 'string' ? source.expiresAt : '',
    '$.expiresAt'
  )
  validateAuthorityWindow(observedAt, expiresAt)
  return Object.freeze({
    format: BACKEND_WEBHOOK_ENDPOINT_AUTHORITY_FORMAT,
    version: BACKEND_WEBHOOK_SECURITY_VERSION,
    endpointCredentialReferenceDigest: releaseDigest(
      typeof source.endpointCredentialReferenceDigest === 'string'
        ? source.endpointCredentialReferenceDigest
        : '',
      '$.endpointCredentialReferenceDigest'
    ),
    credentialGeneration: credentialGeneration(
      source.credentialGeneration,
      '$.credentialGeneration'
    ),
    endpointAuthorityDigest: releaseDigest(
      typeof source.endpointAuthorityDigest === 'string' ? source.endpointAuthorityDigest : '',
      '$.endpointAuthorityDigest'
    ),
    originDigest: releaseDigest(
      typeof source.originDigest === 'string' ? source.originDigest : '',
      '$.originDigest'
    ),
    pathDigest: releaseDigest(
      typeof source.pathDigest === 'string' ? source.pathDigest : '',
      '$.pathDigest'
    ),
    resolvedAddressSetDigest: releaseDigest(
      typeof source.resolvedAddressSetDigest === 'string' ? source.resolvedAddressSetDigest : '',
      '$.resolvedAddressSetDigest'
    ),
    observedAt,
    expiresAt,
    redirectPolicy: 'reject',
    dnsPinningRequired: true,
    hostResolutionAuthenticated: false,
    networkAuthorityCreated: false
  })
}

export function canonicalBackendWebhookEndpointAuthorityV1Bytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendWebhookEndpointAuthorityV1(value))
}

export async function digestBackendWebhookEndpointAuthorityV1(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendWebhookEndpointAuthorityV1(value))
}

function webhookPath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('$.path must be a string')
  return canonicalPath(value)
}

function timestampSeconds(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    Number(value) < 0 ||
    Number(value) > 253_402_300_799
  ) {
    throw new TypeError('$.timestampUnixSeconds must be a bounded non-negative integer')
  }
  return Number(value)
}

export function parseBackendWebhookRawBodySubjectV1(
  value: unknown
): BackendWebhookRawBodySubjectV1 {
  const source = exactRecord(value, '$', RAW_BODY_SUBJECT_FIELDS)
  if (source.format !== BACKEND_WEBHOOK_RAW_BODY_SUBJECT_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_WEBHOOK_SECURITY_VERSION || source.method !== 'POST') {
    throw new TypeError('Webhook raw-body subject contract is not supported')
  }
  const idempotencyKey = releaseIdentifier(
    typeof source.idempotencyKey === 'string' ? source.idempotencyKey : '',
    '$.idempotencyKey'
  )
  if (typeof source.rawBodySha256 !== 'string' || !LOWER_HEX_SHA256.test(source.rawBodySha256)) {
    throw new TypeError('$.rawBodySha256 must be a lowercase hexadecimal SHA-256 digest')
  }
  return Object.freeze({
    format: BACKEND_WEBHOOK_RAW_BODY_SUBJECT_FORMAT,
    version: BACKEND_WEBHOOK_SECURITY_VERSION,
    method: 'POST',
    path: webhookPath(source.path),
    timestampUnixSeconds: timestampSeconds(source.timestampUnixSeconds),
    idempotencyKey,
    rawBodySha256: source.rawBodySha256
  })
}

/** Exact `raw-body-v1` bytes; the Host supplies the HMAC key and constant-time verification. */
export function canonicalBackendWebhookRawBodyHmacBytes(value: unknown): Uint8Array {
  const subject = parseBackendWebhookRawBodySubjectV1(value)
  return new TextEncoder().encode(
    [
      'raw-body-v1',
      subject.method,
      subject.path,
      String(subject.timestampUnixSeconds),
      subject.idempotencyKey,
      subject.rawBodySha256
    ].join('\n')
  )
}
