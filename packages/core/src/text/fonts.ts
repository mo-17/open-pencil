/* eslint-disable max-lines -- Font loading, fallback, retained data, and provider epochs share one lifecycle */

import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { DynamicConcurrencyLimiter, type ConcurrencyLimiterState } from '#core/async-work'
import { DEFAULT_FONT_FAMILY, IS_BROWSER } from '#core/constants'
import { BUNDLED_FONT_URLS } from '#core/text/bundled-fonts'
import { fontFamilyLicenseDisplayForCatalog } from '#core/text/font/license-display'
import {
  chooseLocalFontMatch,
  isVariableFont,
  normalizeFontFamily,
  styleToWeight,
  weightToStyle
} from '#core/text/font/style'

export * from '#core/text/font/sources'
export * from '#core/text/font/style'
import { fontFallbackEntry } from '#core/text/fallbacks'
import type { FontFallbackScript } from '#core/text/fallbacks'
import type {
  DownloadedFontCache,
  FontFamilyOption,
  FontFamilySource,
  FontInfo,
  HostFontLoader,
  LocalFontAccessState
} from '#core/text/font/sources'
import { collectGraphFontKeys } from '#core/text/requirements'
import { normalizedCoverageText, WebFontResolver } from '#core/text/web-fonts'
import type { WebFontFetch, WebFontProviderId } from '#core/text/web-fonts'

type FindLocalFontOptions = { allowVariable?: boolean }

function familyOption(family: string, source: FontFamilySource): FontFamilyOption {
  return {
    family,
    source,
    licenseDisplay: fontFamilyLicenseDisplayForCatalog(family, source)
  }
}

export interface FontLoadOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export const DEFAULT_FONT_LOAD_CONCURRENCY = 4

export interface FontManagerOptions {
  loadConcurrency?: number
}

function asError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : fallbackMessage)
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason !== undefined) {
    const error = asError(signal.reason, 'Font loading was aborted')
    if (error.name === 'Error') error.name = 'AbortError'
    return error
  }
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Font loading was aborted', 'AbortError')
  }
  const error = new Error('Font loading was aborted')
  error.name = 'AbortError'
  return error
}

function timeoutError(timeoutMs: number): Error {
  const error = new Error(`Font loading timed out after ${timeoutMs}ms`)
  error.name = 'TimeoutError'
  return error
}

function throwIfFontLoadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

function waitForFontLoad<T>(promise: Promise<T>, options: FontLoadOptions = {}): Promise<T> {
  const { signal, timeoutMs } = options
  if (signal?.aborted) return Promise.reject(abortError(signal))
  if (!signal && !(timeoutMs && timeoutMs > 0)) return promise

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(abortError(signal)))

    signal?.addEventListener('abort', onAbort, { once: true })
    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => finish(() => reject(timeoutError(timeoutMs))), timeoutMs)
    }
    void promise
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(asError(error, 'Font loading failed')))
      )
      .catch((error: unknown) => finish(() => reject(asError(error, 'Font loading failed'))))
  })
}

function buffersEqual(first: ArrayBuffer, second: ArrayBuffer): boolean {
  if (first === second) return true
  if (first.byteLength !== second.byteLength) return false
  const firstBytes = new Uint8Array(first)
  const secondBytes = new Uint8Array(second)
  for (let index = 0; index < firstBytes.length; index++) {
    if (firstBytes[index] !== secondBytes[index]) return false
  }
  return true
}

async function importedRenderFamily(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `__openpencil_imported_${hash}`
}

