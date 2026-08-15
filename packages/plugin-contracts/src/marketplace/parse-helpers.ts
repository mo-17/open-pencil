import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import { MARKETPLACE_RELEASE_CHANNELS, MARKETPLACE_SNAPSHOT_LIMITS } from './types'
import type { MarketplaceReleaseChannelV1 } from './types'

export { parseBoundedManifestArray, parseExactManifestRecord }

export function marketplaceIdentity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

export function marketplaceText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new TypeError(`${path} must be a bounded string`)
  }
  const normalized = value.normalize('NFC').trim()
  if (normalized.length === 0 || normalized.length > maximum || hasControlCharacter(normalized)) {
    throw new TypeError(`${path} must contain bounded printable text`)
  }
  return normalized
}

export function marketplacePositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

export function marketplaceChannel(value: unknown, path: string): MarketplaceReleaseChannelV1 {
  if (!MARKETPLACE_RELEASE_CHANNELS.includes(value as MarketplaceReleaseChannelV1)) {
    throw new TypeError(`${path} must be stable or beta`)
  }
  return value as MarketplaceReleaseChannelV1
}

export function marketplaceChannelRank(value: MarketplaceReleaseChannelV1): number {
  return MARKETPLACE_RELEASE_CHANNELS.indexOf(value)
}

export function compareMarketplaceText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function marketplacePublicHttpsURL(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MARKETPLACE_SNAPSHOT_LIMITS.maxUrlLength) {
    throw new TypeError(`${path} must be a bounded public HTTPS URL`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new TypeError(`${path} must be a valid public HTTPS URL`)
  }
  const hostname = parsed.hostname.toLowerCase()
  const numericHost = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')
  const localHost =
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    (parsed.port !== '' && parsed.port !== '443') ||
    numericHost ||
    localHost ||
    parsed.href !== value
  ) {
    throw new TypeError(`${path} must be a canonical public HTTPS URL without credentials`)
  }
  return value
}

export function marketplacePublicKeyPem(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength > MARKETPLACE_SNAPSHOT_LIMITS.maxPemBytes ||
    !value.startsWith('-----BEGIN PUBLIC KEY-----\n') ||
    !value.endsWith('\n-----END PUBLIC KEY-----\n')
  ) {
    throw new TypeError(`${path} must be bounded canonical PUBLIC KEY PEM text`)
  }
  const encoded = value
    .slice('-----BEGIN PUBLIC KEY-----\n'.length, -'\n-----END PUBLIC KEY-----\n'.length)
    .split('\n')
  if (
    encoded.length === 0 ||
    encoded.some(
      (line, index) =>
        line.length === 0 ||
        line.length > 64 ||
        (index < encoded.length - 1 && line.length !== 64) ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(line)
    )
  ) {
    throw new TypeError(`${path} must use canonical PEM line wrapping`)
  }
  const base64 = encoded.join('')
  try {
    if (btoa(atob(base64)) !== base64) throw new Error('non-canonical')
  } catch {
    throw new TypeError(`${path} must contain canonical base64 data`)
  }
  return value
}

export function assertMarketplaceSorted<T>(
  values: readonly T[],
  path: string,
  compare: (left: T, right: T) => number
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1], values[index]) >= 0) {
      throw new TypeError(`${path} must be unique and sorted in ascending order`)
    }
  }
}

export function marketplaceStringList(
  value: unknown,
  path: string,
  maximumEntries: number,
  maximumLength: number,
  identity = false
): readonly string[] {
  const parsed = parseBoundedManifestArray(value, path, maximumEntries).map((entry, index) =>
    identity
      ? marketplaceIdentity(entry, `${path}[${index}]`)
      : marketplaceText(entry, `${path}[${index}]`, maximumLength)
  )
  assertMarketplaceSorted(parsed, path, compareMarketplaceText)
  return Object.freeze(parsed)
}
