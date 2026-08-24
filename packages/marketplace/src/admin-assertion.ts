import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { MarketplaceNonceStore } from './auth'
import { canonicalBase64URLBytes } from './canonical-base64url'
import {
  parseMarketplaceOperatorAuthorization,
  type MarketplaceOperatorAuthorizationV2
} from './operator-authorization'
import { parseMarketplaceAuditActor, parseMarketplaceTimestamp } from './types'

export const MARKETPLACE_ADMIN_ASSERTION_VERSION = 1 as const
export const MARKETPLACE_OPERATOR_ASSERTION_VERSION = 2 as const
export const MARKETPLACE_ADMIN_ASSERTION_HEADER = 'x-openpencil-admin-assertion' as const
export const MARKETPLACE_ADMIN_ASSERTION_AUDIENCE = 'openpencil-marketplace-admin' as const
export const MARKETPLACE_ADMIN_ASSERTION_LIMITS = Object.freeze({
  maxBodyBytes: 4 * 1024 * 1024,
  maxClockSkewMs: 60_000,
  maxHeaderBytes: 4 * 1024,
  maxTokenLength: 512,
  minTokenLength: 32,
  maxIdentifierLength: 128,
  minIdentifierLength: 16,
  maxNonceLength: 128,
  minNonceLength: 16
})

export interface MarketplaceAdminAssertionInput {
  actor: string
  requestId: string
  correlationId: string
  method: string
  url: string
  timestamp: string
  nonce: string
  body: Uint8Array
  audience?: string
}

export interface MarketplaceOperatorAssertionInput extends MarketplaceAdminAssertionInput {
  authorization: MarketplaceOperatorAuthorizationV2
}

export interface MarketplaceAdminAssertionPrincipal {
  actor: string
  requestId: string
  correlationId: string
  expiresAt: number
  authorization?: MarketplaceOperatorAuthorizationV2
  assertionTimestamp?: string
}

export interface VerifyMarketplaceAdminAssertionOptions {
  token: string
  nonces: MarketplaceNonceStore
  audience?: string
  now?: () => number
}

interface MarketplaceAdminAssertionClaims {
  version: typeof MARKETPLACE_ADMIN_ASSERTION_VERSION
  audience: string
  actor: string
  requestId: string
  correlationId: string
  method: string
  target: string
  timestamp: string
  nonce: string
  bodyDigest: string
}

interface MarketplaceOperatorAssertionClaims {
  version: typeof MARKETPLACE_OPERATOR_ASSERTION_VERSION
  audience: string
  actor: string
  requestId: string
  correlationId: string
  authorization: MarketplaceOperatorAuthorizationV2
  method: string
  target: string
  timestamp: string
  nonce: string
  bodyDigest: string
}

interface MarketplaceAdminAssertionSource {
  version?: unknown
  audience?: unknown
  actor?: unknown
  requestId?: unknown
  correlationId?: unknown
  method?: unknown
  target?: unknown
  timestamp?: unknown
  nonce?: unknown
  bodyDigest?: unknown
  authorization?: unknown
}

const ASSERTION_PREFIX =
  `OPENPENCIL-MARKETPLACE-ADMIN-ASSERTION-V${MARKETPLACE_ADMIN_ASSERTION_VERSION}` as const
const ASSERTION_NONCE_NAMESPACE = 'admin-assertion-v1'
const OPERATOR_ASSERTION_PREFIX =
  `OPENPENCIL-MARKETPLACE-ADMIN-ASSERTION-V${MARKETPLACE_OPERATOR_ASSERTION_VERSION}` as const
const OPERATOR_ASSERTION_NONCE_NAMESPACE = 'admin-assertion-v2'
const ASSERTION_KEYS = Object.freeze([
  'version',
  'audience',
  'actor',
  'requestId',
  'correlationId',
  'method',
  'target',
  'timestamp',
  'nonce',
  'bodyDigest'
] as const)
const OPERATOR_ASSERTION_KEYS = Object.freeze([
  'version',
  'audience',
  'actor',
  'requestId',
  'correlationId',
  'authorization',
  'method',
  'target',
  'timestamp',
  'nonce',
  'bodyDigest'
] as const)
const BOUNDED_ID = /^[A-Za-z0-9_-]{16,128}$/
const OPERATOR_ACTOR = /^portal:[A-Za-z0-9_-]{43}$/
const encoder = new TextEncoder()

function token(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < MARKETPLACE_ADMIN_ASSERTION_LIMITS.minTokenLength ||
    value.length > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxTokenLength
  ) {
    throw new TypeError(
      'Marketplace admin assertion token must contain between 32 and 512 characters'
    )
  }
  return value
}

function boundedIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !BOUNDED_ID.test(value)) {
    throw new TypeError(`${path} must be bounded base64url identifier text`)
  }
  return value
}