export class FontManager {
  private readonly fontLoadLimiter: DynamicConcurrencyLimiter
  private loadedFamilies = new Map<string, ArrayBuffer>()
  private supplementalFamilyData = new Map<string, ArrayBuffer[]>()
  /**
   * CanvasKit cannot unregister an earlier same-named system/remote face. Imported full faces are
   * therefore registered under a content-addressed family and selected explicitly at render time.
   */
  private importedRenderFamilies = new Map<string, string>()
  private remoteCoverage = new Map<string, Set<string>>()
  private blockedNodeIds = new Set<string>()
  private fontProvider: TypefaceFontProvider | null = null
  private fontProviders = new Set<TypefaceFontProvider>()
  private registrationGeneration = 0
  private providerRegistrations = new WeakMap<TypefaceFontProvider, Map<string, Set<ArrayBuffer>>>()
  private localFonts: FontInfo[] | null = null
  private localFontAccessState: LocalFontAccessState = IS_BROWSER ? 'prompt' : 'unsupported'
  private downloadedFontCache: DownloadedFontCache | null = null
  private fallbackUserAgent: string | undefined
  private hostFontLoader: HostFontLoader | null = null
  private hostFontResults = new Map<string, ArrayBuffer>()
  private hostFontLoadPromises = new Map<string, Promise<ArrayBuffer | null>>()
  private fontLoadPromises = new Map<
    string,
    { promise: Promise<ArrayBuffer | null>; requestedCharacters: Set<string> }
  >()
  private fallbackLoadPromises = new Map<FontFallbackScript, Promise<string[]>>()
  private fallbackFamiliesByScript = new Map<FontFallbackScript, string[]>()
  private webFonts = new WebFontResolver()
  private cjkFallbackFamilies: string[] = []
  private arabicFallbackFamilies: string[] = []

  constructor(options: FontManagerOptions = {}) {
    this.fontLoadLimiter = new DynamicConcurrencyLimiter(
      options.loadConcurrency ?? DEFAULT_FONT_LOAD_CONCURRENCY
    )
  }

  /**
   * Change the capacity available to new font-source resolution flights.
   * Registered fonts and already-running flights are never unloaded or interrupted.
   */
  setLoadConcurrency(concurrency: number): void {
    this.fontLoadLimiter.setConcurrency(concurrency)
  }

  loadQueueState(): ConcurrencyLimiterState {
    return this.fontLoadLimiter.state()
  }

  attachProvider(_canvasKit: CanvasKit, provider: TypefaceFontProvider): void {
    this.fontProviders.add(provider)
    this.fontProvider = provider
    this.providerRegistrations.set(provider, new Map())
    this.registrationGeneration++
    for (const [cacheKey, data] of this.loadedFamilies) {
      const separator = cacheKey.indexOf('|')
      const family = cacheKey.slice(0, separator)
      const style = cacheKey.slice(separator + 1)
      this.registerFontInProvider(provider, this.renderFamily(family, style), data)
      for (const supplemental of this.supplementalFamilyData.get(cacheKey) ?? []) {
        this.registerFontInProvider(provider, family, supplemental)
      }
    }
  }

  detachProvider(provider?: TypefaceFontProvider | null): void {
    if (!provider) {
      this.fontProviders.clear()
      this.fontProvider = null
      this.providerRegistrations = new WeakMap()
      return
    }
    this.fontProviders.delete(provider)
    this.providerRegistrations.delete(provider)
    if (this.fontProvider === provider) {
      this.fontProvider = Array.from(this.fontProviders).at(-1) ?? null
    }
  }

  provider(): TypefaceFontProvider | null {
    return this.fontProvider
  }

  generation(): number {
    return this.registrationGeneration
  }

  blockNodesUntilFontsResolve(nodeIds: readonly string[]): void {
    for (const nodeId of nodeIds) this.blockedNodeIds.add(nodeId)
  }

  unblockNodes(nodeIds: readonly string[]): void {
    for (const nodeId of nodeIds) this.blockedNodeIds.delete(nodeId)
  }

  isNodeBlocked(nodeId: string): boolean {
    return this.blockedNodeIds.has(nodeId)
  }

  localAccessState(): LocalFontAccessState {
    return this.localFontAccessState
  }

  setDownloadedFontCache(cache: DownloadedFontCache | null): void {
    this.downloadedFontCache = cache
  }

  setFallbackUserAgent(userAgent: string | undefined): void {
    if (userAgent === this.fallbackUserAgent) return
    this.fallbackUserAgent = userAgent
    this.fallbackFamiliesByScript.clear()
  }

  setHostFontLoader(loader: HostFontLoader | null): void {
    if (loader === this.hostFontLoader) return
    this.hostFontLoader = loader
    this.hostFontResults.clear()
    this.hostFontLoadPromises.clear()
    this.fallbackFamiliesByScript.clear()
  }

  /** @deprecated Use setHostFontLoader. Scheduled for removal in v0.15. */
  setHostFallbackFontLoader(loader: HostFontLoader | null): void {
    this.setHostFontLoader(loader)
  }

  setOnlineFontProviders(settings: Partial<Record<WebFontProviderId, boolean>>): void {
    this.webFonts.setEnabled(settings)
  }

