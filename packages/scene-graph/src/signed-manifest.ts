export interface StableSemver {
  major: number
  minor: number
  patch: number
}

export type SignedManifestInvalid = (path: string, message: string) => never

export interface StableEngineRangeOptions {
  maxLength?: number
  invalid?: SignedManifestInvalid
}

export interface SignedManifestSignature {
  algorithm: 'Ed25519'
  keyId: string
  value: string
}

export interface SignedManifestIntegrity {
  algorithm: 'SHA-256'
  digest: string
  signature: SignedManifestSignature
}

export interface SignedManifestVerificationPolicy {
  engineVersion?: string
  expectedKeyId?: string
}

export interface SignedManifestPolicyContext {
  engineRange: string
  label: string
  engineLabel?: string
  invalid?: SignedManifestInvalid
  maxEngineRangeLength?: number
}

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const STABLE_COMPARATOR = /^(?:\^|~|>=|<=|>|<|=)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const BASE64URL = /^[A-Za-z0-9_-]+$/
const SHA_256_BASE64URL = /^[A-Za-z0-9_-]{43}$/
const ED25519_BASE64URL = /^[A-Za-z0-9_-]{86}$/
const DEFAULT_ENGINE_RANGE_LENGTH = 128
const ED25519_KEY_MAX_BYTES = 32_768

