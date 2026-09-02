/* oxlint-disable eslint/max-lines -- One transport owns the complete URL policy, bounded metadata schema, streaming quotas, and cancellation lifecycle. */

import type { WebFontFetch } from '@open-pencil/core/text'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const DEFAULT_MAX_REQUESTS = 64
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024
const MAX_URL_LENGTH = 2_048
const MAX_FONTSOURCE_LIST_BYTES = 1024 * 1024
const MAX_FONTSOURCE_DETAIL_BYTES = 512 * 1024
const MAX_FONTSOURCE_FONTS = 4_096
const MAX_FONTSOURCE_FAMILY_LENGTH = 256
const MAX_FONTSOURCE_SUBSETS = 64
const MAX_FONTSOURCE_WEIGHTS = 16
const MAX_FONTSOURCE_URLS = 1_024
const MAX_UNICODE_RANGE_LENGTH = 8_192
const MAX_UNICODE_RANGE_TOKENS = 256
const FONT_SOURCE_SLUG = /^[a-z\d]+(?:-[a-z\d]+)*$/u
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const FONT_WEIGHT = /^(?:[1-9]\d{0,2}|1000)$/u
const UNICODE_RANGE_TOKEN = /^U\+[A-F\d?]{1,6}(?:-[A-F\d]{1,6})?$/iu
const GOOGLE_FONT_PATH = /^\/s\/[a-z\d_-]+\/v\d+\/[a-z\d_-]+\.(?:otf|ttf|woff2?)$/iu
const FONTSOURCE_ASSET_PATH =
  /^\/fontsource\/fonts\/([a-z\d]+(?:-[a-z\d]+)*)@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/([a-z\d_-]+\.(?:otf|ttf|woff2?))$/iu
const FONTSOURCE_STYLES = ['normal', 'italic'] as const
const FONTSOURCE_FORMATS = ['woff2', 'woff', 'ttf'] as const

type FontsourceStyle = (typeof FONTSOURCE_STYLES)[number]
type FontsourceFormat = (typeof FONTSOURCE_FORMATS)[number]
type MetadataParser<T> = (value: unknown, label: string) => T

interface SanitizedFontsourceMeta {
  id: string
  family: string
  subsets: string[]
  weights: number[]
  styles: FontsourceStyle[]
  defSubset: string
  variable: boolean
}

interface SanitizedFontsourceSubsetVariant {
  url: Partial<Record<FontsourceFormat, string>>
}

type SanitizedFontsourceSubsets = Record<string, SanitizedFontsourceSubsetVariant>
type SanitizedFontsourceStyles = Partial<Record<FontsourceStyle, SanitizedFontsourceSubsets>>
type SanitizedFontsourceVariants = Record<string, SanitizedFontsourceStyles>

interface SanitizedFontsourceDetail {
  id: string
  npmVersion: string
  unicodeRange: Record<string, string>
  variants: SanitizedFontsourceVariants
}

interface FontsourceVariantContext {
  fontsourceId: string
  npmVersion: string
  unicodeRanges: Record<string, string>
  urlCount: number
}

type AllowedURLKind =
  | 'google-metadata'
  | 'google-css'
  | 'google-font'
  | 'fontsource-list'
  | 'fontsource-detail'
  | 'fontsource-variable'
  | 'fontsource-asset'

interface AllowedURL {
  kind: AllowedURLKind
  url: URL
  fontsourceId?: string
}

export type BrowserWebFontFetchErrorCode =
  | 'aborted'
  | 'cors-unavailable'
  | 'invalid-request'
  | 'invalid-response'
  | 'request-limit'
  | 'response-limit'
  | 'timeout'
  | 'total-limit'
  | 'url-not-allowed'

export class BrowserWebFontFetchError extends Error {
  readonly code: BrowserWebFontFetchErrorCode

  constructor(code: BrowserWebFontFetchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrowserWebFontFetchError'
    this.code = code
  }
}