  setWebFontFetch(fetcher: WebFontFetch | null): void {
    this.webFonts.setRemoteFetch(fetcher)
  }

  enabledOnlineFontProviders(): WebFontProviderId[] {
    return this.webFonts.enabledProviders()
  }

  clearFontLoadFailure(family: string, style = 'Regular', characters = ''): void {
    const normalized = normalizeFontFamily(family)
    this.webFonts.clearFailedFont(
      normalized === family ? [family] : [family, normalized],
      style,
      characters
    )
  }

  clearFallbackLoadFailures(script: FontFallbackScript, characters = ''): void {
    const manifest = fontFallbackEntry(script, this.fallbackUserAgent)
    const families = new Set([
      ...(this.fallbackFamiliesByScript.get(script) ?? []),
      ...manifest.remoteFamilies
    ])
    for (const family of families) this.clearFontLoadFailure(family, 'Regular', characters)
  }

  async loadCachedFont(
    family: string,
    style = 'Regular',
    characters = ''
  ): Promise<ArrayBuffer | null> {
    const imported = await this.loadImportedFont(family, style)
    if (imported) return imported
    const cached = await this.readDownloadedFont(family, style, characters)
    if (!cached) return null
    return this.registerAndCache(family, style, cached)
  }

  async loadImportedFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
    if (!this.downloadedFontCache?.readImported) return null
    try {
      const imported = await this.downloadedFontCache.readImported(family, style)
      return imported && (await this.registerImportedFontBytes(family, style, imported))
        ? imported
        : null
    } catch (e) {
      console.warn(`Imported font cache read failed for "${family}" ${style}:`, e)
      return null
    }
  }

  async requestLocalFontAccess(): Promise<FontInfo[]> {
    if (!IS_BROWSER || !window.queryLocalFonts) {
      this.localFontAccessState = 'unsupported'
      this.localFonts = []
      return []
    }
    try {
      const fonts = await window.queryLocalFonts()
      const seen = new Set<string>()
      const result: FontInfo[] = []
      for (const f of fonts) {
        const key = `${f.family}|${f.style}`
        if (seen.has(key)) continue
        seen.add(key)
        result.push({
          family: f.family,
          fullName: f.fullName,
          style: f.style,
          postscriptName: f.postscriptName
        })
      }
      this.localFonts = result
      this.localFontAccessState = 'granted'
      return result
    } catch {
      this.localFonts = []
      this.localFontAccessState = 'denied'
      return []
    }
  }

  async listFamilies(): Promise<string[]> {
    const options = await this.listFamilyOptions()
    return options.map((option) => option.family)
  }

  async listFamilyOptions(): Promise<FontFamilyOption[]> {
    const fonts = this.localFonts ?? (await this.requestLocalFontAccess())
    const webFontFamilies = await Promise.all(
      this.enabledOnlineFontProviders().map(async (provider) => ({
        provider,
        families: await this.webFonts.listFamilies(provider)
      }))
    )
    const byFamily = new Map<string, FontFamilyOption>()
    byFamily.set(DEFAULT_FONT_FAMILY, familyOption(DEFAULT_FONT_FAMILY, 'bundled'))
    for (const { provider, families } of webFontFamilies) {
      for (const family of families) {
        if (!byFamily.has(family)) byFamily.set(family, familyOption(family, provider))
      }
    }
    for (const font of fonts) byFamily.set(font.family, familyOption(font.family, 'local'))
    return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family))
  }

  preloadWebFontFamilies(): void {
    this.webFonts.preloadFamilies()
  }

  preloadGoogleFamilies(): void {
    if (!this.webFonts.enabledProviders().includes('google')) return
    void this.webFonts.listFamilies('google')
  }

  async fetchBundledFont(url: string): Promise<ArrayBuffer | null> {
    if (IS_BROWSER) {
      const response = await fetch(url)
      return response.arrayBuffer()
    }
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises')
    const { resolve, dirname } = await import(/* @vite-ignore */ 'node:path')
    const { fileURLToPath } = await import(/* @vite-ignore */ 'node:url')
    const packageJsonUrl = import.meta.resolve('@open-pencil/core/package.json')
    const packageRoot = dirname(fileURLToPath(packageJsonUrl))
    const assetPath = resolve(packageRoot, `assets${url}`)
    const buf = await readFile(assetPath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  async loadLocalFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
    const cacheKey = `${family}|${style}`
    const loaded = this.usableLoadedData(family, style)
    if (loaded) return loaded

    const localBuffer =
      (await this.loadHostFont(family, style)) ?? (await this.findLocalFont(family, style))
    if (localBuffer) return this.registerAndCache(family, style, localBuffer)

    const bundledUrl = BUNDLED_FONT_URLS[cacheKey]
    if (!bundledUrl) return null
    try {
      const buffer = await this.fetchBundledFont(bundledUrl)
      return buffer && !isVariableFont(buffer) ? this.registerAndCache(family, style, buffer) : null
    } catch (e) {
      console.warn(`Bundled font load failed for "${family}" ${style}:`, e)
      return null
    }
  }

  async loadRemoteFont(
    family: string,
    style = 'Regular',
    characters = ''
  ): Promise<ArrayBuffer | null> {
    if (typeof fetch === 'undefined') return null
    const coverage = this.remoteCoverage.get(`${family}|${style}`)
    if (
      characters &&
      coverage &&
      Array.from(characters).every((character) => coverage.has(character))
    ) {
      const loaded = this.usableLoadedData(family, style)
      if (loaded) return loaded
    }
    try {
      const requestedCharacters = normalizedCoverageText(
        `${coverage ? Array.from(coverage).join('') : ''}${characters}`
      )
      const normalized = normalizeFontFamily(family)
      const families = normalized === family ? [family] : [family, normalized]
      const buffers = await this.webFonts.fetchFont(families, style, requestedCharacters)
      if (buffers.length === 0) return null
      const primary = buffers[0]
      const registered = this.registerAndCache(family, style, primary)
      if (!registered) return null
      await this.writeDownloadedFont(family, style, primary, requestedCharacters)
      let completeCoverage = true
      for (const supplemental of buffers.slice(1)) {
        const accepted = this.registerSupplemental(family, style, supplemental)
        completeCoverage = accepted && completeCoverage
      }
      if (completeCoverage) {
        const loadedCoverage = this.remoteCoverage.get(`${family}|${style}`) ?? new Set<string>()
        for (const character of requestedCharacters) loadedCoverage.add(character)
        this.remoteCoverage.set(`${family}|${style}`, loadedCoverage)
      }
      return registered
    } catch (e) {
      console.warn(`Web font fetch failed for "${family}" ${style}:`, e)
      return null
    }
  }

  async loadFont(
    family: string,
    style = 'Regular',
    characters = '',
    options: FontLoadOptions = {}
  ): Promise<ArrayBuffer | null> {
    throwIfFontLoadAborted(options.signal)
    const cacheKey = `${family}|${style}`
    const loaded = this.usableLoadedData(family, style)
    if (loaded) {
      const remoteCoverage = this.remoteCoverage.get(`${family}|${style}`)
      const missingRemoteCoverage = Boolean(
        characters &&
        remoteCoverage &&
        Array.from(characters).some((character) => !remoteCoverage.has(character))
      )
      if (!missingRemoteCoverage) {
        throwIfFontLoadAborted(options.signal)
        return loaded
      }
    }

    let flight = this.fontLoadPromises.get(cacheKey)
    if (!flight) {
      const requestedCharacters = new Set(characters)
      const promise = this.fontLoadLimiter.run(() =>
        this.runFontLoadFlight(family, style, requestedCharacters)
      )
      flight = { promise, requestedCharacters }
      this.fontLoadPromises.set(cacheKey, flight)
      const cleanup = () => {
        if (this.fontLoadPromises.get(cacheKey)?.promise === promise) {
          this.fontLoadPromises.delete(cacheKey)
        }
      }
      void promise.then(cleanup, cleanup)
    } else {
      for (const character of characters) flight.requestedCharacters.add(character)
    }

    const result = await waitForFontLoad(flight.promise, options)
    throwIfFontLoadAborted(options.signal)
    return result
  }

  private async runFontLoadFlight(
    family: string,
    style: string,
    requestedCharacters: Set<string>
  ): Promise<ArrayBuffer | null> {
    const cacheKey = `${family}|${style}`
    let result = this.usableLoadedData(family, style)
    if (!result) {
      const requestedText = () => Array.from(requestedCharacters).join('')
      result =
        (await this.loadImportedFont(family, style)) ??
        (await this.loadLocalFont(family, style)) ??
        (await this.loadCachedFont(family, style, requestedText())) ??
        (await this.loadRemoteFont(family, style, requestedText()))
    }
    if (!result) return null

    // A caller can join the single flight while its first remote subset is in
    // progress. Extend coverage once with the accumulated characters. If the
    // provider cannot supply them, keep the last usable face and finish instead
    // of recursively retrying forever.
    const coverage = this.remoteCoverage.get(cacheKey)
    if (!coverage) return result
    const missingCharacters = Array.from(requestedCharacters).filter(
      (character) => !coverage.has(character)
    )
    if (missingCharacters.length === 0) return result
    return (await this.loadRemoteFont(family, style, missingCharacters.join(''))) ?? result
  }

  async ensureNodeFont(family: string, weight: number): Promise<void> {
    await this.loadFont(family, weightToStyle(weight))
  }

  markLoaded(family: string, style: string, data: ArrayBuffer): void {
    this.registerAndCache(family, style, data)
  }

  /**
   * Replace the active face with validated caller-owned full-face bytes. Imported faces use a
   * content-addressed CanvasKit family so an older same-named registration cannot win lookup.
   */
  async registerImportedFontBytes(
    family: string,
    style: string,
    data: ArrayBuffer
  ): Promise<boolean> {
    const key = `${family}|${style}`
    const renderFamily = await importedRenderFamily(data)
    const retained = this.loadedFamilies.get(key)
    if (
      retained &&
      this.importedRenderFamilies.get(key) === renderFamily &&
      buffersEqual(retained, data)
    ) {
      return this.fontProviders.size === 0 || this.registerFontInCanvasKit(renderFamily, retained)
    }
    if (this.fontProviders.size > 0 && !this.registerFontInCanvasKit(renderFamily, data))
      return false
    this.loadedFamilies.set(key, data)
    this.supplementalFamilyData.delete(key)
    this.remoteCoverage.delete(key)
    this.importedRenderFamilies.set(key, renderFamily)
    this.registerFontInBrowser(family, style, data)
    return true
  }

  isLoaded(family: string): boolean {
    for (const [key, data] of this.loadedFamilies) {
      if (!key.startsWith(`${family}|`)) continue
      const style = key.slice(family.length + 1)
      if (this.retainedDataIsRegistered(this.renderFamily(family, style), data)) return true
    }
    return false
  }

  isStyleLoaded(family: string, style: string): boolean {
    const data = this.loadedFamilies.get(`${family}|${style}`)
    return (
      data !== undefined && this.retainedDataIsRegistered(this.renderFamily(family, style), data)
    )
  }

  remoteStyleNeedsCoverage(family: string, style: string, characters: readonly string[]): boolean {
    const coverage = this.remoteCoverage.get(`${family}|${style}`)
    return !!coverage && characters.some((character) => !coverage.has(character))
  }

  loadedData(family: string, style: string): ArrayBuffer | null {
    return this.loadedFamilies.get(`${family}|${style}`) ?? null
  }

  /**
   * Snapshot every retained buffer for one face without exposing FontManager's
   * mutable storage. Remote providers may split a face into multiple glyph
   * shards, so exporters must not assume `loadedData()` is the complete face.
   */
  loadedDataShards(family: string, style: string): readonly ArrayBuffer[] {
    const key = `${family}|${style}`
    const primary = this.loadedFamilies.get(key)
    if (!primary) return []
    const primaryFamily = this.renderFamily(family, style)
    return Object.freeze(
      [
        ...(this.retainedDataIsRegistered(primaryFamily, primary) ? [primary] : []),
        ...(this.supplementalFamilyData.get(key) ?? []).filter((data) =>
          this.retainedDataIsRegistered(family, data)
        )
      ].map((data) => data.slice(0))
    )
  }

  private usableLoadedData(family: string, style: string): ArrayBuffer | null {
    const data = this.loadedData(family, style)
    if (!data || this.fontProviders.size === 0) return data
    return this.registerFontInCanvasKit(this.renderFamily(family, style), data) ? data : null
  }

  private retainedDataIsRegistered(family: string, data: ArrayBuffer): boolean {
    if (this.fontProviders.size === 0) return true
    for (const provider of this.fontProviders) {
      if (!this.providerRegistrations.get(provider)?.get(family)?.has(data)) return false
    }
    return true
  }

  renderFamily(family: string, style: string): string {
    return this.importedRenderFamilies.get(`${family}|${style}`) ?? family
  }

  collectFontKeys(graph: SceneGraph, nodeIds: string[]): Array<[string, string]> {
    return collectGraphFontKeys(graph, nodeIds)
  }

  async ensureCJKFallback(options: FontLoadOptions = {}): Promise<string[]> {
    await this.ensureFallbackFamilies(
      'cjk',
      this.cjkFallbackFamilies,
      { allowVariableLocalFonts: true },
      '',
      options
    )
    return this.cjkFallbackFamilies
  }

  getCJKFallbackFamilies(): string[] {
    return this.cjkFallbackFamilies
  }

  setCJKFallbackFamily(family: string): void {
    if (!this.cjkFallbackFamilies.includes(family)) {
      this.cjkFallbackFamilies.push(family)
    }
  }

  async ensureArabicFallback(options: FontLoadOptions = {}): Promise<string[]> {
    await this.ensureFallbackFamilies('arabic', this.arabicFallbackFamilies, {}, '', options)
    return this.arabicFallbackFamilies
  }

  async ensureFallbackPack(
    scripts: FontFallbackScript[] = ['cjk', 'arabic'],
    characters = '',
    options: FontLoadOptions = {}
  ): Promise<Partial<Record<FontFallbackScript, string[]>>> {
    throwIfFontLoadAborted(options.signal)
    const result: Partial<Record<FontFallbackScript, string[]>> = {}
    await Promise.all(
      scripts.map(async (script) => {
        if (script === 'arabic' && !characters)
          result[script] = await this.ensureArabicFallback(options)
        else if (script === 'cjk' && !characters)
          result[script] = await this.ensureCJKFallback(options)
        else {
          const target =
            script === 'arabic' ? this.arabicFallbackFamilies : this.cjkFallbackFamilies
          result[script] = await this.ensureFallbackFamilies(
            script,
            target,
            {},
            characters,
            options
          )
        }
      })
    )
    throwIfFontLoadAborted(options.signal)
    return result
  }

  getArabicFallbackFamilies(): string[] {
    return this.arabicFallbackFamilies
  }

  setArabicFallbackFamily(family: string): void {
    if (!this.arabicFallbackFamilies.includes(family)) {
      this.arabicFallbackFamilies.push(family)
    }
  }

  private async ensureFallbackFamilies(
    script: FontFallbackScript,
    targetFamilies: string[],
    options: { allowVariableLocalFonts?: boolean } = {},
    characters = '',
    loadOptions: FontLoadOptions = {}
  ): Promise<string[]> {
    throwIfFontLoadAborted(loadOptions.signal)
    let scriptFamilies = this.fallbackFamiliesByScript.get(script)
    if (!scriptFamilies) {
      scriptFamilies = []
      this.fallbackFamiliesByScript.set(script, scriptFamilies)
    }
    const selectedFamily = scriptFamilies[0]
    if (selectedFamily) {
      if (characters) await this.loadFont(selectedFamily, 'Regular', characters, loadOptions)
      throwIfFontLoadAborted(loadOptions.signal)
      return scriptFamilies
    }

    const existingPromise = this.fallbackLoadPromises.get(script)
    if (existingPromise) {
      const result = await waitForFontLoad(existingPromise, loadOptions)
      throwIfFontLoadAborted(loadOptions.signal)
      return result
    }

    const pending = this.resolveFirstFallbackFamily(
      script,
      scriptFamilies,
      targetFamilies,
      options,
      characters
    )
    this.fallbackLoadPromises.set(script, pending)
    const cleanup = () => {
      if (this.fallbackLoadPromises.get(script) === pending) {
        this.fallbackLoadPromises.delete(script)
      }
    }
    void pending.then(cleanup, cleanup)
    const result = await waitForFontLoad(pending, loadOptions)
    throwIfFontLoadAborted(loadOptions.signal)
    return result
  }

  private async resolveFirstFallbackFamily(
    script: FontFallbackScript,
    scriptFamilies: string[],
    targetFamilies: string[],
    options: { allowVariableLocalFonts?: boolean },
    characters: string
  ): Promise<string[]> {
    const manifest = fontFallbackEntry(script, this.fallbackUserAgent)

    // The desktop host can return an entire TTC collection for a system CJK face. On macOS that
    // makes the otherwise convenient PingFang fallback copy tens of megabytes through IPC before
    // the first useful frame. Prefer OpenPencil's bounded, offline Noto Sans SC asset for generic
    // and Simplified Chinese text; keep platform-native ordering for TC/JP/KR glyph conventions.
    const bundledFirst =
      script === 'cjk' || script === 'cjk-sc'
        ? manifest.remoteFamilies.filter((family) => BUNDLED_FONT_URLS[`${family}|Regular`])
        : []
    for (const family of bundledFirst) {
      const data = await this.loadFont(family, 'Regular', characters)
      if (!data) continue
      if (!scriptFamilies.includes(family)) scriptFamilies.push(family)
      if (!targetFamilies.includes(family)) targetFamilies.push(family)
      return scriptFamilies
    }

    for (const family of manifest.localFamilies) {
      const buffer =
        (await this.loadHostFont(family, 'Regular')) ??
        (await this.findLocalFont(family, undefined, {
          allowVariable: options.allowVariableLocalFonts
        }))
      if (buffer && this.registerAndCache(family, 'Regular', buffer)) {
        if (!scriptFamilies.includes(family)) scriptFamilies.push(family)
        if (!targetFamilies.includes(family)) targetFamilies.push(family)
        return scriptFamilies
      }
    }

    for (const family of manifest.remoteFamilies) {
      if (bundledFirst.includes(family)) continue
      // A remote fallback family may also have a bundled, cached, or host face
      // (notably the bundled Noto Sans SC). Stop at the first usable candidate;
      // registering every candidate retains several multi-megabyte faces.
      const data = await this.loadFont(family, 'Regular', characters)
      if (data) {
        if (!scriptFamilies.includes(family)) scriptFamilies.push(family)
        if (!targetFamilies.includes(family)) targetFamilies.push(family)
        return scriptFamilies
      }
    }

    return scriptFamilies
  }

  private async loadHostFont(family: string, style: string): Promise<ArrayBuffer | null> {
    if (!this.hostFontLoader) return null
    const key = `${family}|${style}`
    const cached = this.hostFontResults.get(key)
    if (cached) return cached
    const existing = this.hostFontLoadPromises.get(key)
    if (existing) return existing

    const loader = this.hostFontLoader
    const pending = loader(family, style)
      .catch((e: unknown) => {
        console.warn(`Host fallback font load failed for "${family}" ${style}:`, e)
        return null
      })
      .then((data) => {
        if (this.hostFontLoader === loader && data) this.hostFontResults.set(key, data)
        return data
      })
    this.hostFontLoadPromises.set(key, pending)
    const cleanup = () => {
      if (this.hostFontLoadPromises.get(key) === pending) {
        this.hostFontLoadPromises.delete(key)
      }
    }
    void pending.then(cleanup, cleanup)
    return pending
  }

  retainedDataCount(family: string, style = 'Regular'): number {
    const key = `${family}|${style}`
    return (
      (this.loadedFamilies.has(key) ? 1 : 0) + (this.supplementalFamilyData.get(key)?.length ?? 0)
    )
  }

  private equivalentRetainedData(key: string, buffer: ArrayBuffer): ArrayBuffer | null {
    const primary = this.loadedFamilies.get(key)
    if (primary && buffersEqual(primary, buffer)) return primary
    for (const supplemental of this.supplementalFamilyData.get(key) ?? []) {
      if (buffersEqual(supplemental, buffer)) return supplemental
    }
    return null
  }

  private async readDownloadedFont(
    family: string,
    style: string,
    characters = ''
  ): Promise<ArrayBuffer | null> {
    if (!this.downloadedFontCache) return null
    try {
      return await this.downloadedFontCache.read(family, style, characters)
    } catch (e) {
      console.warn(`Downloaded font cache read failed for "${family}" ${style}:`, e)
      return null
    }
  }

  private async writeDownloadedFont(
    family: string,
    style: string,
    data: ArrayBuffer,
    characters = ''
  ): Promise<void> {
    if (!this.downloadedFontCache) return
    try {
      await this.downloadedFontCache.write(family, style, data, characters)
    } catch (e) {
      console.warn(`Downloaded font cache write failed for "${family}" ${style}:`, e)
    }
  }

  private async findLocalFont(
    family: string,
    style?: string,
    options: FindLocalFontOptions = {}
  ): Promise<ArrayBuffer | null> {
    if (!IS_BROWSER || !window.queryLocalFonts) return null
    if (this.localFontAccessState !== 'granted') return null
    try {
      const fonts = await window.queryLocalFonts()
      const match = chooseLocalFontMatch(fonts, family, style)
      if (!match) return null
      const blob: Blob = await match.blob()
      const buffer = await blob.arrayBuffer()
      if (!options.allowVariable && isVariableFont(buffer)) return null
      return buffer
    } catch (e) {
      console.warn(`Local font access failed for "${family}" ${style ?? ''}:`, e)
      return null
    }
  }

  private registerSupplemental(family: string, style: string, buffer: ArrayBuffer): boolean {
    const key = `${family}|${style}`
    if (this.importedRenderFamilies.has(key)) return false
    const equivalent = this.equivalentRetainedData(key, buffer)
    if (equivalent) {
      return this.fontProviders.size === 0 || this.registerFontInCanvasKit(family, equivalent)
    }
    if (this.fontProviders.size > 0 && !this.registerFontInCanvasKit(family, buffer)) return false
    const supplemental = this.supplementalFamilyData.get(key) ?? []
    supplemental.push(buffer)
    this.supplementalFamilyData.set(key, supplemental)
    this.registerFontInBrowser(family, style, buffer)
    return true
  }

  private registerAndCache(family: string, style: string, buffer: ArrayBuffer): ArrayBuffer | null {
    const key = `${family}|${style}`
    const importedRenderFamily = this.importedRenderFamilies.get(key)
    if (importedRenderFamily) {
      const imported = this.loadedFamilies.get(key)
      if (!imported) {
        this.importedRenderFamilies.delete(key)
      } else {
        if (!buffersEqual(imported, buffer)) return null
        if (
          this.fontProviders.size > 0 &&
          !this.registerFontInCanvasKit(importedRenderFamily, imported)
        ) {
          return null
        }
        return imported
      }
    }
    const existing = this.loadedFamilies.get(key)
    const equivalent = this.equivalentRetainedData(key, buffer)
    if (equivalent) {
      if (this.fontProviders.size > 0 && !this.registerFontInCanvasKit(family, equivalent)) {
        return null
      }
      return equivalent
    }
    // A fetched buffer is not a usable canvas font until an attached CanvasKit provider accepts
    // it. Do not turn a decode/registration failure into a false "loaded" state in the UI.
    if (this.fontProviders.size > 0 && !this.registerFontInCanvasKit(family, buffer)) return null
    if (existing) {
      this.loadedFamilies.delete(key)
      this.registerSupplemental(family, style, existing)
    }
    this.loadedFamilies.set(key, buffer)
    this.registerFontInBrowser(family, style, buffer)
    return buffer
  }

  private registerFontInCanvasKit(family: string, data: ArrayBuffer): boolean {
    let registered = this.fontProviders.size > 0
    for (const provider of this.fontProviders) {
      const accepted = this.registerFontInProvider(provider, family, data)
      registered = accepted && registered
    }
    return registered
  }

  private registerFontInProvider(
    provider: TypefaceFontProvider,
    family: string,
    data: ArrayBuffer
  ): boolean {
    if (data.byteLength < 4) return false
    const registrations = this.providerRegistrations.get(provider) ?? new Map()
    const registeredData = registrations.get(family)
    if (registeredData?.has(data)) return true
    try {
      provider.registerFont(data, family)
      const familyRegistrations = registeredData ?? new Set<ArrayBuffer>()
      familyRegistrations.add(data)
      registrations.set(family, familyRegistrations)
      this.providerRegistrations.set(provider, registrations)
      this.registrationGeneration++
      return true
    } catch {
      return false
    }
  }

  private registerFontInBrowser(family: string, style: string, data: ArrayBuffer) {
    if (!IS_BROWSER) return
    const weight = styleToWeight(style)
    const italic = style.toLowerCase().includes('italic') ? 'italic' : 'normal'
    const face = new FontFace(family, data, {
      weight: String(weight),
      style: italic
    })
    face
      .load()
      .then(() => document.fonts.add(face))
      .catch(() => {
        console.warn(`Failed to load font "${family}" (${style})`)
      })
  }
}

export const fontManager = new FontManager()
