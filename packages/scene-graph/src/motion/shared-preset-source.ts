import {
  SHARED_MOTION_PRESET_LIMITS,
  parseSharedMotionPresetManifestJSON,
  type SharedMotionPresetManifest,
  type SharedMotionPresetSource
} from './shared-presets'

export interface SharedMotionPresetFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface SharedMotionPresetSourceDependencies {
  readonly readFile?: (ref: string, maxBytes: number) => Promise<Uint8Array>
  readonly fetchUrl?: (ref: string, maxBytes: number) => Promise<SharedMotionPresetFetchResponse>
}

export class SharedMotionPresetSourceError extends Error {
  constructor(
    readonly source: SharedMotionPresetSource,
    detail: string,
    options?: ErrorOptions
  ) {
    super(
      `Unable to read shared motion preset ${source.kind} source "${source.ref}": ${detail}`,
      options
    )
    this.name = 'SharedMotionPresetSourceError'
  }
}

function sourceError(
  source: SharedMotionPresetSource,
  detail: string,
  cause?: unknown
): SharedMotionPresetSourceError {
  return new SharedMotionPresetSourceError(
    source,
    detail,
    cause === undefined ? undefined : { cause }
  )
}

function assertSize(source: SharedMotionPresetSource, size: number): void {
  if (
    !Number.isFinite(size) ||
    size < 0 ||
    size > SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes
  ) {
    throw sourceError(
      source,
      `content may not exceed ${SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes} bytes`
    )
  }
}

function decode(source: SharedMotionPresetSource, bytes: Uint8Array): string {
  assertSize(source, bytes.byteLength)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw sourceError(source, 'content is not valid UTF-8', cause)
  }
}

function canonicalSource(source: SharedMotionPresetSource): SharedMotionPresetSource {
  if (source.kind === 'file') return { ...source }
  let url: URL
  try {
    url = new URL(source.ref)
  } catch (cause) {
    throw sourceError(source, 'expected an absolute HTTP(S) URL', cause)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw sourceError(source, 'expected an HTTP(S) URL without embedded credentials')
  }
  return { kind: 'url', ref: url.toString() }
}

async function fileBytes(
  source: SharedMotionPresetSource & { kind: 'file' },
  dependencies: SharedMotionPresetSourceDependencies
): Promise<Uint8Array> {
  if (!dependencies.readFile) throw sourceError(source, 'file access is unavailable')
  try {
    return await dependencies.readFile(source.ref, SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes)
  } catch (cause) {
    if (cause instanceof SharedMotionPresetSourceError) throw cause
    throw sourceError(source, cause instanceof Error ? cause.message : String(cause), cause)
  }
}

async function urlBytes(
  source: SharedMotionPresetSource & { kind: 'url' },
  dependencies: SharedMotionPresetSourceDependencies
): Promise<Uint8Array> {
  if (!dependencies.fetchUrl) throw sourceError(source, 'network access is unavailable')
  let response: SharedMotionPresetFetchResponse
  try {
    response = await dependencies.fetchUrl(
      source.ref,
      SHARED_MOTION_PRESET_LIMITS.maxManifestJsonBytes
    )
  } catch (cause) {
    throw sourceError(
      source,
      `network request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause
    )
  }
  if (!response.ok) {
    throw sourceError(
      source,
      `server returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    )
  }
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) assertSize(source, Number(contentLength))
  try {
    return new Uint8Array(await response.arrayBuffer())
  } catch (cause) {
    throw sourceError(source, cause instanceof Error ? cause.message : String(cause), cause)
  }
}

function assertDeclaredSource(
  requested: SharedMotionPresetSource,
  manifest: SharedMotionPresetManifest
): void {
  if (manifest.source.kind === requested.kind && manifest.source.ref === requested.ref) return
  throw sourceError(
    requested,
    `manifest declares ${manifest.source.kind} source "${manifest.source.ref}"`
  )
}

/** Load one bounded manifest. Callers inject platform-specific file and URL transports. */
export async function loadSharedMotionPresetManifestSource(
  sourceValue: SharedMotionPresetSource,
  dependencies: SharedMotionPresetSourceDependencies
): Promise<SharedMotionPresetManifest> {
  const source = canonicalSource(sourceValue)
  const bytes =
    source.kind === 'file'
      ? await fileBytes(source, dependencies)
      : await urlBytes(source, dependencies)
  let manifest: SharedMotionPresetManifest
  try {
    manifest = parseSharedMotionPresetManifestJSON(decode(source, bytes))
  } catch (cause) {
    if (cause instanceof SharedMotionPresetSourceError) throw cause
    throw sourceError(source, cause instanceof Error ? cause.message : String(cause), cause)
  }
  assertDeclaredSource(source, manifest)
  return manifest
}
