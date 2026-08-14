/* eslint-disable max-lines -- Remote parsing, transport, and decoding form one fail-closed protocol. */
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { REMOTE_FIG_ARCHIVE_LIMITS } from '@open-pencil/fig'
import { REMOTE_PEN_PARSE_LIMITS } from '@open-pencil/pen'
import {
  encodeBase64URL,
  isPlainJSONObject,
  parseRemoteComponentLibraryDescriptor,
  parseSha256Base64URL,
  REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS,
  REMOTE_COMPONENT_LIBRARY_FORMAT,
  REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION,
  type LibraryManifest,
  type SceneGraph,
  validateLibraryArtifact,
  webCryptoBuffer
} from '@open-pencil/scene-graph'

import {
  abortable,
  createRequestClock,
  noCredentialGetRequest,
  readBoundedStream,
  strictContentLength,
  throwIfAborted
} from '@/app/network/safe-fetch'

export const REMOTE_LIBRARY_LIMITS = Object.freeze({
  maxUrlLength: 2_048,
  maxManifestBytes: 1024 * 1024,
  maxArtifactBytes: 64 * 1024 * 1024,
  ...REMOTE_COMPONENT_LIBRARY_DESCRIPTOR_LIMITS,
  timeoutMs: 30_000
})

export type RemoteLibraryArtifactFormat = 'fig' | 'pen'

export interface RemoteLibraryArtifactDescriptor {
  readonly format: RemoteLibraryArtifactFormat
  readonly mediaType: 'application/octet-stream' | 'application/json'
  readonly byteLength: number
  readonly integrity: Readonly<{
    algorithm: 'SHA-256'
    digest: string
  }>
}

export interface RemoteLibraryManifest extends LibraryManifest {
  readonly format: typeof REMOTE_COMPONENT_LIBRARY_FORMAT
  readonly schemaVersion: typeof REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION
  readonly source: Readonly<{
    kind: 'url'
    ref: string
  }>
  readonly artifact: RemoteLibraryArtifactDescriptor
}

export interface RemoteLibraryCandidate {
  readonly manifestURL: string
  readonly manifest: RemoteLibraryManifest
  readonly sourceGraph: SceneGraph
  readonly artifact: RemoteLibraryArtifactDescriptor & Readonly<{ url: string }>
}

export interface LoadRemoteLibraryCandidateOptions {
  readonly fetchImpl?: typeof globalThis.fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly allowLoopbackHttp?: boolean
}

type RemoteLibraryURLOptions = Pick<LoadRemoteLibraryCandidateOptions, 'allowLoopbackHttp'>
type JSONRecord = Record<string, unknown>

const io = new IORegistry(BUILTIN_IO_FORMATS)
const SPECIAL_USE_SUFFIXES = new Set([
  'alt',
  'arpa',
  'example',
  'home',
  'internal',
  'invalid',
  'lan',
  'local',
  'localhost',
  'onion',
  'test'
])
const ARTIFACT_MEDIA_TYPES = Object.freeze({
  fig: 'application/octet-stream',
  pen: 'application/json'
} as const)

export function parseRemoteLibraryURL(value: string, options: RemoteLibraryURLOptions = {}): URL {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Remote library URL must be a non-empty string')
  }
  if (value.length > REMOTE_LIBRARY_LIMITS.maxUrlLength) {
    throw new TypeError('Remote library URL exceeds the length limit')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Remote library URL must be an absolute URL')
  }

  const loopbackHttp =
    options.allowLoopbackHttp === true &&
    url.protocol === 'http:' &&
    isLoopbackHostname(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new TypeError('Remote library URLs must use HTTPS')
  }
  if (url.username || url.password) {
    throw new TypeError('Remote library URLs must not contain credentials')
  }
  if (url.href.includes('#')) {
    throw new TypeError('Remote library URLs must not contain a fragment')
  }
  if (url.href.includes('?')) {
    throw new TypeError('Remote library URLs must not contain a query')
  }
  if (!loopbackHttp && url.port !== '') {
    throw new TypeError('Remote library HTTPS URLs must use port 443')
  }
  if (!loopbackHttp) assertPublicHostname(url.hostname)
  if (url.href !== value) {
    throw new TypeError('Remote library URL must use its canonical spelling')
  }
  return url
}

