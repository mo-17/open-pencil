import {
  assertEd25519PublicKey,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import {
  PLUGIN_TRUST_TIMESTAMP_MAX_LENGTH,
  parsePluginTrustTimestamp,
  parsePluginTrustValidityWindow,
  parseSortedUniqueStringArray
} from './parse-helpers'

export { parsePluginTrustTimestamp }

export const TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION = 1 as const

export const TRUSTED_PLUGIN_KEYRING_LIMITS = Object.freeze({
  maxKeys: 256,
  maxPluginIdsPerKey: 256,
  maxTimestampLength: PLUGIN_TRUST_TIMESTAMP_MAX_LENGTH,
  maxRevocationReasonLength: 512,
  expiringSoonMilliseconds: 7 * 24 * 60 * 60 * 1_000
})

export type PluginTrustErrorCode =
  | 'publisher-key-untrusted'
  | 'publisher-ownership-mismatch'
  | 'publisher-key-not-yet-valid'
  | 'publisher-key-expired'
  | 'publisher-key-revoked'
  | 'publisher-key-rotation-invalid'
  | 'publisher-signature-invalid'
  | 'publisher-engine-incompatible'
  | 'catalog-id-mismatch'
  | 'catalog-key-untrusted'
  | 'catalog-entry-mismatch'
  | 'catalog-integrity-invalid'
  | 'catalog-not-yet-valid'
  | 'catalog-expired'

export type PluginTrustDiagnosticCode =
  | 'publisher-key-rotated'
  | 'publisher-key-expiring-soon'
  | 'publisher-key-predecessor-revoked'
  | 'catalog-expiring-soon'

export class PluginTrustError extends Error {
  readonly code: PluginTrustErrorCode
  readonly subjectId: string

  constructor(code: PluginTrustErrorCode, message: string, subjectId: string) {
    super(message)
    this.name = 'PluginTrustError'
    this.code = code
    this.subjectId = subjectId
  }
}

export interface PluginTrustDiagnostic {
  code: PluginTrustDiagnosticCode
  message: string
  subjectId: string
}

export interface TrustedPluginPublisherKeyV1 {
  keyId: string
  publisherId: string
  pluginIds: readonly string[]
  publicKey: CryptoKey
  notBefore: string
  notAfter: string
  predecessorKeyId?: string
  revokedAt?: string
  revocationReason?: string
}

export interface TrustedPluginKeyringV1 {
  schemaVersion: typeof TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION
  keys: readonly TrustedPluginPublisherKeyV1[]
}

export interface PluginTrustTimeOptions {
  now?: Date | string | number
}

export interface TrustedPluginKeyResolution {
  key: TrustedPluginPublisherKeyV1
  rotationPath: readonly string[]
  diagnostics: readonly PluginTrustDiagnostic[]
}

export interface TrustedPluginKeyLookup extends PluginTrustTimeOptions {
  pluginId: string
  publisherId: string
  keyId: string
}

export interface TrustedPluginKeyTransition extends PluginTrustTimeOptions {
  pluginId: string
  publisherId: string
  fromKeyId: string
  toKeyId: string
}

const KEYRING_KEYS = new Set(['schemaVersion', 'keys'])
const KEY_KEYS = new Set([
  'keyId',
  'publisherId',
  'pluginIds',
  'publicKey',
  'notBefore',
  'notAfter',
  'predecessorKeyId',
  'revokedAt',
  'revocationReason'
])
const REQUIRED_KEY_KEYS = new Set([
  'keyId',
  'publisherId',
  'pluginIds',
  'publicKey',
  'notBefore',
  'notAfter'
])

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

export function pluginTrustNow(value: Date | string | number | undefined): number {
  let milliseconds: number | undefined
  if (value instanceof Date) milliseconds = value.getTime()
  else if (typeof value === 'string') milliseconds = Date.parse(value)
  else milliseconds = value
  const resolved = milliseconds ?? Date.now()
  if (!Number.isSafeInteger(resolved) || !Number.isFinite(new Date(resolved).getTime())) {
    throw new TypeError('now must be a valid timestamp')
  }
  return resolved
}

function boundedReason(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > TRUSTED_PLUGIN_KEYRING_LIMITS.maxRevocationReasonLength
  ) {
    throw new TypeError(`${path} must be a non-empty bounded string`)
  }
  const normalized = value.normalize('NFC').trim()
  if (
    normalized.length === 0 ||
    normalized.length > TRUSTED_PLUGIN_KEYRING_LIMITS.maxRevocationReasonLength ||
    containsControlCharacter(normalized)
  ) {
    throw new TypeError(`${path} must contain bounded printable text`)
  }
  return normalized
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function pluginIds(value: unknown, path: string): readonly string[] {
  return parseSortedUniqueStringArray(value, path, {
    maximumEntries: TRUSTED_PLUGIN_KEYRING_LIMITS.maxPluginIdsPerKey,
    duplicateLabel: 'plugin ids',
    parseEntry: identity,
    requireNonEmptyLabel: 'plugin id'
  })
}

function publisherKey(value: unknown, index: number): TrustedPluginPublisherKeyV1 {
  const path = `trustedPluginKeyring.keys[${index}]`
  const source = parseExactManifestRecord(value, path, KEY_KEYS, REQUIRED_KEY_KEYS)
  const keyId = identity(source.keyId, `${path}.keyId`)
  const publisherId = identity(source.publisherId, `${path}.publisherId`)
  assertEd25519PublicKey(source.publicKey as CryptoKey)
  const { notBefore, notAfter } = parsePluginTrustValidityWindow(source, path)
  const predecessorKeyId = Object.hasOwn(source, 'predecessorKeyId')
    ? identity(source.predecessorKeyId, `${path}.predecessorKeyId`)
    : undefined
  const revokedAt = Object.hasOwn(source, 'revokedAt')
    ? parsePluginTrustTimestamp(source.revokedAt, `${path}.revokedAt`)
    : undefined
  const revocationReason = Object.hasOwn(source, 'revocationReason')
    ? boundedReason(source.revocationReason, `${path}.revocationReason`)
    : undefined
  if ((revokedAt === undefined) !== (revocationReason === undefined)) {
    throw new TypeError(`${path}.revokedAt and revocationReason must be provided together`)
  }
  return Object.freeze({
    keyId,
    publisherId,
    pluginIds: pluginIds(source.pluginIds, `${path}.pluginIds`),
    publicKey: source.publicKey as CryptoKey,
    notBefore,
    notAfter,
    ...(predecessorKeyId ? { predecessorKeyId } : {}),
    ...(revokedAt ? { revokedAt, revocationReason } : {})
  })
}

function validateRotation(keys: readonly TrustedPluginPublisherKeyV1[]): void {
  const byId = new Map(keys.map((key) => [key.keyId, key]))
  for (const key of keys) {
    if (!key.predecessorKeyId) continue
    const predecessor = byId.get(key.predecessorKeyId)
    if (!predecessor) {
      throw new TypeError(`trustedPluginKeyring key ${key.keyId} has an unknown predecessor`)
    }
    if (predecessor.publisherId !== key.publisherId) {
      throw new TypeError(`trustedPluginKeyring key ${key.keyId} changes publisher ownership`)
    }
    if (Date.parse(predecessor.notBefore) >= Date.parse(key.notBefore)) {
      throw new TypeError(`trustedPluginKeyring key ${key.keyId} must follow its predecessor`)
    }
    if (key.pluginIds.some((pluginId) => !predecessor.pluginIds.includes(pluginId))) {
      throw new TypeError(`trustedPluginKeyring key ${key.keyId} broadens predecessor ownership`)
    }
  }
}

export function parseTrustedPluginKeyring(value: unknown): TrustedPluginKeyringV1 {
  const source = parseExactManifestRecord(value, 'trustedPluginKeyring', KEYRING_KEYS, KEYRING_KEYS)
  if (source.schemaVersion !== TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION) {
    throw new TypeError('trustedPluginKeyring.schemaVersion is not supported')
  }
  const keys = parseBoundedManifestArray(
    source.keys,
    'trustedPluginKeyring.keys',
    TRUSTED_PLUGIN_KEYRING_LIMITS.maxKeys
  ).map(publisherKey)
  if (new Set(keys.map((key) => key.keyId)).size !== keys.length) {
    throw new TypeError('trustedPluginKeyring.keys contains duplicate key ids')
  }
  validateRotation(keys)
  return Object.freeze({
    schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
    keys: Object.freeze(keys)
  })
}

function keyByIdentity(
  keyring: TrustedPluginKeyringV1,
  pluginId: string,
  publisherId: string,
  keyId: string
): TrustedPluginPublisherKeyV1 {
  const key = keyring.keys.find((candidate) => candidate.keyId === keyId)
  if (!key) {
    throw new PluginTrustError('publisher-key-untrusted', 'Publisher key is not trusted', keyId)
  }
  if (key.publisherId !== publisherId) {
    throw new PluginTrustError(
      'publisher-ownership-mismatch',
      'Publisher key belongs to a different publisher',
      keyId
    )
  }
  if (!key.pluginIds.includes(pluginId)) {
    throw new PluginTrustError(
      'publisher-ownership-mismatch',
      'Publisher key does not own this plugin',
      keyId
    )
  }
  return key
}

function activeKeyDiagnostics(
  key: TrustedPluginPublisherKeyV1,
  now: number
): readonly PluginTrustDiagnostic[] {
  const notBefore = Date.parse(key.notBefore)
  const notAfter = Date.parse(key.notAfter)
  if (key.revokedAt && now >= Date.parse(key.revokedAt)) {
    throw new PluginTrustError(
      'publisher-key-revoked',
      `Publisher key ${key.keyId} was revoked at ${key.revokedAt}: ${key.revocationReason}`,
      key.keyId
    )
  }
  if (now < notBefore) {
    throw new PluginTrustError(
      'publisher-key-not-yet-valid',
      `Publisher key ${key.keyId} is not valid until ${key.notBefore}`,
      key.keyId
    )
  }
  if (now >= notAfter) {
    throw new PluginTrustError(
      'publisher-key-expired',
      `Publisher key ${key.keyId} expired at ${key.notAfter}`,
      key.keyId
    )
  }
  return notAfter - now <= TRUSTED_PLUGIN_KEYRING_LIMITS.expiringSoonMilliseconds
    ? [
        {
          code: 'publisher-key-expiring-soon',
          message: `Publisher key ${key.keyId} expires at ${key.notAfter}`,
          subjectId: key.keyId
        }
      ]
    : []
}

function predecessorPath(
  keyring: TrustedPluginKeyringV1,
  target: TrustedPluginPublisherKeyV1,
  pluginId: string,
  publisherId: string
): readonly TrustedPluginPublisherKeyV1[] {
  const path = [target]
  let current = target
  while (current.predecessorKeyId) {
    current = keyByIdentity(keyring, pluginId, publisherId, current.predecessorKeyId)
    path.push(current)
    if (path.length > keyring.keys.length) {
      throw new PluginTrustError(
        'publisher-key-rotation-invalid',
        'Publisher key rotation contains a cycle',
        target.keyId
      )
    }
  }
  return path
}

export function resolveTrustedPluginKey(
  value: TrustedPluginKeyringV1,
  lookup: TrustedPluginKeyLookup
): TrustedPluginKeyResolution {
  const keyring = parseTrustedPluginKeyring(value)
  const key = keyByIdentity(keyring, lookup.pluginId, lookup.publisherId, lookup.keyId)
  const now = pluginTrustNow(lookup.now)
  const diagnostics = [...activeKeyDiagnostics(key, now)]
  const chain = predecessorPath(keyring, key, lookup.pluginId, lookup.publisherId)
  if (chain.length > 1) {
    diagnostics.push({
      code: 'publisher-key-rotated',
      message: `Publisher key ${key.keyId} rotates ${chain[1].keyId}`,
      subjectId: key.keyId
    })
  }
  for (const predecessor of chain.slice(1)) {
    if (predecessor.revokedAt && now >= Date.parse(predecessor.revokedAt)) {
      diagnostics.push({
        code: 'publisher-key-predecessor-revoked',
        message: `Predecessor key ${predecessor.keyId} was revoked at ${predecessor.revokedAt}`,
        subjectId: predecessor.keyId
      })
    }
  }
  return {
    key,
    rotationPath: Object.freeze(chain.toReversed().map(({ keyId }) => keyId)),
    diagnostics: Object.freeze(diagnostics)
  }
}

export function authorizeTrustedPluginKeyTransition(
  value: TrustedPluginKeyringV1,
  transition: TrustedPluginKeyTransition
): TrustedPluginKeyResolution {
  const resolved = resolveTrustedPluginKey(value, {
    pluginId: transition.pluginId,
    publisherId: transition.publisherId,
    keyId: transition.toKeyId,
    now: transition.now
  })
  return {
    ...resolved,
    rotationPath: traceTrustedPluginKeyTransition(value, transition)
  }
}

export function traceTrustedPluginKeyTransition(
  value: TrustedPluginKeyringV1,
  transition: TrustedPluginKeyTransition
): readonly string[] {
  const keyring = parseTrustedPluginKeyring(value)
  const target = keyByIdentity(
    keyring,
    transition.pluginId,
    transition.publisherId,
    transition.toKeyId
  )
  const path = predecessorPath(keyring, target, transition.pluginId, transition.publisherId)
    .toReversed()
    .map(({ keyId }) => keyId)
  const currentIndex = path.indexOf(transition.fromKeyId)
  if (currentIndex === -1 || path.at(-1) !== transition.toKeyId) {
    throw new PluginTrustError(
      'publisher-key-rotation-invalid',
      `Publisher key ${transition.toKeyId} does not rotate ${transition.fromKeyId}`,
      transition.toKeyId
    )
  }
  return Object.freeze(path.slice(currentIndex))
}