export interface BrowserWebFontFetchOptions {
  /** Injectable for tests. Production callers should leave this unset. */
  fetch?: typeof globalThis.fetch
  /** Cancels every request made by this fetcher, including streamed body reads. */
  signal?: AbortSignal
  timeoutMs?: number
  maxResponseBytes?: number
  maxRequests?: number
  maxTotalBytes?: number
}

interface ResolvedBrowserWebFontFetchOptions {
  fetch: typeof globalThis.fetch
  signal?: AbortSignal
  timeoutMs: number
  maxResponseBytes: number
  maxRequests: number
  maxTotalBytes: number
}

interface CombinedSignal {
  signal: AbortSignal
  didTimeout(): boolean
  cleanup(): void
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }
  return resolved
}

function urlNotAllowed(message: string): never {
  throw new BrowserWebFontFetchError('url-not-allowed', message)
}

function rejectUnexpectedURLParts(url: URL): void {
  if (url.protocol !== 'https:') urlNotAllowed('Web fonts require HTTPS')
  if (url.username || url.password) urlNotAllowed('Credential-bearing font URLs are forbidden')
  if (url.port) urlNotAllowed('Custom ports are forbidden for web fonts')
  if (url.hash) urlNotAllowed('Font URLs must not contain fragments')
  if (url.pathname.includes('%') || url.pathname.includes('\\')) {
    urlNotAllowed('Encoded or backslash font paths are forbidden')
  }
}