function nonce(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < MARKETPLACE_ADMIN_ASSERTION_LIMITS.minNonceLength ||
    value.length > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxNonceLength ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError('Marketplace admin assertion nonce must be bounded base64url text')
  }
  return value
}

function method(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]+$/.test(value)) {
    throw new TypeError('Marketplace admin assertion method must be exact upper-case HTTP text')
  }
  return value
}

function audience(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new TypeError('Marketplace admin assertion audience must be bounded service text')
  }
  return value
}

function requestTarget(urlValue: string): string {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    throw new TypeError('Marketplace admin assertion URL must be absolute')
  }
  if (url.hash) throw new TypeError('Marketplace admin assertion URL must not contain a fragment')
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) {
    throw new TypeError('Marketplace admin assertions are restricted to admin paths')
  }
  return `${url.pathname}${url.search}`
}

function assertionTarget(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new TypeError('Marketplace admin assertion target must be bounded text')
  }
  const parsed = requestTarget(`http://assertion.invalid${value}`)
  if (parsed !== value) {
    throw new TypeError('Marketplace admin assertion target must be canonical pathname and query')
  }
  return value
}

function base64URLBytes(value: string, path: string, expectedLength?: number): Uint8Array {
  return canonicalBase64URLBytes(value, path, { expectedLength })
}

function bodyDigest(body: Uint8Array): string {
  if (!(body instanceof Uint8Array)) {
    throw new TypeError('Marketplace admin assertion body must be bytes')
  }
  if (body.byteLength > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxBodyBytes) {
    throw new TypeError('Marketplace admin assertion body exceeds the byte limit')
  }
  return createHash('sha256').update(body).digest('base64url')
}

function parseBodyDigest(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Marketplace admin assertion body digest must be base64url text')
  }
  base64URLBytes(value, 'Marketplace admin assertion body digest', 32)
  return value
}

function canonicalClaims(claims: MarketplaceAdminAssertionClaims): string {
  return JSON.stringify({
    version: claims.version,
    audience: claims.audience,
    actor: claims.actor,
    requestId: claims.requestId,
    correlationId: claims.correlationId,
    method: claims.method,
    target: claims.target,
    timestamp: claims.timestamp,
    nonce: claims.nonce,
    bodyDigest: claims.bodyDigest
  })
}

function canonicalOperatorClaims(claims: MarketplaceOperatorAssertionClaims): string {
  return JSON.stringify({
    version: claims.version,
    audience: claims.audience,
    actor: claims.actor,
    requestId: claims.requestId,
    correlationId: claims.correlationId,
    authorization: claims.authorization,
    method: claims.method,
    target: claims.target,
    timestamp: claims.timestamp,
    nonce: claims.nonce,
    bodyDigest: claims.bodyDigest
  })
}

function assertionSource(value: unknown): MarketplaceAdminAssertionSource {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Marketplace admin assertion payload must be an object')
  }
  return value
}

function createClaims(input: MarketplaceAdminAssertionInput): MarketplaceAdminAssertionClaims {
  return Object.freeze({
    version: MARKETPLACE_ADMIN_ASSERTION_VERSION,
    audience: audience(input.audience ?? MARKETPLACE_ADMIN_ASSERTION_AUDIENCE),
    actor: parseMarketplaceAuditActor(input.actor, 'Marketplace admin assertion actor'),
    requestId: boundedIdentifier(input.requestId, 'Marketplace admin assertion requestId'),
    correlationId: boundedIdentifier(
      input.correlationId,
      'Marketplace admin assertion correlationId'
    ),
    method: method(input.method),
    target: requestTarget(input.url),
    timestamp: parseMarketplaceTimestamp(input.timestamp, 'Marketplace admin assertion timestamp'),
    nonce: nonce(input.nonce),
    bodyDigest: bodyDigest(input.body)
  })
}

function operatorActor(value: unknown): string {
  const actor = parseMarketplaceAuditActor(value, 'Marketplace operator assertion actor')
  if (!OPERATOR_ACTOR.test(actor)) {
    throw new TypeError('Marketplace operator assertion actor must use a portal SHA-256 pseudonym')
  }
  return actor
}

function createOperatorClaims(
  input: MarketplaceOperatorAssertionInput
): MarketplaceOperatorAssertionClaims {
  return Object.freeze({
    version: MARKETPLACE_OPERATOR_ASSERTION_VERSION,
    audience: audience(input.audience ?? MARKETPLACE_ADMIN_ASSERTION_AUDIENCE),
    actor: operatorActor(input.actor),
    requestId: boundedIdentifier(input.requestId, 'Marketplace operator assertion requestId'),
    correlationId: boundedIdentifier(
      input.correlationId,
      'Marketplace operator assertion correlationId'
    ),
    authorization: parseMarketplaceOperatorAuthorization(input.authorization),
    method: method(input.method),
    target: requestTarget(input.url),
    timestamp: parseMarketplaceTimestamp(
      input.timestamp,
      'Marketplace operator assertion timestamp'
    ),
    nonce: nonce(input.nonce),
    bodyDigest: bodyDigest(input.body)
  })
}