function defaultInvalid(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`)
}

export function parseExactManifestRecord(
  value: unknown,
  path: string,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string> = allowedKeys
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain JSON object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain JSON object`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError(`${path} must not contain symbol keys`)
  }
  if (keys.some((key) => !allowedKeys.has(key as string))) {
    throw new TypeError(`${path} contains unsupported fields`)
  }
  for (const key of requiredKeys) {
    if (!keys.includes(key)) throw new TypeError(`${path}.${key} is required`)
  }
  const parsed: Record<string, unknown> = Object.create(null)
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}.${key} must be an enumerable data property`)
    }
    parsed[key] = descriptor.value
  }
  return Object.freeze(parsed)
}

export function parseBoundedManifestArray(
  value: unknown,
  path: string,
  maximum: number
): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`)
  if (value.length > maximum) {
    throw new TypeError(`${path} may not contain more than ${maximum} entries`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== value.length + 1 ||
    keys.some((key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))
  ) {
    throw new TypeError(`${path} must be a dense JSON array without custom properties`)
  }
  const parsed = Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${path}[${index}] must be an enumerable data property`)
    }
    return descriptor.value
  })
  return Object.freeze(parsed)
}

export function parseStableSemver(
  value: unknown,
  path = 'version',
  invalid: SignedManifestInvalid = defaultInvalid
): string {
  if (typeof value !== 'string' || !STABLE_SEMVER.test(value)) {
    return invalid(path, 'Expected a stable semantic version (major.minor.patch)')
  }
  stableSemverParts(value, path, invalid)
  return value
}

export function stableSemverParts(
  value: string,
  path = 'version',
  invalid: SignedManifestInvalid = defaultInvalid
): StableSemver {
  const match = STABLE_SEMVER.exec(value)
  if (!match) return invalid(path, 'Expected a stable semantic version')
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  if (!parts.every(Number.isSafeInteger)) {
    return invalid(path, 'Semantic version components must be safe non-negative integers')
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] }
}

export function compareStableSemver(left: StableSemver, right: StableSemver): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

export function normalizeStableEngineRange(
  value: unknown,
  path = 'engineRange',
  options: StableEngineRangeOptions = {}
): string {
  const invalid = options.invalid ?? defaultInvalid
  const maxLength = options.maxLength ?? DEFAULT_ENGINE_RANGE_LENGTH
  if (typeof value !== 'string' || value.length > maxLength) {
    return invalid(path, 'Expected a bounded engine version range')
  }
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized === '*') return normalized
  const comparators = normalized.split(' ')
  if (
    comparators.length < 1 ||
    comparators.length > 2 ||
    !comparators.every((comparator) => STABLE_COMPARATOR.test(comparator))
  ) {
    return invalid(path, 'Expected *, exact, ^/~, or one/two semantic-version comparators')
  }
  return normalized
}

function comparatorMatches(
  version: StableSemver,
  comparator: string,
  invalid: SignedManifestInvalid
): boolean {
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(comparator)
  if (!match) return false
  const operator = match[1] ?? '='
  const target = stableSemverParts(match[2], 'version', invalid)
  const compared = compareStableSemver(version, target)
  if (operator === '=') return compared === 0
  if (operator === '>=') return compared >= 0
  if (operator === '<=') return compared <= 0
  if (operator === '>') return compared > 0
  if (operator === '<') return compared < 0
  if (operator === '^') {
    let upper: StableSemver
    if (target.major > 0) upper = { major: target.major + 1, minor: 0, patch: 0 }
    else if (target.minor > 0) upper = { major: 0, minor: target.minor + 1, patch: 0 }
    else upper = { major: 0, minor: 0, patch: target.patch + 1 }
    return compared >= 0 && compareStableSemver(version, upper) < 0
  }
  const upper = { major: target.major, minor: target.minor + 1, patch: 0 }
  return compared >= 0 && compareStableSemver(version, upper) < 0
}

export function satisfiesStableEngineRange(
  version: string,
  range: string,
  options: StableEngineRangeOptions = {}
): boolean {
  const invalid = options.invalid ?? defaultInvalid
  const parsedVersion = stableSemverParts(
    parseStableSemver(version, 'version', invalid),
    'version',
    invalid
  )
  const parsedRange = normalizeStableEngineRange(range, 'engineRange', options)
  return parsedRange === '*'
    ? true
    : parsedRange
        .split(' ')
        .every((comparator) => comparatorMatches(parsedVersion, comparator, invalid))
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function canonicalManifestValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Manifest value must not contain cycles')
    seen.add(value)
    const canonical = value.map((entry) => canonicalManifestValue(entry, seen))
    seen.delete(value)
    return canonical
  }
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) throw new TypeError('Manifest value must not contain cycles')
  seen.add(value)
  const canonical = Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => compareCanonicalKeys(left, right))
      .map(([key, nested]) => [key, canonicalManifestValue(nested, seen)])
  )
  seen.delete(value)
  return canonical
}

export function canonicalManifestJson(value: unknown): string {
  return JSON.stringify(canonicalManifestValue(value))
}

export function canonicalManifestBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalManifestJson(value))
}

export function signedManifestBytes(payload: unknown, digest: string): Uint8Array {
  return canonicalManifestBytes({ payload, algorithm: 'SHA-256', digest })
}

export function webCryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL.test(value)) throw new TypeError('Expected non-empty base64url data')
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new TypeError('Expected valid base64url data')
  }
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (encodeBase64Url(decoded) !== value) throw new TypeError('Expected canonical base64url data')
  return decoded
}

export function parseSha256Base64Url(value: unknown, path = 'digest'): string {
  if (typeof value !== 'string' || !SHA_256_BASE64URL.test(value)) {
    throw new TypeError(`${path} must be a SHA-256 base64url digest`)
  }
  if (decodeBase64Url(value).byteLength !== 32) {
    throw new TypeError(`${path} must encode a 32-byte SHA-256 digest`)
  }
  return value
}

export function parseSignedManifestIntegrity(
  value: unknown,
  path = 'manifest.integrity',
  expectedKeyId?: string
): SignedManifestIntegrity {
  const source = parseExactManifestRecord(
    value,
    path,
    new Set(['algorithm', 'digest', 'signature'])
  )
  if (source.algorithm !== 'SHA-256') {
    throw new TypeError(`${path}.algorithm must be SHA-256`)
  }
  const digest = parseSha256Base64Url(source.digest, `${path}.digest`)
  const signaturePath = `${path}.signature`
  const signature = parseExactManifestRecord(
    source.signature,
    signaturePath,
    new Set(['algorithm', 'keyId', 'value'])
  )
  if (signature.algorithm !== 'Ed25519') {
    throw new TypeError(`${signaturePath}.algorithm must be Ed25519`)
  }
  const keyReason = validateModuleIdentity(signature.keyId, `${signaturePath}.keyId`)
  if (keyReason) throw new TypeError(keyReason)
  const keyId = signature.keyId as string
  if (expectedKeyId && keyId !== expectedKeyId) {
    throw new TypeError(`${signaturePath}.keyId does not match the expected key`)
  }
  if (typeof signature.value !== 'string' || !ED25519_BASE64URL.test(signature.value)) {
    throw new TypeError(`${signaturePath}.value must be an Ed25519 base64url signature`)
  }
  if (decodeBase64Url(signature.value).byteLength !== 64) {
    throw new TypeError(`${signaturePath}.value must encode a 64-byte Ed25519 signature`)
  }
  return {
    algorithm: 'SHA-256',
    digest,
    signature: { algorithm: 'Ed25519', keyId, value: signature.value }
  }
}

export async function digestCanonicalManifest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    webCryptoBuffer(canonicalManifestBytes(value))
  )
  return encodeBase64Url(new Uint8Array(digest))
}

export function assertEd25519PrivateKey(privateKey: CryptoKey): void {
  if (privateKey.type !== 'private' || privateKey.algorithm.name !== 'Ed25519') {
    throw new TypeError('Expected an Ed25519 private CryptoKey')
  }
}

export function assertEd25519PublicKey(publicKey: CryptoKey): void {
  if (publicKey.type !== 'public' || publicKey.algorithm.name !== 'Ed25519') {
    throw new TypeError('Expected an Ed25519 public CryptoKey')
  }
}

function boundedPemText(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength > ED25519_KEY_MAX_BYTES
  ) {
    throw new TypeError(`${label} must be bounded PEM text`)
  }
  return value
}

function pemBuffer(value: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): ArrayBuffer {
  const text = boundedPemText(value, label)
  const match = text.match(
    new RegExp(
      `^\\s*-----BEGIN ${label}-----\\s*([A-Za-z0-9+/=\\s]+?)\\s*-----END ${label}-----\\s*$`
    )
  )
  if (!match) throw new TypeError(`Expected ${label} PEM data`)
  const encoded = match[1].replaceAll(/\s/g, '')
  let binary: string
  try {
    binary = atob(encoded)
  } catch (cause) {
    throw new TypeError(`Invalid ${label} PEM encoding`, { cause })
  }
  if (btoa(binary) !== encoded) throw new TypeError(`Expected canonical ${label} PEM encoding`)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return webCryptoBuffer(bytes)
}

function publicKeyPem(value: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  const lines =
    btoa(binary)
      .match(/.{1,64}/g)
      ?.join('\n') ?? ''
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`
}

