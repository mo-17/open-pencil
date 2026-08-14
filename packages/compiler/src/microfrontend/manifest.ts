import { sha256 } from '@noble/hashes/sha2'

import {
  canonicalManifestValue,
  encodeBase64URL,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  parseStableSemver,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import {
  OPENPENCIL_MICROFRONTEND_ABI_V1,
  OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT,
  OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION,
  OPENPENCIL_MICROFRONTEND_LIMITS,
  OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
  OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION
} from './constants'
import type {
  OpenPencilMicrofrontendAppV1,
  OpenPencilMicrofrontendCompositionAppV1,
  OpenPencilMicrofrontendCompositionIdentityV1,
  OpenPencilMicrofrontendCompositionManifestV1,
  OpenPencilMicrofrontendCompositionSlotV1,
  OpenPencilMicrofrontendFrameworkV1,
  OpenPencilMicrofrontendManifestCoordinateV1,
  OpenPencilMicrofrontendRuntimeAssetV1,
  OpenPencilMicrofrontendRuntimeManifestV1
} from './types'

const RUNTIME_MANIFEST_KEYS = new Set([
  'format',
  'schemaVersion',
  'abi',
  'app',
  'artifact',
  'routes'
])
const APP_KEYS = new Set(['id', 'name', 'version', 'framework'])
const ARTIFACT_KEYS = new Set(['entry', 'styles'])
const ASSET_KEYS = new Set(['path', 'mediaType', 'byteLength', 'digest'])
const COMPOSITION_MANIFEST_KEYS = new Set([
  'format',
  'schemaVersion',
  'abi',
  'composition',
  'slots',
  'apps'
])
const COMPOSITION_KEYS = new Set(['id', 'name', 'version'])
const SLOT_KEYS = new Set(['id'])
const COMPOSITION_APP_KEYS = new Set(['appId', 'manifest', 'routeBase', 'slotId'])
const COORDINATE_KEYS = new Set(['kind', 'path', 'url', 'digest', 'byteLength'])
const LOCAL_COORDINATE_KEYS = new Set(['kind', 'path'])
const REMOTE_COORDINATE_KEYS = new Set(['kind', 'url', 'digest', 'byteLength'])
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_@.+-]+$/
const SAFE_STATIC_ROUTE_SEGMENT = /^[A-Za-z0-9._~!$&'()+,;=@-]+$/
const ROUTE_PARAMETER_SEGMENT = /^:[A-Za-z_][A-Za-z0-9_]*\??$/
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SPECIAL_USE_DNS_SUFFIXES = Object.freeze([
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
const SPECIAL_USE_DNS_NAMES = new Set(['example.com', 'example.net', 'example.org'])

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function boundedText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${path} must be a non-empty bounded string`)
  }
  if (
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    })
  ) {
    throw new TypeError(`${path} must be canonical printable text without surrounding whitespace`)
  }
  return value
}

function boundedPositiveInteger(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${path} must be a positive safe integer no greater than ${maximum}`)
  }
  return value as number
}

function safeManifestPath(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > OPENPENCIL_MICROFRONTEND_LIMITS.maxPathLength ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('%') ||
    (!value.startsWith('/') && !value.startsWith('./')) ||
    value.startsWith('//') ||
    value.endsWith('/')
  ) {
    throw new TypeError(`${path} must be a bounded root-relative or manifest-relative path`)
  }
  const relative = value.startsWith('/') ? value.slice(1) : value.slice(2)
  const segments = relative.split('/')
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' || segment === '.' || segment === '..' || !SAFE_PATH_SEGMENT.test(segment)
    )
  ) {
    throw new TypeError(
      `${path} must not contain traversal, empty, encoded, or unsafe path segments`
    )
  }
  return value
}