function parseClaims(value: unknown): MarketplaceAdminAssertionClaims {
  const source = assertionSource(value)
  const keys = Object.keys(source)
  if (
    keys.length !== ASSERTION_KEYS.length ||
    keys.some((key, index) => key !== ASSERTION_KEYS[index])
  ) {
    throw new TypeError('Marketplace admin assertion payload fields are not canonical')
  }
  if (source.version !== MARKETPLACE_ADMIN_ASSERTION_VERSION) {
    throw new TypeError('Marketplace admin assertion version is not supported')
  }
  return Object.freeze({
    version: MARKETPLACE_ADMIN_ASSERTION_VERSION,
    audience: audience(source.audience),
    actor: parseMarketplaceAuditActor(source.actor, 'Marketplace admin assertion actor'),
    requestId: boundedIdentifier(source.requestId, 'Marketplace admin assertion requestId'),
    correlationId: boundedIdentifier(
      source.correlationId,
      'Marketplace admin assertion correlationId'
    ),
    method: method(source.method),
    target: assertionTarget(source.target),
    timestamp: parseMarketplaceTimestamp(source.timestamp, 'Marketplace admin assertion timestamp'),
    nonce: nonce(source.nonce),
    bodyDigest: parseBodyDigest(source.bodyDigest)
  })
}

function parseOperatorClaims(value: unknown): MarketplaceOperatorAssertionClaims {
  const source = assertionSource(value)
  const keys = Object.keys(source)
  if (
    keys.length !== OPERATOR_ASSERTION_KEYS.length ||
    keys.some((key, index) => key !== OPERATOR_ASSERTION_KEYS[index])
  ) {
    throw new TypeError('Marketplace operator assertion payload fields are not canonical')
  }
  if (source.version !== MARKETPLACE_OPERATOR_ASSERTION_VERSION) {
    throw new TypeError('Marketplace operator assertion version is not supported')
  }
  return Object.freeze({
    version: MARKETPLACE_OPERATOR_ASSERTION_VERSION,
    audience: audience(source.audience),
    actor: operatorActor(source.actor),
    requestId: boundedIdentifier(source.requestId, 'Marketplace operator assertion requestId'),
    correlationId: boundedIdentifier(
      source.correlationId,
      'Marketplace operator assertion correlationId'
    ),
    authorization: parseMarketplaceOperatorAuthorization(source.authorization),
    method: method(source.method),
    target: assertionTarget(source.target),
    timestamp: parseMarketplaceTimestamp(
      source.timestamp,
      'Marketplace operator assertion timestamp'
    ),
    nonce: nonce(source.nonce),
    bodyDigest: parseBodyDigest(source.bodyDigest)
  })
}

function mac(payload: string, secret: string, prefix: string = ASSERTION_PREFIX): Uint8Array {
  return new Uint8Array(
    createHmac('sha256', encoder.encode(token(secret)))
      .update(`${prefix}\n${payload}`)
      .digest()
  )
}

/**
 * Produces the server-to-server V1 assertion header. The raw admin token is an
 * HMAC key only and must never be placed in this header or sent to a browser.
 */
export function signMarketplaceAdminAssertion(
  input: MarketplaceAdminAssertionInput,
  secret: string
): string {
  const payload = Buffer.from(canonicalClaims(createClaims(input)), 'utf8').toString('base64url')
  return `v${MARKETPLACE_ADMIN_ASSERTION_VERSION}.${payload}.${Buffer.from(
    mac(payload, secret)
  ).toString('base64url')}`
}

/**
 * Produces the server-to-server V2 operator assertion. Authorization evidence
 * is canonical and MAC-bound; the HMAC key remains server-only.
 */
export function signMarketplaceOperatorAssertion(
  input: MarketplaceOperatorAssertionInput,
  secret: string
): string {
  const payload = Buffer.from(
    canonicalOperatorClaims(createOperatorClaims(input)),
    'utf8'
  ).toString('base64url')
  return `v${MARKETPLACE_OPERATOR_ASSERTION_VERSION}.${payload}.${Buffer.from(
    mac(payload, secret, OPERATOR_ASSERTION_PREFIX)
  ).toString('base64url')}`
}

type ParsedMarketplaceAdminAssertion =
  | { readonly operator: false; readonly claims: MarketplaceAdminAssertionClaims }
  | { readonly operator: true; readonly claims: MarketplaceOperatorAssertionClaims }