export async function importEd25519PrivateKeyPem(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemBuffer(value, 'PRIVATE KEY'), 'Ed25519', false, [
    'sign'
  ])
}

export async function importEd25519PublicKeyPem(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', pemBuffer(value, 'PUBLIC KEY'), 'Ed25519', true, [
    'verify'
  ])
}

export async function exportEd25519PublicKeyPem(value: CryptoKey): Promise<string> {
  assertEd25519PublicKey(value)
  return publicKeyPem(await crypto.subtle.exportKey('spki', value))
}

export async function signEd25519(data: Uint8Array, privateKey: CryptoKey): Promise<string> {
  assertEd25519PrivateKey(privateKey)
  const signature = await crypto.subtle.sign('Ed25519', privateKey, webCryptoBuffer(data))
  return encodeBase64Url(new Uint8Array(signature))
}

export async function verifyEd25519(
  data: Uint8Array,
  signature: string,
  publicKey: CryptoKey
): Promise<boolean> {
  assertEd25519PublicKey(publicKey)
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    webCryptoBuffer(decodeBase64Url(signature)),
    webCryptoBuffer(data)
  )
}

export async function createSignedManifestIntegrity(
  payload: unknown,
  keyId: string,
  privateKey: CryptoKey
): Promise<SignedManifestIntegrity> {
  assertEd25519PrivateKey(privateKey)
  const digest = await digestCanonicalManifest(payload)
  return {
    algorithm: 'SHA-256',
    digest,
    signature: {
      algorithm: 'Ed25519',
      keyId,
      value: await signEd25519(signedManifestBytes(payload, digest), privateKey)
    }
  }
}

export function assertSignedManifestVerificationPolicy(
  publicKey: CryptoKey,
  signatureKeyId: string,
  policy: SignedManifestVerificationPolicy,
  context: SignedManifestPolicyContext
): void {
  assertEd25519PublicKey(publicKey)
  if (policy.expectedKeyId && policy.expectedKeyId !== signatureKeyId) {
    throw new Error(`${context.label} signature key id is not trusted`)
  }
  if (
    policy.engineVersion &&
    !satisfiesStableEngineRange(policy.engineVersion, context.engineRange, {
      maxLength: context.maxEngineRangeLength,
      invalid: context.invalid
    })
  ) {
    throw new Error(
      `${context.engineLabel ?? context.label} requires OpenPencil ${context.engineRange}`
    )
  }
}

export async function verifySignedManifestIntegrity(
  payload: unknown,
  integrity: SignedManifestIntegrity,
  publicKey: CryptoKey,
  label: string
): Promise<string> {
  const digest = await digestCanonicalManifest(payload)
  if (digest !== integrity.digest) throw new Error(`${label} digest mismatch`)
  const verified = await verifyEd25519(
    signedManifestBytes(payload, digest),
    integrity.signature.value,
    publicKey
  )
  if (!verified) throw new Error(`${label} signature verification failed`)
  return digest
}
import { validateModuleIdentity } from './module'