function runtimeRoute(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > OPENPENCIL_MICROFRONTEND_LIMITS.maxRouteLength ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    value.includes('%') ||
    (value.length > 1 && value.endsWith('/'))
  ) {
    throw new TypeError(`${path} must be a bounded canonical root route pattern`)
  }
  if (value === '/') return value
  const segments = value.slice(1).split('/')
  if (
    segments.some((segment, index) => {
      if (segment === '' || segment === '.' || segment === '..') return true
      if (segment === '*') return index !== segments.length - 1
      if (segment.startsWith(':')) return !ROUTE_PARAMETER_SEGMENT.test(segment)
      return !SAFE_STATIC_ROUTE_SEGMENT.test(segment)
    })
  ) {
    throw new TypeError(`${path} contains an unsafe or malformed route segment`)
  }
  return value
}

function routeCollisionKey(route: string): string {
  if (route === '/') return route
  return route
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      return segment.endsWith('?') ? ':?' : ':'
    })
    .join('/')
}

function routeBase(value: unknown, path: string): string {
  const parsed = runtimeRoute(value, path)
  if (parsed.includes(':') || parsed.includes('*') || parsed.includes('?')) {
    throw new TypeError(`${path} must be a static canonical root path`)
  }
  return parsed
}

function isPublicDNSHostname(hostname: string): boolean {
  const labels = hostname.split('.')
  if (hostname.endsWith('.') || labels.length < 2 || hostname.includes(':')) return false
  if (labels.some((label) => !DNS_LABEL.test(label) || label.startsWith('xn--'))) return false
  if (
    SPECIAL_USE_DNS_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
    ) ||
    Array.from(SPECIAL_USE_DNS_NAMES).some(
      (name) => hostname === name || hostname.endsWith(`.${name}`)
    )
  ) {
    return false
  }
  const suffix = labels.at(-1) ?? ''
  return !/^\d+$/.test(suffix) && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
}

function publicHttpsURL(value: unknown, path: string): string {
  const source = boundedText(value, path, OPENPENCIL_MICROFRONTEND_LIMITS.maxUrlLength)
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw new TypeError(`${path} must be a valid public HTTPS URL`)
  }
  const hostname = parsed.hostname.toLowerCase()
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.href.includes('?') ||
    parsed.href.includes('#') ||
    (parsed.port !== '' && parsed.port !== '443') ||
    !isPublicDNSHostname(hostname) ||
    parsed.href !== source
  ) {
    throw new TypeError(`${path} must be a canonical public HTTPS URL without credentials`)
  }
  return source
}

function localManifestPath(value: unknown, path: string): string {
  const parsed = safeManifestPath(value, path)
  if (!parsed.startsWith('./')) {
    throw new TypeError(`${path} must be a composition-manifest-relative path starting with "./"`)
  }
  return parsed
}

function framework(value: unknown, path: string): OpenPencilMicrofrontendFrameworkV1 {
  if (value !== 'react' && value !== 'vue') {
    throw new TypeError(`${path} must be react or vue`)
  }
  return value
}

function versionedIdentityFields(
  source: Readonly<Record<string, unknown>>,
  path: string
): { id: string; name: string; version: string } {
  return {
    id: identity(source.id, `${path}.id`),
    name: boundedText(source.name, `${path}.name`, OPENPENCIL_MICROFRONTEND_LIMITS.maxNameLength),
    version: parseStableSemver(source.version, `${path}.version`)
  }
}

export function parseOpenPencilMicrofrontendRuntimeApp(
  value: unknown,
  path = 'microfrontendApp'
): OpenPencilMicrofrontendAppV1 {
  const source = parseExactManifestRecord(value, path, APP_KEYS)
  return Object.freeze({
    ...versionedIdentityFields(source, path),
    framework: framework(source.framework, `${path}.framework`)
  })
}

export function parseOpenPencilMicrofrontendRuntimeRoutes(
  value: unknown,
  path = 'microfrontendRoutes'
): readonly string[] {
  const routes = Object.freeze(
    parseBoundedManifestArray(value, path, OPENPENCIL_MICROFRONTEND_LIMITS.maxRoutes).map(
      (route, index) => runtimeRoute(route, `${path}[${index}]`)
    )
  )
  if (routes.length === 0) {
    throw new TypeError(`${path} must contain at least one route`)
  }
  const routeKeys = routes.map(routeCollisionKey)
  if (new Set(routeKeys).size !== routeKeys.length) {
    throw new TypeError(`${path} must be unique without equivalent patterns`)
  }
  return routes
}