function rejectQuery(url: URL): void {
  if (url.search) urlNotAllowed(`Query parameters are forbidden for ${url.hostname}`)
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function validateGoogleCSSQuery(url: URL): void {
  if (!url.searchParams.has('family')) urlNotAllowed('Google Fonts CSS requires a family')
  for (const [key, value] of url.searchParams) {
    // The editor never sends document glyphs in a CDN query. In particular, reject `text` so
    // authored content cannot be disclosed to a font provider.
    if (key !== 'family') urlNotAllowed(`Google Fonts CSS query parameter "${key}" is forbidden`)
    if (!value || value.length > 512 || hasControlCharacters(value)) {
      urlNotAllowed('Google Fonts CSS family is invalid')
    }
  }
}

// oxlint-disable-next-line eslint/complexity -- Keep the complete closed host/path/version allowlist in one auditable dispatcher.
function validateBrowserWebFontURL(rawURL: string): AllowedURL {
  if (!rawURL || rawURL.length > MAX_URL_LENGTH) urlNotAllowed('Font URL length is invalid')
  let url: URL
  try {
    url = new URL(rawURL)
  } catch (cause) {
    throw new BrowserWebFontFetchError('url-not-allowed', 'Font URL is invalid', { cause })
  }
  rejectUnexpectedURLParts(url)

  if (url.hostname === 'fonts.google.com') {
    if (url.pathname !== '/metadata/fonts') urlNotAllowed('Google Fonts path is not allowed')
    rejectQuery(url)
    return { kind: 'google-metadata', url }
  }

  if (url.hostname === 'fonts.googleapis.com') {
    if (url.pathname !== '/css2') urlNotAllowed('Google Fonts CSS path is not allowed')
    validateGoogleCSSQuery(url)
    return { kind: 'google-css', url }
  }

  if (url.hostname === 'fonts.gstatic.com') {
    if (!GOOGLE_FONT_PATH.test(url.pathname)) urlNotAllowed('Google font asset path is not allowed')
    rejectQuery(url)
    return { kind: 'google-font', url }
  }

  if (url.hostname === 'api.fontsource.org') {
    rejectQuery(url)
    if (url.pathname === '/v1/fonts') return { kind: 'fontsource-list', url }
    const detail = /^\/v1\/fonts\/([a-z\d]+(?:-[a-z\d]+)*)$/u.exec(url.pathname)
    if (detail?.[1] && FONT_SOURCE_SLUG.test(detail[1])) {
      return { kind: 'fontsource-detail', url, fontsourceId: detail[1] }
    }
    const variable = /^\/v1\/variable\/([a-z\d]+(?:-[a-z\d]+)*)$/u.exec(url.pathname)
    if (variable?.[1] && FONT_SOURCE_SLUG.test(variable[1])) {
      return { kind: 'fontsource-variable', url, fontsourceId: variable[1] }
    }
    urlNotAllowed('Fontsource API path is not allowed')
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    rejectQuery(url)
    if (url.pathname.includes('@latest/')) {
      urlNotAllowed('Unpinned Fontsource assets are forbidden')
    }
    const match = FONTSOURCE_ASSET_PATH.exec(url.pathname)
    if (!match?.[1] || !match[2] || !EXACT_SEMVER.test(match[2])) {
      urlNotAllowed('Fontsource assets require an exact version and reviewed path')
    }
    return { kind: 'fontsource-asset', url, fontsourceId: match[1] }
  }

  return urlNotAllowed(`Font host "${url.hostname}" is not allowed`)
}

// oxlint-disable-next-line eslint/complexity -- Request fields and the tiny header allowlist are deliberately validated together.
function validateRequestInit(init: RequestInit | undefined): Headers {
  const method = init?.method?.toUpperCase() ?? 'GET'
  if (method !== 'GET') {
    throw new BrowserWebFontFetchError('invalid-request', 'Web font requests must use GET')
  }
  if (init?.body != null) {
    throw new BrowserWebFontFetchError('invalid-request', 'Web font request bodies are forbidden')
  }
  if (init?.credentials != null && init.credentials !== 'omit') {
    throw new BrowserWebFontFetchError('invalid-request', 'Web font requests must omit credentials')
  }
  if (init?.redirect != null && init.redirect !== 'error') {
    throw new BrowserWebFontFetchError('invalid-request', 'Web font redirects are forbidden')
  }
  if (init?.mode != null && init.mode !== 'cors') {
    throw new BrowserWebFontFetchError('invalid-request', 'Web font requests require CORS')
  }

  const headers = new Headers()
  for (const [name, value] of new Headers(init?.headers)) {
    const normalized = name.toLowerCase()
    if (normalized === 'user-agent') {
      // unifont uses a synthetic UA to negotiate formats. Browsers forbid setting it, so use the
      // actual browser UA instead of forwarding a spoofed value.
      continue
    }
    if (normalized === 'accept') {
      if (value.length > 256 || /[\r\n]/u.test(value)) {
        throw new BrowserWebFontFetchError('invalid-request', 'Accept header is invalid')
      }
      headers.set('accept', value)
      continue
    }
    throw new BrowserWebFontFetchError(
      'invalid-request',
      `Web font request header "${name}" is forbidden`
    )
  }
  return headers
}

function combineSignals(
  factorySignal: AbortSignal | undefined,
  requestSignal: AbortSignal | null | undefined,
  timeoutMs: number
): CombinedSignal {
  const controller = new AbortController()
  let timedOut = false
  const sources = [factorySignal, requestSignal].filter(
    (signal): signal is AbortSignal => signal != null
  )
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason)
  }
  const listeners = sources.map((signal) => {
    const listener = () => abort(signal)
    if (signal.aborted) abort(signal)
    else signal.addEventListener('abort', listener, { once: true })
    return { signal, listener }
  })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Web font request timed out', 'TimeoutError'))
  }, timeoutMs)

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer)
      for (const { signal, listener } of listeners) signal.removeEventListener('abort', listener)
    }
  }
}

async function cancelResponseBody(response: Response, reason: unknown): Promise<void> {
  await response.body?.cancel(reason).then(
    () => undefined,
    // Best effort. The owning AbortController is also cancelled on timeout/caller abort.
    () => undefined
  )
}

