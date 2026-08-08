export const REMOTE_PLUGIN_TRANSPORT_LIMITS = Object.freeze({
  maxUrlLength: 2_048,
  maxCatalogBytes: 1_048_576,
  maxMarketplaceBytes: 4 * 1024 * 1024,
  maxManifestBytes: 262_144,
  maxRuntimeIndexBytes: 1024 * 1024,
  maxRuntimePackageBytes: 3 * 1024 * 1024,
  timeoutMs: 10_000
})

export interface RemotePluginCacheValidators {
  etag?: string
  lastModified?: string
}

export type RemotePluginJsonResponse =
  | Readonly<{
      status: 'not-modified'
      url: string
      etag: string | null
      lastModified: string | null
    }>
  | Readonly<{
      status: 'fresh'
      url: string
      json: unknown
      rawJson: string
      etag: string | null
      lastModified: string | null
    }>

export interface CreateRemotePluginTransportOptions {
  fetchImpl?: typeof globalThis.fetch
  allowLoopbackHttp?: boolean
  timeoutMs?: number
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '[::1]' ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  )
}

export function parseRemotePluginUrl(
  value: string,
  options: { allowLoopbackHttp?: boolean } = {}
): URL {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Remote plugin URL must be a non-empty string')
  }
  if (value.length > REMOTE_PLUGIN_TRANSPORT_LIMITS.maxUrlLength) {
    throw new TypeError('Remote plugin URL exceeds the length limit')
  }
  const url = new URL(value)
  const loopbackHttp =
    options.allowLoopbackHttp === true &&
    url.protocol === 'http:' &&
    isLoopbackHostname(url.hostname)
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new TypeError('Remote plugin URLs must use HTTPS')
  }
  if (url.username || url.password) {
    throw new TypeError('Remote plugin URLs must not contain credentials')
  }
  if (url.hash) throw new TypeError('Remote plugin URLs must not contain a fragment')
  return url
}

function jsonContentType(response: Response): boolean {
  const value = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return (
    value === 'application/json' ||
    Boolean(value?.startsWith('application/') && value.endsWith('+json'))
  )
}

async function boundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const announced = Number(response.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new Error(`Remote plugin response exceeds the ${maxBytes} byte limit`)
  }
  const chunks: Uint8Array[] = []
  let length = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      length += result.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error(`Remote plugin response exceeds the ${maxBytes} byte limit`)
      }
      chunks.push(result.value)
    }
  } else {
    const value = new Uint8Array(await response.arrayBuffer())
    length = value.byteLength
    chunks.push(value)
  }
  if (length > maxBytes) {
    throw new Error(`Remote plugin response exceeds the ${maxBytes} byte limit`)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function conditionalHeaders(validators: RemotePluginCacheValidators): Headers {
  const headers = new Headers({ accept: 'application/json' })
  if (validators.etag) headers.set('if-none-match', validators.etag)
  if (validators.lastModified) headers.set('if-modified-since', validators.lastModified)
  return headers
}

export function createRemotePluginTransport(options: CreateRemotePluginTransportOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? REMOTE_PLUGIN_TRANSPORT_LIMITS.timeoutMs
  const urlOptions = { allowLoopbackHttp: options.allowLoopbackHttp }

  async function loadJson(
    urlValue: string,
    maxBytes: number,
    validators: RemotePluginCacheValidators = {}
  ): Promise<RemotePluginJsonResponse> {
    const requestedUrl = parseRemotePluginUrl(urlValue, urlOptions)
    const response = await fetchImpl(requestedUrl, {
      method: 'GET',
      headers: conditionalHeaders(validators),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    })
    const finalUrl = parseRemotePluginUrl(response.url || requestedUrl.href, urlOptions)
    if (response.url && finalUrl.href !== requestedUrl.href) {
      throw new Error('Remote plugin source redirects are not allowed')
    }
    const metadata = {
      url: finalUrl.href,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    }
    if (response.status === 304) return { status: 'not-modified', ...metadata }
    if (!response.ok) throw new Error(`Remote plugin source returned HTTP ${response.status}`)
    if (!jsonContentType(response)) {
      throw new Error('Remote plugin source must return an application/json content type')
    }
    const rawJson = await boundedResponseText(response, maxBytes)
    let json: unknown
    try {
      json = JSON.parse(rawJson)
    } catch {
      throw new Error('Remote plugin source returned invalid JSON')
    }
    return { status: 'fresh', ...metadata, rawJson, json }
  }

  return {
    loadCatalog: (url: string, validators: RemotePluginCacheValidators = {}) =>
      loadJson(url, REMOTE_PLUGIN_TRANSPORT_LIMITS.maxCatalogBytes, validators),
    loadMarketplace: (url: string, validators: RemotePluginCacheValidators = {}) =>
      loadJson(url, REMOTE_PLUGIN_TRANSPORT_LIMITS.maxMarketplaceBytes, validators),
    loadRuntimeIndex: (url: string, validators: RemotePluginCacheValidators = {}) =>
      loadJson(url, REMOTE_PLUGIN_TRANSPORT_LIMITS.maxRuntimeIndexBytes, validators),
    loadRuntimePackage: (url: string, validators: RemotePluginCacheValidators = {}) =>
      loadJson(url, REMOTE_PLUGIN_TRANSPORT_LIMITS.maxRuntimePackageBytes, validators),
    loadManifest: (url: string, validators: RemotePluginCacheValidators = {}) =>
      loadJson(url, REMOTE_PLUGIN_TRANSPORT_LIMITS.maxManifestBytes, validators)
  }
}