function decodedAssertionValue(payload: string): unknown {
  let payloadText: string
  try {
    payloadText = new TextDecoder('utf-8', { fatal: true }).decode(
      base64URLBytes(payload, 'Marketplace admin assertion payload')
    )
  } catch {
    throw new TypeError('Marketplace admin assertion payload is invalid')
  }
  try {
    return JSON.parse(payloadText)
  } catch {
    throw new TypeError('Marketplace admin assertion payload must contain valid JSON')
  }
}

function parsedAssertion(assertion: string, secret: string): ParsedMarketplaceAdminAssertion {
  if (
    typeof assertion !== 'string' ||
    encoder.encode(assertion).byteLength > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxHeaderBytes
  ) {
    throw new TypeError('Marketplace admin assertion header is invalid')
  }
  const segments = assertion.split('.')
  if (
    segments.length !== 3 ||
    (segments[0] !== `v${MARKETPLACE_ADMIN_ASSERTION_VERSION}` &&
      segments[0] !== `v${MARKETPLACE_OPERATOR_ASSERTION_VERSION}`)
  ) {
    throw new TypeError('Marketplace admin assertion header version is not supported')
  }
  const [versionSegment, payload, signatureValue] = segments
  const operator = versionSegment === `v${MARKETPLACE_OPERATOR_ASSERTION_VERSION}`
  const signature = base64URLBytes(signatureValue, 'Marketplace admin assertion signature', 32)
  const expected = mac(payload, secret, operator ? OPERATOR_ASSERTION_PREFIX : ASSERTION_PREFIX)
  if (signature.byteLength !== expected.byteLength || !timingSafeEqual(signature, expected)) {
    throw new Error('Marketplace admin assertion signature is invalid')
  }
  const value = decodedAssertionValue(payload)
  if (operator) {
    const claims = parseOperatorClaims(value)
    if (Buffer.from(canonicalOperatorClaims(claims), 'utf8').toString('base64url') !== payload) {
      throw new TypeError('Marketplace admin assertion payload is not canonical')
    }
    return Object.freeze({ operator: true, claims })
  }
  const claims = parseClaims(value)
  if (Buffer.from(canonicalClaims(claims), 'utf8').toString('base64url') !== payload) {
    throw new TypeError('Marketplace admin assertion payload is not canonical')
  }
  return Object.freeze({ operator: false, claims })
}

function assertionExpiry(
  claims: MarketplaceAdminAssertionClaims | MarketplaceOperatorAssertionClaims,
  input: { method: string; url: string; body: Uint8Array },
  options: VerifyMarketplaceAdminAssertionOptions
): number {
  if (claims.audience !== (options.audience ?? MARKETPLACE_ADMIN_ASSERTION_AUDIENCE)) {
    throw new Error('Marketplace admin assertion audience does not match')
  }
  if (claims.method !== method(input.method)) {
    throw new Error('Marketplace admin assertion method does not match')
  }
  if (claims.target !== requestTarget(input.url)) {
    throw new Error('Marketplace admin assertion target does not match')
  }
  if (claims.bodyDigest !== bodyDigest(input.body)) {
    throw new Error('Marketplace admin assertion body does not match')
  }
  const now = (options.now ?? Date.now)()
  const signedAt = Date.parse(claims.timestamp)
  if (
    !Number.isSafeInteger(now) ||
    Math.abs(now - signedAt) > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxClockSkewMs
  ) {
    throw new Error('Marketplace admin assertion timestamp is outside the allowed clock window')
  }
  return signedAt + MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxClockSkewMs
}

export async function verifyMarketplaceAdminAssertion(
  input: { assertion: string; method: string; url: string; body: Uint8Array },
  options: VerifyMarketplaceAdminAssertionOptions
): Promise<MarketplaceAdminAssertionPrincipal> {
  const parsed = parsedAssertion(input.assertion, options.token)
  const expiresAt = assertionExpiry(parsed.claims, input, options)
  if (
    !(await options.nonces.consume(
      parsed.operator ? OPERATOR_ASSERTION_NONCE_NAMESPACE : ASSERTION_NONCE_NAMESPACE,
      parsed.claims.nonce,
      expiresAt
    ))
  ) {
    throw new Error('Marketplace admin assertion nonce has already been used')
  }
  const principal: MarketplaceAdminAssertionPrincipal = {
    actor: parsed.claims.actor,
    requestId: parsed.claims.requestId,
    correlationId: parsed.claims.correlationId,
    expiresAt
  }
  if (parsed.operator) {
    principal.authorization = parsed.claims.authorization
    principal.assertionTimestamp = parsed.claims.timestamp
  }
  return Object.freeze(principal)
}