function asset(
  value: unknown,
  path: string,
  expectedMediaType: OpenPencilMicrofrontendRuntimeAssetV1['mediaType']
): OpenPencilMicrofrontendRuntimeAssetV1 {
  const source = parseExactManifestRecord(value, path, ASSET_KEYS)
  if (source.mediaType !== expectedMediaType) {
    throw new TypeError(`${path}.mediaType must be ${expectedMediaType}`)
  }
  return Object.freeze({
    path: safeManifestPath(source.path, `${path}.path`),
    mediaType: expectedMediaType,
    byteLength: boundedPositiveInteger(
      source.byteLength,
      `${path}.byteLength`,
      OPENPENCIL_MICROFRONTEND_LIMITS.maxAssetByteLength
    ),
    digest: parseSha256Base64URL(source.digest, `${path}.digest`)
  })
}

function assertCanonicalByteLength(value: unknown, path: string, maximum: number): void {
  const byteLength = new TextEncoder().encode(
    JSON.stringify(canonicalManifestValue(value))
  ).byteLength
  if (byteLength > maximum) {
    throw new TypeError(`${path} exceeds the maximum canonical JSON byte length of ${maximum}`)
  }
}

export function parseOpenPencilMicrofrontendRuntimeManifest(
  value: unknown
): OpenPencilMicrofrontendRuntimeManifestV1 {
  const source = parseExactManifestRecord(value, 'microfrontendManifest', RUNTIME_MANIFEST_KEYS)
  if (source.format !== OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT) {
    throw new TypeError(
      `microfrontendManifest.format must be ${OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT}`
    )
  }
  if (source.schemaVersion !== OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(
      `microfrontendManifest.schemaVersion must be ${OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION}`
    )
  }
  if (source.abi !== OPENPENCIL_MICROFRONTEND_ABI_V1) {
    throw new TypeError(`microfrontendManifest.abi must be ${OPENPENCIL_MICROFRONTEND_ABI_V1}`)
  }
  const artifactSource = parseExactManifestRecord(
    source.artifact,
    'microfrontendManifest.artifact',
    ARTIFACT_KEYS
  )
  const entry = asset(
    artifactSource.entry,
    'microfrontendManifest.artifact.entry',
    'text/javascript'
  ) as OpenPencilMicrofrontendRuntimeManifestV1['artifact']['entry']
  const styles = Object.freeze(
    parseBoundedManifestArray(
      artifactSource.styles,
      'microfrontendManifest.artifact.styles',
      OPENPENCIL_MICROFRONTEND_LIMITS.maxStyles
    ).map(
      (style, index) =>
        asset(
          style,
          `microfrontendManifest.artifact.styles[${index}]`,
          'text/css'
        ) as OpenPencilMicrofrontendRuntimeManifestV1['artifact']['styles'][number]
    )
  )
  const assetPaths = [entry.path, ...styles.map((style) => style.path)]
  if (new Set(assetPaths).size !== assetPaths.length) {
    throw new TypeError('microfrontendManifest.artifact asset paths must be unique')
  }
  const aggregateAssetByteLength = styles.reduce(
    (total, style) => total + style.byteLength,
    entry.byteLength
  )
  if (
    !Number.isSafeInteger(aggregateAssetByteLength) ||
    aggregateAssetByteLength > OPENPENCIL_MICROFRONTEND_LIMITS.maxAssetByteLength
  ) {
    throw new TypeError('Runtime manifest aggregate assets exceed the application limit')
  }
  const routes = parseOpenPencilMicrofrontendRuntimeRoutes(
    source.routes,
    'microfrontendManifest.routes'
  )
  const parsed = Object.freeze({
    format: OPENPENCIL_MICROFRONTEND_MANIFEST_FORMAT,
    schemaVersion: OPENPENCIL_MICROFRONTEND_MANIFEST_SCHEMA_VERSION,
    abi: OPENPENCIL_MICROFRONTEND_ABI_V1,
    app: parseOpenPencilMicrofrontendRuntimeApp(source.app, 'microfrontendManifest.app'),
    artifact: Object.freeze({ entry, styles }),
    routes
  })
  assertCanonicalByteLength(
    parsed,
    'microfrontendManifest',
    OPENPENCIL_MICROFRONTEND_LIMITS.maxRuntimeManifestJsonBytes
  )
  return parsed
}

