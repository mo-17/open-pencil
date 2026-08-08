import {
  compareStableSemver,
  isPlainJsonObject,
  parseBoundedManifestArray,
  parseStableSemver,
  stableSemverParts,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

export const PLUGIN_TRUST_TIMESTAMP_MAX_LENGTH = 32 as const

export interface SortedUniqueStringArrayOptions<Value extends string> {
  maximumEntries: number
  duplicateLabel: string
  parseEntry: (value: unknown, path: string) => Value
  requireNonEmptyLabel?: string
}

export interface PluginTrustValidityWindow {
  notBefore: string
  notAfter: string
}

export function hasExactPluginKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>
): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.size && keys.every((key) => allowed.has(key))
}

const CANONICAL_HEX_COLOR = /^#[\dA-F]{6}$/i

export function parseBoundedPluginText(
  value: unknown,
  path: string,
  minimumLength: number,
  maximumLength: number
): string {
  if (
    typeof value !== 'string' ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    (minimumLength > 0 && value.trim().length === 0)
  ) {
    throw new TypeError(`${path} must contain ${minimumLength} to ${maximumLength} characters`)
  }
  return value
}

export function parseCanonicalPluginColor(value: unknown, path: string): string {
  if (typeof value !== 'string' || !CANONICAL_HEX_COLOR.test(value)) {
    throw new TypeError(`${path} must be a #RRGGBB value`)
  }
  return value.toUpperCase()
}

function containsUnsafePluginHrefCharacter(value: string): boolean {
  if (value.includes('\\')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

export function isSafePluginHref(
  value: unknown,
  path: string,
  maximumLength: number,
  allowEmpty: boolean
): value is string {
  if (allowEmpty && value === '') return true
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    containsUnsafePluginHrefCharacter(value)
  ) {
    return false
  }
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (value.startsWith('#') && value.length > 1) return true
  try {
    parseCanonicalPublicHttpsUrl(value, path, maximumLength)
    return true
  } catch {
    return false
  }
}

export function assertBoundedPluginConfigBytes(
  config: unknown,
  path: string,
  maximumBytes: number
): void {
  const bytes = new TextEncoder().encode(JSON.stringify(config)).byteLength
  if (bytes > maximumBytes) {
    throw new TypeError(`${path} must not exceed ${maximumBytes} encoded bytes`)
  }
}

export function mergePluginConfigWithDefaults(
  defaults: Readonly<Record<string, unknown>>,
  config: unknown
): unknown {
  if (config === undefined) return structuredClone(defaults)
  if (!isPlainJsonObject(config)) return config
  return { ...structuredClone(defaults), ...config }
}

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const LOCAL_HOSTNAMES = new Set(['localhost', 'localdomain', 'home.arpa'])
const LOCAL_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.localdomain', '.home.arpa']

function isLocalHostname(hostname: string): boolean {
  return (
    hostname.endsWith('.') ||
    LOCAL_HOSTNAMES.has(hostname) ||
    LOCAL_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  )
}

export function parseSortedUniqueStringArray<Value extends string>(
  value: unknown,
  path: string,
  options: SortedUniqueStringArrayOptions<Value>
): readonly Value[] {
  const parsed = parseBoundedManifestArray(value, path, options.maximumEntries).map(
    (entry, index) => options.parseEntry(entry, `${path}[${index}]`)
  )
  if (options.requireNonEmptyLabel && parsed.length === 0) {
    throw new TypeError(`${path} must contain at least one ${options.requireNonEmptyLabel}`)
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new TypeError(`${path} must not contain duplicate ${options.duplicateLabel}`)
  }
  const sorted = [...parsed].sort()
  if (parsed.some((entry, index) => entry !== sorted[index])) {
    throw new TypeError(`${path} must be sorted in ascending order`)
  }
  return Object.freeze(parsed)
}

export function parsePluginTrustTimestamp(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > PLUGIN_TRUST_TIMESTAMP_MAX_LENGTH ||
    !CANONICAL_TIMESTAMP.test(value)
  ) {
    throw new TypeError(`${path} must be a canonical UTC timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${path} must be a valid canonical UTC timestamp`)
  }
  return value
}

export function parsePluginTrustValidityWindow(
  source: Readonly<Record<string, unknown>>,
  path: string
): PluginTrustValidityWindow {
  const notBefore = parsePluginTrustTimestamp(source.notBefore, `${path}.notBefore`)
  const notAfter = parsePluginTrustTimestamp(source.notAfter, `${path}.notAfter`)
  if (Date.parse(notAfter) <= Date.parse(notBefore)) {
    throw new TypeError(`${path}.notAfter must be later than notBefore`)
  }
  return { notBefore, notAfter }
}

export function parseCanonicalPublicHttpsUrl(
  value: unknown,
  path: string,
  maximumLength: number
): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new TypeError(`${path} must be a bounded HTTPS URL`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${path} must be a valid HTTPS URL`)
  }
  const hostname = url.hostname.toLowerCase()
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (url.port !== '' && url.port !== '443') ||
    isLocalHostname(hostname) ||
    ipv4 ||
    ipv6 ||
    url.href !== value
  ) {
    throw new TypeError(
      `${path} must be a canonical public HTTPS URL without credentials or fragments`
    )
  }
  return value
}

export function comparePluginVersionCoordinates(
  leftPluginId: string,
  leftVersion: string,
  rightPluginId: string,
  rightVersion: string
): number {
  if (leftPluginId !== rightPluginId) return leftPluginId < rightPluginId ? -1 : 1
  return -compareStableSemver(stableSemverParts(leftVersion), stableSemverParts(rightVersion))
}

export function parsePluginVersionCoordinate(
  source: Readonly<Record<string, unknown>>,
  path: string
): readonly [pluginId: string, version: string] {
  const pluginIdReason = validateModuleIdentity(source.pluginId, `${path}.pluginId`)
  if (pluginIdReason) throw new TypeError(pluginIdReason)
  return Object.freeze([
    source.pluginId as string,
    parseStableSemver(source.version, `${path}.version`)
  ])
}