export function parseRemoteLibraryManifestText(
  text: string,
  options: RemoteLibraryURLOptions = {}
): RemoteLibraryManifest {
  if (typeof text !== 'string') throw new TypeError('Remote library manifest must be text')
  if (new TextEncoder().encode(text).byteLength > REMOTE_LIBRARY_LIMITS.maxManifestBytes) {
    throw new Error('Remote library manifest exceeds the byte limit')
  }

  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new Error('Remote library manifest is not valid JSON')
  }
  const manifest = exactRecord(
    value,
    ['format', 'schemaVersion', 'libraryId', 'name', 'components', 'source', 'artifact'],
    'manifest'
  )
  if (manifest.format !== REMOTE_COMPONENT_LIBRARY_FORMAT) {
    throw new TypeError(`manifest.format must be ${REMOTE_COMPONENT_LIBRARY_FORMAT}`)
  }
  if (manifest.schemaVersion !== REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION) {
    throw new TypeError(`manifest.schemaVersion must be ${REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION}`)
  }

  const descriptor = parseRemoteComponentLibraryDescriptor(manifest, 'manifest', {
    allowExtraKeys: true
  })

  const source = exactRecord(manifest.source, ['kind', 'ref'], 'manifest.source')
  if (source.kind !== 'url') throw new TypeError('manifest.source.kind must be url')
  const artifactURL = parseRemoteLibraryURL(
    nonEmptyString(source.ref, 'manifest.source.ref'),
    options
  ).href

  const artifact = exactRecord(
    manifest.artifact,
    ['format', 'mediaType', 'byteLength', 'integrity'],
    'manifest.artifact'
  )
  const artifactFormat = parseArtifactFormat(artifact.format)
  const maxArtifactBytes = artifactByteLimit(artifactFormat)
  const expectedMediaType = ARTIFACT_MEDIA_TYPES[artifactFormat]
  if (!artifactURLPathMatchesFormat(artifactURL, artifactFormat)) {
    throw new TypeError(`manifest.source.ref pathname must end in .${artifactFormat}`)
  }
  if (artifact.mediaType !== expectedMediaType) {
    throw new TypeError(
      `manifest.artifact.mediaType must be ${expectedMediaType} for ${artifactFormat}`
    )
  }
  if (
    !Number.isSafeInteger(artifact.byteLength) ||
    (artifact.byteLength as number) < 1 ||
    (artifact.byteLength as number) > maxArtifactBytes
  ) {
    throw new TypeError(
      `manifest.artifact.byteLength must be an integer from 1 to ${maxArtifactBytes} for ${artifactFormat}`
    )
  }
  const integrity = exactRecord(
    artifact.integrity,
    ['algorithm', 'digest'],
    'manifest.artifact.integrity'
  )
  if (integrity.algorithm !== 'SHA-256') {
    throw new TypeError('manifest.artifact.integrity.algorithm must be SHA-256')
  }

  return {
    format: REMOTE_COMPONENT_LIBRARY_FORMAT,
    schemaVersion: REMOTE_COMPONENT_LIBRARY_SCHEMA_VERSION,
    ...descriptor,
    source: { kind: 'url', ref: artifactURL },
    artifact: {
      format: artifactFormat,
      mediaType: expectedMediaType,
      byteLength: artifact.byteLength as number,
      integrity: {
        algorithm: 'SHA-256',
        digest: parseSha256Base64URL(integrity.digest, 'manifest.artifact.integrity.digest')
      }
    }
  }
}