async function readBoundedResponse(
  response: Response,
  limits: {
    maxResponseBytes: number
    maxTotalBytes: number
    totalBytes: () => number
    account: (byteLength: number) => void
  }
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared != null) {
    if (!/^\d+$/u.test(declared)) {
      await cancelResponseBody(response, 'Invalid Content-Length')
      throw new BrowserWebFontFetchError('invalid-response', 'Content-Length is invalid')
    }
    const byteLength = Number(declared)
    if (!Number.isSafeInteger(byteLength) || byteLength > limits.maxResponseBytes) {
      await cancelResponseBody(response, 'Response limit exceeded')
      throw new BrowserWebFontFetchError('response-limit', 'Web font response is too large')
    }
    if (limits.totalBytes() + byteLength > limits.maxTotalBytes) {
      await cancelResponseBody(response, 'Total limit exceeded')
      throw new BrowserWebFontFetchError('total-limit', 'Web font total byte limit exceeded')
    }
  }

  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let responseBytes = 0
  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      const { value } = chunk
      if (!value.byteLength) {
        chunk = await reader.read()
        continue
      }
      if (responseBytes + value.byteLength > limits.maxResponseBytes) {
        await reader.cancel('Response limit exceeded')
        throw new BrowserWebFontFetchError('response-limit', 'Web font response is too large')
      }
      limits.account(value.byteLength)
      responseBytes += value.byteLength
      chunks.push(value)
      chunk = await reader.read()
    }
  } catch (error) {
    await reader.cancel(error).then(
      () => undefined,
      // The primary quota/abort error is more useful than a secondary stream cancellation error.
      () => undefined
    )
    throw error
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(responseBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidFontsource(message: string): never {
  throw new BrowserWebFontFetchError('invalid-response', message)
}

function parseFontsourceJSON(body: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch (cause) {
    throw new BrowserWebFontFetchError('invalid-response', `${label} is not valid JSON`, { cause })
  }
}

function boundedString(value: unknown, maxLength: number, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    invalidFontsource(`${label} is invalid`)
  }
  return value
}

function fontsourceSlug(value: unknown, label: string): string {
  const slug = boundedString(value, 128, label)
  if (!FONT_SOURCE_SLUG.test(slug)) invalidFontsource(`${label} is invalid`)
  return slug
}

function fontsourceWeight(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000) {
    invalidFontsource(`${label} is invalid`)
  }
  return value as number
}

function fontsourceStyle(value: unknown, label: string): FontsourceStyle {
  if (typeof value !== 'string' || !FONTSOURCE_STYLES.includes(value as FontsourceStyle)) {
    invalidFontsource(`${label} is invalid`)
  }
  return value as FontsourceStyle
}

function boundedUniqueArray<T extends string | number>(
  value: unknown,
  maxLength: number,
  label: string,
  parse: MetadataParser<T>
): T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    invalidFontsource(`${label} is invalid or exceeds its limit`)
  }
  const output: T[] = []
  const seen = new Set<T>()
  for (let index = 0; index < value.length; index++) {
    const entry = parse(value[index], `${label}[${index}]`)
    if (seen.has(entry)) invalidFontsource(`${label} contains duplicates`)
    seen.add(entry)
    output.push(entry)
  }
  return output
}