function compositionIdentity(
  value: unknown,
  path: string
): OpenPencilMicrofrontendCompositionIdentityV1 {
  const source = parseExactManifestRecord(value, path, COMPOSITION_KEYS)
  return Object.freeze(versionedIdentityFields(source, path))
}

function slot(value: unknown, path: string): OpenPencilMicrofrontendCompositionSlotV1 {
  const source = parseExactManifestRecord(value, path, SLOT_KEYS)
  return Object.freeze({ id: identity(source.id, `${path}.id`) })
}

function manifestCoordinate(
  value: unknown,
  path: string
): OpenPencilMicrofrontendManifestCoordinateV1 {
  const candidate = parseExactManifestRecord(value, path, COORDINATE_KEYS, new Set(['kind']))
  if (candidate.kind === 'local') {
    const source = parseExactManifestRecord(value, path, LOCAL_COORDINATE_KEYS)
    return Object.freeze({ kind: 'local', path: localManifestPath(source.path, `${path}.path`) })
  }
  if (candidate.kind === 'remote') {
    const source = parseExactManifestRecord(value, path, REMOTE_COORDINATE_KEYS)
    return Object.freeze({
      kind: 'remote',
      url: publicHttpsURL(source.url, `${path}.url`),
      digest: parseSha256Base64URL(source.digest, `${path}.digest`),
      byteLength: boundedPositiveInteger(
        source.byteLength,
        `${path}.byteLength`,
        OPENPENCIL_MICROFRONTEND_LIMITS.maxManifestByteLength
      )
    })
  }
  throw new TypeError(`${path}.kind must be local or remote`)
}

function compositionApp(value: unknown, path: string): OpenPencilMicrofrontendCompositionAppV1 {
  const source = parseExactManifestRecord(value, path, COMPOSITION_APP_KEYS)
  return Object.freeze({
    appId: identity(source.appId, `${path}.appId`),
    manifest: manifestCoordinate(source.manifest, `${path}.manifest`),
    routeBase: routeBase(source.routeBase, `${path}.routeBase`),
    slotId: identity(source.slotId, `${path}.slotId`)
  })
}

function coordinateKey(coordinate: OpenPencilMicrofrontendManifestCoordinateV1): string {
  return coordinate.kind === 'local' ? `local:${coordinate.path}` : `remote:${coordinate.url}`
}