export async function loadRemoteLibraryCandidate(
  manifestURLValue: string,
  options: LoadRemoteLibraryCandidateOptions = {}
): Promise<RemoteLibraryCandidate> {
  const urlOptions = { allowLoopbackHttp: options.allowLoopbackHttp }
  const manifestURL = parseRemoteLibraryURL(manifestURLValue, urlOptions)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available')
  const clock = requestClock(options.signal, options.timeoutMs)

  try {
    throwIfAborted(clock.signal)
    const manifestResponse = await abortable(
      fetchImpl(manifestURL, noCredentialGetRequest('application/json', clock.signal)),
      clock.signal
    )
    const manifestBytes = await validatedResponseBytes({
      response: manifestResponse,
      requestedURL: manifestURL,
      expectedMediaType: 'application/json',
      allowStructuredJSON: true,
      maxBytes: REMOTE_LIBRARY_LIMITS.maxManifestBytes,
      signal: clock.signal,
      urlOptions,
      label: 'Remote library manifest'
    })
    const manifestText = decodeUTF8(manifestBytes, 'Remote library manifest')
    const manifest = parseRemoteLibraryManifestText(manifestText, urlOptions)
    const artifactURL = parseRemoteLibraryURL(manifest.source.ref, urlOptions)
    if (artifactURL.origin !== manifestURL.origin) {
      throw new Error('Remote library manifest and artifact must use the same origin')
    }

    throwIfAborted(clock.signal)
    const artifactResponse = await abortable(
      fetchImpl(artifactURL, noCredentialGetRequest(manifest.artifact.mediaType, clock.signal)),
      clock.signal
    )
    const artifactBytes = await validatedResponseBytes({
      response: artifactResponse,
      requestedURL: artifactURL,
      expectedMediaType: manifest.artifact.mediaType,
      allowStructuredJSON: false,
      maxBytes: Math.min(manifest.artifact.byteLength, artifactByteLimit(manifest.artifact.format)),
      expectedLength: manifest.artifact.byteLength,
      signal: clock.signal,
      urlOptions,
      label: 'Remote library artifact'
    })
    if (artifactBytes.byteLength !== manifest.artifact.byteLength) {
      throw new Error(
        `Remote library artifact length mismatch: expected ${manifest.artifact.byteLength}, received ${artifactBytes.byteLength}`
      )
    }
    const digest = await sha256Base64URL(artifactBytes)
    throwIfAborted(clock.signal)
    if (digest !== manifest.artifact.integrity.digest) {
      throw new Error('Remote library artifact SHA-256 digest does not match the manifest')
    }

    throwIfAborted(clock.signal)
    const { graph: sourceGraph } = await io.readDocumentAs(
      manifest.artifact.format,
      {
        name: `remote-library.${manifest.artifact.format}`,
        mimeType: manifest.artifact.mediaType,
        data: artifactBytes
      },
      manifest.artifact.format === 'fig'
        ? {
            populate: 'all',
            archiveLimits: REMOTE_FIG_ARCHIVE_LIMITS,
            signal: clock.signal,
            allowMainThreadFallback: false
          }
        : {
            populate: 'all',
            penLimits: REMOTE_PEN_PARSE_LIMITS,
            signal: clock.signal,
            allowMainThreadFallback: false
          }
    )
    throwIfAborted(clock.signal)

    const validation = validateLibraryArtifact(sourceGraph, manifest)
    if (!validation.ok) {
      throw new Error(
        `Remote library artifact does not match its manifest: ${validation.issues
          .map((issue) => issue.message)
          .join('; ')}`
      )
    }

    return {
      manifestURL: manifestURL.href,
      manifest,
      sourceGraph,
      artifact: { url: artifactURL.href, ...manifest.artifact }
    }
  } finally {
    clock.dispose()
  }
}

interface ValidatedResponseOptions {
  response: Response
  requestedURL: URL
  expectedMediaType: string
  allowStructuredJSON: boolean
  maxBytes: number
  expectedLength?: number
  signal: AbortSignal
  urlOptions: RemoteLibraryURLOptions
  label: string
}

async function validatedResponseBytes(options: ValidatedResponseOptions): Promise<Uint8Array> {
  const { response, requestedURL, signal, label } = options
  try {
    throwIfAborted(signal)
    if (!response.url) throw new Error(`${label} response did not expose its final URL`)
    const responseURL = parseRemoteLibraryURL(response.url, options.urlOptions)
    if (responseURL.href !== requestedURL.href) {
      throw new Error(`${label} redirects are not allowed`)
    }
    if (response.status !== 200) throw new Error(`${label} returned HTTP ${response.status}`)

    const mediaType = responseMediaType(response)
    const validMediaType = options.allowStructuredJSON
      ? mediaType === options.expectedMediaType || isStructuredJSONMediaType(mediaType)
      : mediaType === options.expectedMediaType
    if (!validMediaType) {
      throw new Error(`${label} must return ${options.expectedMediaType}`)
    }
    return await readBoundedBody(response, options.maxBytes, signal, label, options.expectedLength)
  } catch (error) {
    await cancelUnusedResponse(response, error)
    throw error
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  label: string,
  expectedLength?: number
): Promise<Uint8Array> {
  const announcedLength = strictContentLength(response.headers.get('content-length'), label)
  const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase()
  const identityEncoded = !contentEncoding || contentEncoding === 'identity'
  if (identityEncoded && announcedLength !== undefined && announcedLength > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes} byte limit`)
  }
  if (
    identityEncoded &&
    announcedLength !== undefined &&
    expectedLength !== undefined &&
    announcedLength !== expectedLength
  ) {
    throw new Error(
      `${label} length mismatch: expected ${expectedLength}, received ${announcedLength}`
    )
  }
  throwIfAborted(signal)

  if (!response.body) {
    const bytes = new Uint8Array(await abortable(response.arrayBuffer(), signal))
    if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte limit`)
    return bytes
  }

  return readBoundedStream(response.body, maxBytes, signal, label)
}

