import { createHash } from 'node:crypto'

import { parsePluginTrustTimestamp } from '@open-pencil/plugin-contracts'
import { validateModuleIdentity, webCryptoBuffer } from '@open-pencil/scene-graph'

import { canonicalBase64URLBytes } from './canonical-base64url'

export const MARKETPLACE_REQUEST_AUTH_VERSION = 2 as const
export const MARKETPLACE_REQUEST_AUTH_LIMITS = Object.freeze({
  maxBodyBytes: 4 * 1024 * 1024,
  maxClockSkewMs: 5 * 60 * 1_000,
  maxNonceLength: 128,
  maxSignatureLength: 128
})

export interface MarketplaceSignedRequestHeaders {
  audience: string
  publisherId: string
  keyId: string
  timestamp: string
  nonce: string
  signature: string
}

export interface MarketplaceNonceStore {
  consume(publisherId: string, nonce: string, expiresAt: number): Promise<boolean>
}

export interface VerifyMarketplaceRequestOptions {
  audience: string
  now?: () => number
  resolvePublicKey(publisherId: string, keyId: string): Promise<CryptoKey | null>
  nonces: MarketplaceNonceStore
}

const REQUEST_PREFIX = `OPENPENCIL-MARKETPLACE-REQUEST-V${MARKETPLACE_REQUEST_AUTH_VERSION}`
const encoder = new TextEncoder()

function identity(value: string, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value
}

function base64URLBytes(value: string, path: string, expectedLength?: number): Uint8Array {
  return canonicalBase64URLBytes(value, path, {
    expectedLength,
    maxEncodedLength: MARKETPLACE_REQUEST_AUTH_LIMITS.maxSignatureLength
  })
}

function requestTarget(urlValue: string): string {
  const url = new URL(urlValue)
  if (url.hash) throw new TypeError('Signed marketplace request URL must not contain a fragment')
  return `${url.pathname}${url.search}`
}

export function digestMarketplaceRequestBody(body: Uint8Array): string {
  if (body.byteLength > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes) {
    throw new TypeError('Marketplace request body exceeds the byte limit')
  }
  return createHash('sha256').update(body).digest('base64url')
}

/**
 * V2 signs these exact UTF-8 lines in order: protocol prefix, deployment-stable
 * marketplace audience, publisher id, key id, upper-case method, pathname plus
 * raw query, canonical timestamp, nonce, and the base64url SHA-256 digest of the
 * unmodified body bytes.
 */
export function canonicalMarketplaceRequest(input: {
  audience: string
  publisherId: string
  keyId: string
  method: string
  url: string
  timestamp: string
  nonce: string
  body: Uint8Array
}): string {
  const audience = identity(input.audience, 'marketplace request audience')
  const publisherId = identity(input.publisherId, 'marketplace request publisher id')
  const keyId = identity(input.keyId, 'marketplace request key id')
  const method = input.method.toUpperCase()
  if (!/^[A-Z]+$/.test(method)) throw new TypeError('Marketplace request method is invalid')
  const timestamp = parsePluginTrustTimestamp(input.timestamp, 'marketplace request timestamp')
  if (
    typeof input.nonce !== 'string' ||
    input.nonce.length < 16 ||
    input.nonce.length > MARKETPLACE_REQUEST_AUTH_LIMITS.maxNonceLength ||
    !/^[A-Za-z0-9_-]+$/.test(input.nonce)
  ) {
    throw new TypeError('Marketplace request nonce must be bounded base64url text')
  }
  return [
    REQUEST_PREFIX,
    audience,
    publisherId,
    keyId,
    method,
    requestTarget(input.url),
    timestamp,
    input.nonce,
    digestMarketplaceRequestBody(input.body)
  ].join('\n')
}

export async function signMarketplaceRequest(
  input: {
    audience: string
    publisherId: string
    keyId: string
    method: string
    url: string
    timestamp: string
    nonce: string
    body: Uint8Array
  },
  privateKey: CryptoKey
): Promise<MarketplaceSignedRequestHeaders> {
  if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'Ed25519') {
    throw new TypeError('Marketplace request signing requires an Ed25519 private key')
  }
  const publisherId = identity(input.publisherId, 'marketplace request publisher id')
  const keyId = identity(input.keyId, 'marketplace request key id')
  const audience = identity(input.audience, 'marketplace request audience')
  const canonical = canonicalMarketplaceRequest({ ...input, audience, publisherId, keyId })
  const signature = Buffer.from(
    await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(canonical))
  ).toString('base64url')
  return { audience, publisherId, keyId, timestamp: input.timestamp, nonce: input.nonce, signature }
}

export async function verifyMarketplaceRequest(
  input: {
    method: string
    url: string
    body: Uint8Array
    headers: MarketplaceSignedRequestHeaders
  },
  options: VerifyMarketplaceRequestOptions
): Promise<{ publisherId: string; keyId: string }> {
  const audience = identity(input.headers.audience, 'marketplace request audience')
  const expectedAudience = identity(options.audience, 'expected marketplace request audience')
  if (audience !== expectedAudience) {
    throw new Error('Marketplace request audience does not match')
  }
  const publisherId = identity(input.headers.publisherId, 'marketplace request publisher id')
  const keyId = identity(input.headers.keyId, 'marketplace request key id')
  const canonical = canonicalMarketplaceRequest({
    audience,
    publisherId,
    keyId,
    method: input.method,
    url: input.url,
    timestamp: input.headers.timestamp,
    nonce: input.headers.nonce,
    body: input.body
  })
  const now = (options.now ?? Date.now)()
  const signedAt = Date.parse(input.headers.timestamp)
  if (
    !Number.isSafeInteger(now) ||
    Math.abs(now - signedAt) > MARKETPLACE_REQUEST_AUTH_LIMITS.maxClockSkewMs
  ) {
    throw new Error('Marketplace request timestamp is outside the allowed clock window')
  }
  const publicKey = await options.resolvePublicKey(publisherId, keyId)
  if (publicKey?.type !== 'public' || publicKey.algorithm.name !== 'Ed25519') {
    throw new Error('Marketplace publisher key is not active')
  }
  const signature = base64URLBytes(input.headers.signature, 'marketplace request signature', 64)
  if (
    !(await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      webCryptoBuffer(signature),
      webCryptoBuffer(encoder.encode(canonical))
    ))
  ) {
    throw new Error('Marketplace request signature is invalid')
  }
  const expiresAt = signedAt + MARKETPLACE_REQUEST_AUTH_LIMITS.maxClockSkewMs
  if (!(await options.nonces.consume(publisherId, input.headers.nonce, expiresAt))) {
    throw new Error('Marketplace request nonce has already been used')
  }
  return { publisherId, keyId }
}

export function createMemoryMarketplaceNonceStore(
  now: () => number = Date.now
): MarketplaceNonceStore {
  const entries = new Map<string, number>()
  return {
    async consume(publisherId, nonce, expiresAt) {
      const current = now()
      for (const [key, expiry] of entries) if (expiry < current) entries.delete(key)
      const key = `${publisherId}:${nonce}`
      if (entries.has(key)) return false
      entries.set(key, expiresAt)
      return true
    }
  }
}