export function parseOpenPencilMicrofrontendCompositionManifest(
  value: unknown
): OpenPencilMicrofrontendCompositionManifestV1 {
  const source = parseExactManifestRecord(
    value,
    'microfrontendComposition',
    COMPOSITION_MANIFEST_KEYS
  )
  if (source.format !== OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT) {
    throw new TypeError(
      `microfrontendComposition.format must be ${OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT}`
    )
  }
  if (source.schemaVersion !== OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION) {
    throw new TypeError(
      `microfrontendComposition.schemaVersion must be ${OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION}`
    )
  }
  if (source.abi !== OPENPENCIL_MICROFRONTEND_ABI_V1) {
    throw new TypeError(`microfrontendComposition.abi must be ${OPENPENCIL_MICROFRONTEND_ABI_V1}`)
  }
  const slots = Object.freeze(
    parseBoundedManifestArray(
      source.slots,
      'microfrontendComposition.slots',
      OPENPENCIL_MICROFRONTEND_LIMITS.maxSlots
    ).map((entry, index) => slot(entry, `microfrontendComposition.slots[${index}]`))
  )
  if (slots.length === 0) {
    throw new TypeError('microfrontendComposition.slots must contain at least one slot')
  }
  const slotIds = slots.map((entry) => entry.id)
  if (new Set(slotIds).size !== slotIds.length) {
    throw new TypeError('microfrontendComposition.slots ids must be unique')
  }
  const apps = Object.freeze(
    parseBoundedManifestArray(
      source.apps,
      'microfrontendComposition.apps',
      OPENPENCIL_MICROFRONTEND_LIMITS.maxApps
    ).map((entry, index) => compositionApp(entry, `microfrontendComposition.apps[${index}]`))
  )
  if (apps.length === 0) {
    throw new TypeError('microfrontendComposition.apps must contain at least one app')
  }
  const appIds = apps.map((entry) => entry.appId)
  if (new Set(appIds).size !== appIds.length) {
    throw new TypeError('microfrontendComposition.apps appId values must be unique')
  }
  const coordinates = apps.map((entry) => coordinateKey(entry.manifest))
  if (new Set(coordinates).size !== coordinates.length) {
    throw new TypeError('microfrontendComposition.apps manifest coordinates must be unique')
  }
  const knownSlots = new Set(slotIds)
  for (const entry of apps) {
    if (!knownSlots.has(entry.slotId)) {
      throw new TypeError(
        `microfrontendComposition app ${entry.appId} references unknown slot ${entry.slotId}`
      )
    }
  }
  const slotRoutes = apps.map((entry) => `${entry.slotId}\u0000${entry.routeBase}`)
  if (new Set(slotRoutes).size !== slotRoutes.length) {
    throw new TypeError(
      'microfrontendComposition.apps may not repeat a routeBase within the same slot'
    )
  }
  const parsed = Object.freeze({
    format: OPENPENCIL_MICROFRONTEND_COMPOSITION_FORMAT,
    schemaVersion: OPENPENCIL_MICROFRONTEND_COMPOSITION_SCHEMA_VERSION,
    abi: OPENPENCIL_MICROFRONTEND_ABI_V1,
    composition: compositionIdentity(source.composition, 'microfrontendComposition.composition'),
    slots,
    apps
  })
  assertCanonicalByteLength(
    parsed,
    'microfrontendComposition',
    OPENPENCIL_MICROFRONTEND_LIMITS.maxCompositionManifestJsonBytes
  )
  return parsed
}

function parseBoundedJSON(text: string, path: string, maximum: number): unknown {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > maximum) {
    throw new TypeError(`${path} must be bounded JSON text no greater than ${maximum} bytes`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new TypeError(`${path} must be valid JSON text`)
  }
}

export function parseOpenPencilMicrofrontendRuntimeManifestJSON(
  text: string
): OpenPencilMicrofrontendRuntimeManifestV1 {
  return parseOpenPencilMicrofrontendRuntimeManifest(
    parseBoundedJSON(
      text,
      'microfrontendManifest',
      OPENPENCIL_MICROFRONTEND_LIMITS.maxRuntimeManifestJsonBytes
    )
  )
}

export function parseOpenPencilMicrofrontendCompositionManifestJSON(
  text: string
): OpenPencilMicrofrontendCompositionManifestV1 {
  return parseOpenPencilMicrofrontendCompositionManifest(
    parseBoundedJSON(
      text,
      'microfrontendComposition',
      OPENPENCIL_MICROFRONTEND_LIMITS.maxCompositionManifestJsonBytes
    )
  )
}

export function serializeOpenPencilMicrofrontendRuntimeManifest(value: unknown): string {
  const parsed = parseOpenPencilMicrofrontendRuntimeManifest(value)
  return `${JSON.stringify(canonicalManifestValue(parsed), null, 2)}\n`
}

export function serializeOpenPencilMicrofrontendCompositionManifest(value: unknown): string {
  const parsed = parseOpenPencilMicrofrontendCompositionManifest(value)
  return `${JSON.stringify(canonicalManifestValue(parsed), null, 2)}\n`
}

/** Deterministic digest helper shared by manifest producers and consumers. */
export function microfrontendSha256Base64URL(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return encodeBase64URL(sha256(bytes))
}