function requestClock(callerSignal: AbortSignal | undefined, timeoutMsValue: number | undefined) {
  const timeoutMs = timeoutMsValue ?? REMOTE_LIBRARY_LIMITS.timeoutMs
  return createRequestClock({
    callerSignal,
    timeoutMs,
    maximumTimeoutMs: 120_000,
    label: 'Remote library'
  })
}

function exactRecord(value: unknown, keys: readonly string[], path: string): JSONRecord {
  if (!isPlainJSONObject(value)) throw new TypeError(`${path} must be an object`)
  const missingKeys = new Set(keys)
  for (const key of Object.keys(value)) {
    if (!missingKeys.delete(key)) {
      throw new TypeError(`${path} must contain exactly: ${keys.join(', ')}`)
    }
  }
  if (missingKeys.size > 0) {
    throw new TypeError(`${path} must contain exactly: ${keys.join(', ')}`)
  }
  return value
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value
}

function parseArtifactFormat(value: unknown): RemoteLibraryArtifactFormat {
  if (value !== 'fig' && value !== 'pen') {
    throw new TypeError('manifest.artifact.format must be fig or pen')
  }
  return value
}

function artifactURLPathMatchesFormat(url: string, format: RemoteLibraryArtifactFormat): boolean {
  return new URL(url).pathname.toLowerCase().endsWith(`.${format}`)
}

function artifactByteLimit(format: RemoteLibraryArtifactFormat): number {
  return format === 'pen'
    ? REMOTE_PEN_PARSE_LIMITS.maxBytes
    : REMOTE_LIBRARY_LIMITS.maxArtifactBytes
}

function assertPublicHostname(hostname: string): void {
  const normalized = hostname.toLowerCase()
  if (normalized.endsWith('.')) {
    throw new TypeError('Remote library URL hostname must not have a trailing dot')
  }
  if (isIPLiteral(normalized)) {
    throw new TypeError('Remote library URL must not use an IP literal')
  }
  const labels = normalized.split('.')
  if (labels.length < 2) {
    throw new TypeError('Remote library URL hostname must be a public multi-label name')
  }
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-') ||
        !/^[a-z0-9-]+$/.test(label)
    )
  ) {
    throw new TypeError('Remote library URL hostname is invalid')
  }
  if (labels.some((label) => label.startsWith('xn--'))) {
    throw new TypeError('Remote library URL must not use punycode hostnames')
  }
  const suffix = labels.at(-1) as string
  if (SPECIAL_USE_SUFFIXES.has(suffix)) {
    throw new TypeError('Remote library URL must not use a special-use hostname')
  }
  if (/^\d+$/.test(suffix)) {
    throw new TypeError('Remote library URL hostname must have a non-numeric suffix')
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '[::1]' || normalized === '::1') return true
  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

function isIPLiteral(hostname: string): boolean {
  if (hostname.includes(':') || (hostname.startsWith('[') && hostname.endsWith(']'))) return true
  const octets = hostname.split('.')
  return (
    octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

function responseMediaType(response: Response): string {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function isStructuredJSONMediaType(value: string): boolean {
  return value.startsWith('application/') && value.endsWith('+json')
}

function decodeUTF8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${label} must contain valid UTF-8`)
  }
}

async function sha256Base64URL(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', webCryptoBuffer(bytes))
  return encodeBase64URL(new Uint8Array(digest))
}

async function cancelUnusedResponse(response: Response, reason: unknown): Promise<void> {
  if (!response.body || response.bodyUsed) return
  await response.body.cancel(reason).catch(() => undefined)
}