function encodeFontsource(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function sanitizeFontsourceList(body: Uint8Array): Uint8Array {
  const parsed = parseFontsourceJSON(body, 'Fontsource catalog')
  if (!Array.isArray(parsed) || parsed.length > MAX_FONTSOURCE_FONTS) {
    invalidFontsource('Fontsource catalog is invalid or exceeds its font limit')
  }
  const ids = new Set<string>()
  const families = new Set<string>()
  const output: SanitizedFontsourceMeta[] = []
  for (let index = 0; index < parsed.length; index++) {
    const value = parsed[index]
    if (!isRecord(value)) invalidFontsource(`Fontsource catalog entry ${index} is invalid`)
    const id = fontsourceSlug(value.id, `Fontsource catalog entry ${index} id`)
    const family = boundedString(
      value.family,
      MAX_FONTSOURCE_FAMILY_LENGTH,
      `Fontsource catalog entry ${index} family`
    )
    if (ids.has(id) || families.has(family)) {
      invalidFontsource('Fontsource catalog contains duplicate ids or families')
    }
    ids.add(id)
    families.add(family)
    const subsets = boundedUniqueArray(
      value.subsets,
      MAX_FONTSOURCE_SUBSETS,
      `Fontsource catalog entry ${index} subsets`,
      fontsourceSlug
    )
    const defSubset = fontsourceSlug(
      value.defSubset,
      `Fontsource catalog entry ${index} default subset`
    )
    if (!subsets.includes(defSubset)) {
      invalidFontsource('Fontsource default subset is not declared')
    }
    const weights = boundedUniqueArray(
      value.weights,
      MAX_FONTSOURCE_WEIGHTS,
      `Fontsource catalog entry ${index} weights`,
      fontsourceWeight
    )
    const styles = boundedUniqueArray(
      value.styles,
      FONTSOURCE_STYLES.length,
      `Fontsource catalog entry ${index} styles`,
      fontsourceStyle
    )
    if (typeof value.variable !== 'boolean') {
      invalidFontsource(`Fontsource catalog entry ${index} variable flag is invalid`)
    }
    output.push({ id, family, subsets, weights, styles, defSubset, variable: value.variable })
  }
  return encodeFontsource(output)
}

function pinnedFontsourceAssetURL(
  value: string,
  fontsourceId: string,
  npmVersion: string,
  assetName: string
): string {
  const latestPrefix = `https://cdn.jsdelivr.net/fontsource/fonts/${fontsourceId}@latest/`
  const exactPrefix = `https://cdn.jsdelivr.net/fontsource/fonts/${fontsourceId}@${npmVersion}/`
  const rewritten = value.startsWith(latestPrefix)
    ? `${exactPrefix}${value.slice(latestPrefix.length)}`
    : value
  if (!rewritten.startsWith(exactPrefix)) {
    throw new BrowserWebFontFetchError(
      'invalid-response',
      'Fontsource asset version does not match npmVersion'
    )
  }
  if (rewritten !== `${exactPrefix}${assetName}`) {
    throw new BrowserWebFontFetchError(
      'invalid-response',
      'Fontsource asset path does not match its variant metadata'
    )
  }
  const allowed = validateBrowserWebFontURL(rewritten)
  if (allowed.kind !== 'fontsource-asset' || allowed.fontsourceId !== fontsourceId) {
    throw new BrowserWebFontFetchError(
      'invalid-response',
      'Fontsource returned an unreviewed asset URL'
    )
  }
  return rewritten
}

function sanitizeUnicodeRanges(value: unknown): Record<string, string> {
  if (!isRecord(value)) invalidFontsource('Fontsource unicode ranges are invalid')
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.length > MAX_FONTSOURCE_SUBSETS) {
    invalidFontsource('Fontsource unicode ranges exceed their subset limit')
  }
  const output = Object.create(null) as Record<string, string>
  for (const [rawSubset, rawRange] of entries) {
    const subset = fontsourceSlug(rawSubset, 'Fontsource unicode range subset')
    const range = boundedString(
      rawRange,
      MAX_UNICODE_RANGE_LENGTH,
      `Fontsource unicode range for ${subset}`
    )
    const tokens = range.split(',')
    if (
      tokens.length === 0 ||
      tokens.length > MAX_UNICODE_RANGE_TOKENS ||
      tokens.some((token) => !UNICODE_RANGE_TOKEN.test(token))
    ) {
      invalidFontsource(`Fontsource unicode range for ${subset} is invalid`)
    }
    output[subset] = range
  }
  return output
}

