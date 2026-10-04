import { LOTTIE_MODULE_LIMITS } from '@open-pencil/core/plugins'

/** The exact expression-free Lottie Web version emitted projects install. */
export const LOTTIE_WEB_VERSION = '5.13.0'

/** Vue authored payloads use as-const; React keeps its established generated type text. */
export function buildLottieConfigSource(readonlyLayers = false): string {
  return `type LottieSource = 'url' | 'json'
type LottieDirection = 'forward' | 'reverse'
type LottieFit = 'contain' | 'cover' | 'fill'
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface OpenPencilLottieData {
  [key: string]: unknown
  v: string
  fr: number
  ip: number
  op: number
  w: number
  h: number
  layers: ${readonlyLayers ? 'readonly ' : ''}unknown[]
}

export interface OpenPencilLottieConfig {
  source: LottieSource
  url: string
  data: OpenPencilLottieData
  autoplay: boolean
  loop: boolean
  speed: number
  direction: LottieDirection
  fit: LottieFit
}

`
}

export const LOTTIE_CONFIG_SOURCE = buildLottieConfigSource()

export function buildLottieSafetySource(): string {
  const limits = JSON.stringify({
    url: LOTTIE_MODULE_LIMITS.url,
    dataBytes: LOTTIE_MODULE_LIMITS.dataBytes,
    dataDepth: LOTTIE_MODULE_LIMITS.dataDepth,
    dataEntries: LOTTIE_MODULE_LIMITS.dataEntries,
    dataArrayItems: LOTTIE_MODULE_LIMITS.dataArrayItems,
    dataString: LOTTIE_MODULE_LIMITS.dataString,
    layers: LOTTIE_MODULE_LIMITS.layers,
    assets: LOTTIE_MODULE_LIMITS.assets,
    dimension: LOTTIE_MODULE_LIMITS.dimension,
    frameRate: LOTTIE_MODULE_LIMITS.frameRate,
    durationSeconds: LOTTIE_MODULE_LIMITS.durationSeconds,
    speedMin: LOTTIE_MODULE_LIMITS.speedMin,
    speedMax: LOTTIE_MODULE_LIMITS.speedMax,
    fetchTimeoutMs: 5_000
  })
  return `interface ValidationBudget {
  entries: number
  arrayItems: number
  seen: WeakSet<object>
}

interface NetworkRequest {
  url: string
  nonce: number
}

const LIMITS = ${limits} as const
const DATA_KEYS = new Set([
  'v', 'fr', 'ip', 'op', 'w', 'h', 'nm', 'ddd', 'assets', 'layers',
  'fonts', 'chars', 'markers', 'meta'
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const LOCAL_HOSTNAMES = new Set(['localhost', 'localdomain', 'home.arpa'])
const LOCAL_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.localdomain', '.home.arpa']
const VERSION = /^\\d+(?:\\.\\d+){1,3}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateJsonValue(
  value: unknown,
  path: string,
  depth: number,
  budget: ValidationBudget
): void {
  if (depth > LIMITS.dataDepth) throw new TypeError(path + ' exceeds the Lottie JSON depth limit')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(path + ' must be finite')
    return
  }
  if (typeof value === 'string') {
    if (value.length > LIMITS.dataString) throw new TypeError(path + ' is too long')
    return
  }
  if (typeof value !== 'object') throw new TypeError(path + ' contains a non-JSON value')
  if (budget.seen.has(value)) throw new TypeError(path + ' contains a circular reference')
  budget.seen.add(value)

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value)
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.some((key) =>
        typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\\d*)$/.test(key))
      )
    ) throw new TypeError(path + ' must be a dense JSON array')
    budget.arrayItems += value.length
    if (budget.arrayItems > LIMITS.dataArrayItems) throw new TypeError(path + ' has too many items')
    value.forEach((item, index) => validateJsonValue(item, path + '[' + index + ']', depth + 1, budget))
    return
  }

  if (!isPlainObject(value)) throw new TypeError(path + ' must be a plain JSON object')
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError(path + ' has symbol keys')
  budget.entries += keys.length
  if (budget.entries > LIMITS.dataEntries) throw new TypeError(path + ' has too many entries')
  for (const key of keys as string[]) {
    if (UNSAFE_KEYS.has(key)) throw new TypeError(path + ' contains an unsafe key')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(path + '.' + key + ' must be an enumerable data property')
    }
    validateJsonValue(descriptor.value, path + '.' + key, depth + 1, budget)
  }
}

function rejectExpressions(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectExpressions(item, path + '[' + index + ']'))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (key === 'x' && typeof child === 'string' && child.trim() !== '') {
      throw new TypeError(path + '.' + key + ' contains an unsupported expression')
    }
    rejectExpressions(child, path + '.' + key)
  }
}

function validateLayers(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length > LIMITS.layers) {
    throw new TypeError(path + ' must be a bounded layer array')
  }
  value.forEach((layer, index) => {
    if (!isPlainObject(layer)) throw new TypeError(path + '[' + index + '] must be an object')
    if (layer.ty === 2) throw new TypeError(path + '[' + index + '] uses an image layer')
    if (layer.ty === 6) throw new TypeError(path + '[' + index + '] uses an audio layer')
  })
}

function validateAssets(value: unknown): void {
  if (!Array.isArray(value) || value.length > LIMITS.assets) {
    throw new TypeError('lottie data assets must be a bounded array')
  }
  value.forEach((asset, index) => {
    if (!isPlainObject(asset)) throw new TypeError('lottie data asset must be an object')
    if (Object.hasOwn(asset, 'p') || Object.hasOwn(asset, 'u')) {
      throw new TypeError('lottie data asset ' + index + ' requests an image resource')
    }
    if (!Object.hasOwn(asset, 'layers')) {
      throw new TypeError('lottie data asset ' + index + ' is not a vector precomposition')
    }
    validateLayers(asset.layers, 'lottie data.assets[' + index + '].layers')
  })
}

function validateFonts(value: unknown): void {
  if (!isPlainObject(value) || !Array.isArray(value.list)) {
    throw new TypeError('lottie data fonts must contain a list')
  }
  value.list.forEach((font, index) => {
    if (!isPlainObject(font)) throw new TypeError('lottie font ' + index + ' must be an object')
    if (font.fPath !== undefined && font.fPath !== '') {
      throw new TypeError('lottie font ' + index + ' must not load an external font')
    }
  })
}

function validateAnimationData(value: unknown): OpenPencilLottieData {
  validateJsonValue(value, 'lottie data', 0, {
    entries: 0,
    arrayItems: 0,
    seen: new WeakSet()
  })
  if (!isPlainObject(value)) throw new TypeError('lottie data must be an object')
  const unknownKey = Object.keys(value).find((key) => !DATA_KEYS.has(key))
  if (unknownKey) throw new TypeError('unsupported Lottie key: ' + unknownKey)
  if (typeof value.v !== 'string' || !VERSION.test(value.v)) {
    throw new TypeError('lottie data version is invalid')
  }
  if (
    typeof value.fr !== 'number' || !Number.isFinite(value.fr) ||
    value.fr <= 0 || value.fr > LIMITS.frameRate
  ) throw new TypeError('lottie data frame rate is invalid')
  if (typeof value.ip !== 'number' || !Number.isFinite(value.ip)) {
    throw new TypeError('lottie data in point is invalid')
  }
  if (typeof value.op !== 'number' || !Number.isFinite(value.op) || value.op <= value.ip) {
    throw new TypeError('lottie data out point is invalid')
  }
  if ((value.op - value.ip) / value.fr > LIMITS.durationSeconds) {
    throw new TypeError('lottie data duration is too long')
  }
  for (const key of ['w', 'h'] as const) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > LIMITS.dimension) {
      throw new TypeError('lottie data ' + key + ' is invalid')
    }
  }
  validateLayers(value.layers, 'lottie data.layers')
  if (value.assets !== undefined) validateAssets(value.assets)
  if (value.fonts !== undefined) validateFonts(value.fonts)
  if (value.ddd !== undefined && value.ddd !== 0 && value.ddd !== 1) {
    throw new TypeError('lottie data ddd must be 0 or 1')
  }
  rejectExpressions(value, 'lottie data')
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > LIMITS.dataBytes) {
    throw new TypeError('lottie data is too large')
  }
  return structuredClone(value) as OpenPencilLottieData
}

function canonicalPublicHttpsUrl(value: string): string {
  if (value.length === 0 || value.length > LIMITS.url) throw new TypeError('Lottie URL is empty')
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const localHostname =
    hostname.endsWith('.') ||
    LOCAL_HOSTNAMES.has(hostname) ||
    LOCAL_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  const ipv4 = /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(hostname)
  const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
  if (
    url.protocol !== 'https:' || url.username !== '' || url.password !== '' ||
    url.hash !== '' || (url.port !== '' && url.port !== '443') ||
    localHostname || ipv4 || ipv6 || url.href !== value
  ) throw new TypeError('Lottie URL must be canonical public HTTPS')
  return value
}

async function fetchBoundedAnimationData(
  url: string,
  controller: AbortController
): Promise<OpenPencilLottieData> {
  const canonicalUrl = canonicalPublicHttpsUrl(url)
  const timeout = window.setTimeout(() => controller.abort(), LIMITS.fetchTimeoutMs)
  try {
    const response = await fetch(canonicalUrl, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json, application/*+json' },
      mode: 'cors',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    })
    if (!response.ok || response.url !== canonicalUrl) throw new Error('Lottie request failed')
    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (
      mediaType !== 'application/json' &&
      !/^application\\/[a-z0-9!#$&^_.+-]+\\+json$/i.test(mediaType)
    ) throw new Error('Lottie response must be JSON')
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > LIMITS.dataBytes) {
      throw new Error('Lottie response is too large')
    }
    if (!response.body) throw new Error('Lottie response body is unavailable')

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > LIMITS.dataBytes) {
        await reader.cancel()
        throw new Error('Lottie response is too large')
      }
      chunks.push(result.value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return validateAnimationData(JSON.parse(source))
  } finally {
    window.clearTimeout(timeout)
  }
}

function preserveAspectRatio(fit: LottieFit): string {
  if (fit === 'cover') return 'xMidYMid slice'
  if (fit === 'fill') return 'none'
  return 'xMidYMid meet'
}

`
}
