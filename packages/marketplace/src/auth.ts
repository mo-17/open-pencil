import { createHash } from 'node:crypto'

import { parsePluginTrustTimestamp } from '@open-pencil/core/plugins'
import { validateModuleIdentity, webCryptoBuffer } from '@open-pencil/scene-graph'

export const MARKETPLACE_REQUEST_AUTH_VERSION = 1 as const
export const MARKETPLACE_REQUEST_AUTH_LIMITS = Object.freeze({
  maxBodyBytes: 4 * 1024 * 1024,
  maxClockSkewMs: 5 * 60 * 1_000,
  maxNonceLength: 128,
  maxSignatureLength: 128
})

export interface MarketplaceSignedRequestHeaders {
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
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MARKETPLACE_REQUEST_AUTH_LIMITS.maxSignatureLength ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError(`${path} must be base64url without padding`)
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(Buffer.from(value, 'base64url'))
  } catch {
    throw new TypeError(`${path} must be valid base64url`)
  }
  if (Buffer.from(bytes).toString('base64url') !== value) {
    throw new TypeError(`${path} must use canonical base64url encoding`)
  }
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    throw new TypeError(`${path} must decode to ${expectedLength} bytes`)
  }
  return bytes
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

export function canonicalMarketplaceRequest(input: {
  method: string
  url: string
  timestamp: string
  nonce: string
  body: Uint8Array
}): string {
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
    method,
    requestTarget(input.url),
    timestamp,
    input.nonce,
    digestMarketplaceRequestBody(input.body)
  ].join('\n')
}

export async function signMarketplaceRequest(
  input: {
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
  const canonical = canonicalMarketplaceRequest(input)
  const signature = Buffer.from(
    await crypto.subtle.sign('Ed25519', privateKey, encoder.encode(canonical))
  ).toString('base64url')
  return { publisherId, keyId, timestamp: input.timestamp, nonce: input.nonce, signature }
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
  const publisherId = identity(input.headers.publisherId, 'marketplace request publisher id')
  const keyId = identity(input.headers.keyId, 'marketplace request key id')
  const canonical = canonicalMarketplaceRequest({
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