function sanitizeFontsourceURLs(
  value: unknown,
  context: FontsourceVariantContext,
  assetPrefix: string
): Partial<Record<FontsourceFormat, string>> {
  if (!isRecord(value)) invalidFontsource('Fontsource variant URLs are invalid')
  const formats = Object.entries(value)
  if (formats.length === 0 || formats.length > FONTSOURCE_FORMATS.length) {
    invalidFontsource('Fontsource variants exceed their format limit')
  }
  const output: Partial<Record<FontsourceFormat, string>> = Object.create(null)
  for (const [rawFormat, rawURL] of formats) {
    if (!FONTSOURCE_FORMATS.includes(rawFormat as FontsourceFormat)) {
      invalidFontsource('Fontsource variant format is invalid')
    }
    const format = rawFormat as FontsourceFormat
    const url = boundedString(rawURL, MAX_URL_LENGTH, 'Fontsource variant URL')
    context.urlCount++
    if (context.urlCount > MAX_FONTSOURCE_URLS) {
      invalidFontsource('Fontsource variants exceed their URL limit')
    }
    output[format] = pinnedFontsourceAssetURL(
      url,
      context.fontsourceId,
      context.npmVersion,
      `${assetPrefix}.${format}`
    )
  }
  return output
}

function sanitizeFontsourceSubsets(
  value: unknown,
  context: FontsourceVariantContext,
  weight: string,
  style: FontsourceStyle
): SanitizedFontsourceSubsets {
  if (!isRecord(value)) invalidFontsource('Fontsource variant subsets are invalid')
  const subsets = Object.entries(value)
  if (subsets.length === 0 || subsets.length > MAX_FONTSOURCE_SUBSETS) {
    invalidFontsource('Fontsource variants exceed their subset limit')
  }
  const output: SanitizedFontsourceSubsets = Object.create(null)
  for (const [rawSubset, rawVariant] of subsets) {
    const subset = fontsourceSlug(rawSubset, 'Fontsource variant subset')
    if (!Object.hasOwn(context.unicodeRanges, subset)) {
      invalidFontsource('Fontsource variant subset has no unicode range')
    }
    if (!isRecord(rawVariant) || Object.keys(rawVariant).some((key) => key !== 'url')) {
      invalidFontsource('Fontsource subset variant shape is invalid')
    }
    output[subset] = {
      url: sanitizeFontsourceURLs(rawVariant.url, context, `${subset}-${weight}-${style}`)
    }
  }
  return output
}

// Fixed-depth validation only: weight -> style -> subset -> url -> format. Never recursively
// traverse provider-controlled metadata.
function sanitizeFontsourceVariants(
  value: unknown,
  fontsourceId: string,
  npmVersion: string,
  unicodeRanges: Record<string, string>
): SanitizedFontsourceVariants {
  if (!isRecord(value)) invalidFontsource('Fontsource variants are invalid')
  const weights = Object.entries(value)
  if (weights.length === 0 || weights.length > MAX_FONTSOURCE_WEIGHTS) {
    invalidFontsource('Fontsource variants exceed their weight limit')
  }
  const output = Object.create(null) as SanitizedFontsourceVariants
  const context: FontsourceVariantContext = {
    fontsourceId,
    npmVersion,
    unicodeRanges,
    urlCount: 0
  }
  for (const [rawWeight, rawStyles] of weights) {
    if (!FONT_WEIGHT.test(rawWeight) || Number(rawWeight) > 1_000 || !isRecord(rawStyles)) {
      invalidFontsource('Fontsource variant weight is invalid')
    }
    const styles = Object.entries(rawStyles)
    if (styles.length === 0 || styles.length > FONTSOURCE_STYLES.length) {
      invalidFontsource('Fontsource variants exceed their style limit')
    }
    const sanitizedStyles: SanitizedFontsourceStyles = Object.create(null)
    for (const [rawStyle, rawSubsets] of styles) {
      const style = fontsourceStyle(rawStyle, 'Fontsource variant style')
      sanitizedStyles[style] = sanitizeFontsourceSubsets(rawSubsets, context, rawWeight, style)
    }
    output[rawWeight] = sanitizedStyles
  }
  return output
}

function sanitizeFontsourceDetail(body: Uint8Array, expectedId: string): Uint8Array {
  const parsed = parseFontsourceJSON(body, 'Fontsource details')
  if (
    !isRecord(parsed) ||
    parsed.id !== expectedId ||
    typeof parsed.npmVersion !== 'string' ||
    !EXACT_SEMVER.test(parsed.npmVersion)
  ) {
    throw new BrowserWebFontFetchError(
      'invalid-response',
      'Fontsource details require a matching id and exact npmVersion'
    )
  }
  const npmVersion = parsed.npmVersion
  const unicodeRange = sanitizeUnicodeRanges(parsed.unicodeRange)
  const variants = sanitizeFontsourceVariants(parsed.variants, expectedId, npmVersion, unicodeRange)
  const output: SanitizedFontsourceDetail = {
    id: expectedId,
    npmVersion,
    unicodeRange,
    variants
  }
  return encodeFontsource(output)
}

function responseLimit(kind: AllowedURLKind, configured: number): number {
  if (kind === 'fontsource-list') return Math.min(configured, MAX_FONTSOURCE_LIST_BYTES)
  if (kind === 'fontsource-detail') return Math.min(configured, MAX_FONTSOURCE_DETAIL_BYTES)
  return configured
}

function sanitizeFontsourceResponse(
  received: AllowedURL,
  ok: boolean,
  body: Uint8Array
): Uint8Array {
  if (!ok) return body
  if (received.kind === 'fontsource-list') return sanitizeFontsourceList(body)
  if (received.kind !== 'fontsource-detail') return body
  if (!received.fontsourceId) {
    throw new BrowserWebFontFetchError('invalid-response', 'Fontsource id is missing')
  }
  return sanitizeFontsourceDetail(body, received.fontsourceId)
}

function accountSanitizedResponse(
  rawByteLength: number,
  body: Uint8Array,
  maxResponseBytes: number,
  totalBytes: number,
  maxTotalBytes: number
): number {
  if (body.byteLength > maxResponseBytes) {
    throw new BrowserWebFontFetchError(
      'response-limit',
      'Sanitized Fontsource response is too large'
    )
  }
  const addedBytes = Math.max(0, body.byteLength - rawByteLength)
  if (totalBytes + addedBytes > maxTotalBytes) {
    throw new BrowserWebFontFetchError('total-limit', 'Web font total byte limit exceeded')
  }
  return totalBytes + addedBytes
}

function clonedResponse(response: Response, body: Uint8Array, finalURL: URL): Response {
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  headers.set('content-length', String(body.byteLength))
  const noBody = [101, 204, 205, 304].includes(response.status)
  const exactBody = new ArrayBuffer(body.byteLength)
  new Uint8Array(exactBody).set(body)
  const clone = new Response(noBody ? null : exactBody, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
  Object.defineProperty(clone, 'url', { configurable: true, value: finalURL.href })
  Object.defineProperty(clone, 'redirected', {
    configurable: true,
    value: response.redirected
  })
  return clone
}

function fetchError(signal: CombinedSignal, error: unknown): BrowserWebFontFetchError {
  if (error instanceof BrowserWebFontFetchError) return error
  if (signal.didTimeout()) {
    return new BrowserWebFontFetchError('timeout', 'Web font request timed out', { cause: error })
  }
  if (signal.signal.aborted) {
    return new BrowserWebFontFetchError('aborted', 'Web font request was cancelled', {
      cause: error
    })
  }
  return new BrowserWebFontFetchError('invalid-response', 'Web font request failed', {
    cause: error
  })
}

/**
 * Browser-only, credential-free web-font transport shared by the editor and preview workers.
 * Redirects are disabled and every request is checked against a closed CDN/path/version allowlist.
 */
export function createBrowserWebFontFetch(options: BrowserWebFontFetchOptions = {}): WebFontFetch {
  const globalFetch: unknown = Reflect.get(globalThis, 'fetch')
  const fetcher =
    options.fetch ??
    (typeof globalFetch === 'function'
      ? (globalFetch.bind(globalThis) as typeof globalThis.fetch)
      : undefined)
  if (typeof fetcher !== 'function') throw new TypeError('fetch is not available')
  const resolved: ResolvedBrowserWebFontFetchOptions = {
    fetch: fetcher,
    signal: options.signal,
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs'),
    maxResponseBytes: positiveInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes'
    ),
    maxRequests: positiveInteger(options.maxRequests, DEFAULT_MAX_REQUESTS, 'maxRequests'),
    maxTotalBytes: positiveInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, 'maxTotalBytes')
  }

  let requestCount = 0
  let totalBytes = 0

  return async (rawURL, init) => {
    const requested = validateBrowserWebFontURL(rawURL)
    // This endpoint currently omits Access-Control-Allow-Origin. Do not disguise it behind a
    // proxy: browser Google catalogs are unsupported until Google exposes a CORS-safe endpoint.
    if (requested.kind === 'google-metadata') {
      throw new BrowserWebFontFetchError(
        'cors-unavailable',
        'Google Fonts metadata is not available to browser previews because it is not CORS-enabled'
      )
    }
    if (requested.kind === 'fontsource-variable') {
      throw new BrowserWebFontFetchError(
        'url-not-allowed',
        'Variable Fontsource metadata is unsupported in browser previews'
      )
    }
    const headers = validateRequestInit(init)
    if (requestCount >= resolved.maxRequests) {
      throw new BrowserWebFontFetchError('request-limit', 'Web font request limit exceeded')
    }
    requestCount++

    const combined = combineSignals(resolved.signal, init?.signal, resolved.timeoutMs)
    try {
      if (combined.signal.aborted) throw combined.signal.reason
      const response = await resolved.fetch(requested.url.href, {
        method: 'GET',
        headers,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: combined.signal
      })
      if (response.type === 'opaque' || response.status === 0 || !response.url) {
        await cancelResponseBody(response, 'Opaque or unverifiable response')
        throw new BrowserWebFontFetchError(
          'invalid-response',
          'Web font response URL cannot be verified'
        )
      }
      const received = validateBrowserWebFontURL(response.url)
      if (response.redirected || received.url.href !== requested.url.href) {
        await cancelResponseBody(response, 'Redirected response is forbidden')
        throw new BrowserWebFontFetchError(
          'url-not-allowed',
          'Web font redirected responses are forbidden'
        )
      }
      const maxResponseBytes = responseLimit(received.kind, resolved.maxResponseBytes)
      let body = await readBoundedResponse(response, {
        maxResponseBytes,
        maxTotalBytes: resolved.maxTotalBytes,
        totalBytes: () => totalBytes,
        account(byteLength) {
          if (totalBytes + byteLength > resolved.maxTotalBytes) {
            throw new BrowserWebFontFetchError('total-limit', 'Web font total byte limit exceeded')
          }
          totalBytes += byteLength
        }
      })
      const rawByteLength = body.byteLength
      body = sanitizeFontsourceResponse(received, response.ok, body)
      totalBytes = accountSanitizedResponse(
        rawByteLength,
        body,
        maxResponseBytes,
        totalBytes,
        resolved.maxTotalBytes
      )
      return clonedResponse(response, body, received.url)
    } catch (error) {
      throw fetchError(combined, error)
    } finally {
      combined.cleanup()
    }
  }
}
