import { useLocalStorage } from '@vueuse/core'
import { ref, watch } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'
import {
  DEFAULT_WEB_FONT_PROVIDER_SETTINGS,
  WEB_FONT_PROVIDER_IDS,
  assessFontLicenseBytes,
  chooseLocalFontMatch,
  collectGraphFontRequirements,
  fontFamilyLicenseDisplayForCatalog,
  fontFamilyLicenseDisplayFromAssessments,
  fontManager,
  inspectImportedFontBytes,
  MAX_IMPORTED_FONT_BYTES,
  missingGraphFontScripts,
  resetFontFamilyDemands,
  type FontFamilyLicenseDisplay,
  type FontFamilyOption,
  type FontLoadOptions,
  type LocalFontAccessState,
  type WebFontProviderId
} from '@open-pencil/core/text'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { dialogMessages } from '@open-pencil/vue'

import {
  clearDownloadedFontCache as clearTauriDownloadedFontCache,
  createTauriDownloadedFontCache,
  downloadedFontCacheSummary as tauriDownloadedFontCacheSummary,
  groupImportedFontCacheFamilies,
  listImportedFontCacheFaces,
  stageImportedFontCache,
  type ImportedFontCacheFace
} from '@/app/editor/fonts/cache'
import { preferredFontStyle } from '@/app/editor/fonts/style-selection'
import { toast } from '@/app/shell/ui'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

if (typeof navigator !== 'undefined') {
  fontManager.setFallbackUserAgent(navigator.userAgent)
}

export type FontProviderSettings = Record<WebFontProviderId, boolean>

export const onlineFontsEnabled = useLocalStorage('op-online-fonts-enabled', true)
export const fontProviderSettings = useLocalStorage<FontProviderSettings>(
  'op-font-providers',
  DEFAULT_WEB_FONT_PROVIDER_SETTINGS
)
/** Reactive signal for consumers whose output embeds the currently loaded font bytes. */
export const importedFontRevision = ref(0)

watch(
  [onlineFontsEnabled, fontProviderSettings],
  () => {
    fontManager.setOnlineFontProviders(
      onlineFontsEnabled.value
        ? Object.fromEntries(
            WEB_FONT_PROVIDER_IDS.map((provider) => [
              provider,
              fontProviderSettings.value[provider]
            ])
          )
        : {}
    )
  },
  { deep: true, immediate: true }
)

let tauriFontCacheConfigured = false
let webFontUnavailableToastShown = false

function showWebFontUnavailableToast(): void {
  if (webFontUnavailableToastShown || isTauri() || !onlineFontsEnabled.value) return
  if (!WEB_FONT_PROVIDER_IDS.some((provider) => fontProviderSettings.value[provider])) return
  webFontUnavailableToastShown = true
  toast.warning(dialogMessages.get().webFontProvidersRequireDesktopApp)
}

function configureTauriFontCache() {
  if (tauriFontCacheConfigured || !isTauri()) return
  tauriFontCacheConfigured = true
  fontManager.setDownloadedFontCache(createTauriDownloadedFontCache())
  fontManager.setWebFontFetch(tauriFetch)
  fontManager.setHostFontLoader(loadSystemFont)
}

configureTauriFontCache()

interface TauriFontFamily {
  family: string
  styles: string[]
}

let tauriFontsCache: TauriFontFamily[] | null = null
let tauriFontsPromise: Promise<TauriFontFamily[]> | null = null
const fontLicenseAuditStyles = new Map<string, string>()
const fontLicenseInspectionCache = new Map<string, Promise<FontFamilyLicenseDisplay>>()
const fontLicenseInspectionQueue: Array<() => void> = []
const MAX_CONCURRENT_FONT_LICENSE_INSPECTIONS = 2
let activeFontLicenseInspections = 0

function drainFontLicenseInspectionQueue(): void {
  if (activeFontLicenseInspections >= MAX_CONCURRENT_FONT_LICENSE_INSPECTIONS) return
  const next = fontLicenseInspectionQueue.shift()
  if (!next) return
  next()
  drainFontLicenseInspectionQueue()
}

function scheduleFontLicenseInspection<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fontLicenseInspectionQueue.push(() => {
      activeFontLicenseInspections++
      void (async () => {
        try {
          resolve(await task())
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        } finally {
          activeFontLicenseInspections--
          drainFontLicenseInspectionQueue()
        }
      })()
    })
    drainFontLicenseInspectionQueue()
  })
}

async function getTauriFonts(): Promise<TauriFontFamily[]> {
  if (tauriFontsCache) return tauriFontsCache
  if (!tauriFontsPromise) {
    tauriFontsPromise = import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<TauriFontFamily[]>('list_system_fonts'))
      .then((fonts) => {
        tauriFontsCache = Array.isArray(fonts) ? fonts : []
        return tauriFontsCache
      })
      .catch(() => [])
  }
  return tauriFontsPromise
}

export function preloadFonts(): void {
  configureTauriFontCache()
  if (isTauri()) {
    void getTauriFonts().then(registerFontFaces)
    return
  }
  if (onlineFontsEnabled.value) fontManager.preloadWebFontFamilies()
}

export function localFontAccessState(): LocalFontAccessState {
  return isTauri() ? 'granted' : fontManager.localAccessState()
}

export async function requestLocalFontAccess(): Promise<FontFamilyOption[]> {
  if (isTauri()) return listFamilies()
  await fontManager.requestLocalFontAccess()
  return listFamilies()
}

export async function downloadedFontCacheSummary() {
  configureTauriFontCache()
  if (!isTauri()) return { count: 0, byteLength: 0, updatedAt: null }
  return tauriDownloadedFontCacheSummary()
}

export async function clearDownloadedFontCache(): Promise<void> {
  configureTauriFontCache()
  if (!isTauri()) return
  await clearTauriDownloadedFontCache()
}

export async function predownloadFallbackFonts() {
  return fontManager.ensureFallbackPack()
}

function registerFontFaces(fonts: TauriFontFamily[]): void {
  if (typeof document === 'undefined') return
  for (const { family } of fonts) {
    const face = new FontFace(family, `local("${family}")`)
    document.fonts.add(face)
  }
}

export async function listFamilies(): Promise<FontFamilyOption[]> {
  configureTauriFontCache()
  if (isTauri()) {
    const [systemFonts, webFonts, importedFonts] = await Promise.all([
      getTauriFonts(),
      fontManager.listFamilyOptions(),
      listImportedFontCacheFaces()
    ])
    const byFamily = new Map(webFonts.map((font) => [font.family.trim().toLocaleLowerCase(), font]))
    for (const font of systemFonts) {
      fontLicenseAuditStyles.set(
        font.family,
        preferredFontStyle(font.styles, (style) => style.includes('Italic'))
      )
      byFamily.set(font.family.trim().toLocaleLowerCase(), {
        family: font.family,
        source: 'local',
        licenseDisplay: fontFamilyLicenseDisplayForCatalog(font.family, 'local')
      })
    }
    for (const font of groupImportedFontCacheFamilies(importedFonts)) {
      fontLicenseAuditStyles.set(font.family, font.auditStyle)
      byFamily.set(font.family.trim().toLocaleLowerCase(), {
        family: font.family,
        source: 'imported',
        licenseDisplay: font.licenseDisplay
      })
    }
    return [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family))
  }
  showWebFontUnavailableToast()
  return fontManager.listFamilyOptions()
}

export async function listFonts(): Promise<TauriFontFamily[]> {
  configureTauriFontCache()
  if (isTauri()) {
    return getTauriFonts()
  }
  return []
}

interface FontRenderInvalidator {
  invalidateAllPictures(): void
}

type FontLoadCancellation = AbortSignal | FontLoadOptions

function fontLoadOptions(cancellation?: FontLoadCancellation): FontLoadOptions {
  if (!cancellation) return {}
  if ('aborted' in cancellation) return { signal: cancellation }
  return cancellation
}

export async function ensureGraphFonts(
  graph: SceneGraph,
  nodeIds: string[],
  renderer?: FontRenderInvalidator | null,
  cancellation?: FontLoadCancellation
): Promise<boolean> {
  const options = fontLoadOptions(cancellation)
  const requirements = collectGraphFontRequirements(graph, nodeIds)
  let fontsChanged = false
  try {
    options.signal?.throwIfAborted()
    const generationBefore = fontManager.generation()
    const fontKeys = fontManager.collectFontKeys(graph, nodeIds)
    const { characters } = requirements
    await Promise.all(
      fontKeys.map(([family, style]) => loadFont(family, style, characters, options))
    )
    const fallbackScripts = missingGraphFontScripts(requirements)
    if (fallbackScripts.length > 0) {
      const fallbackFamiliesBefore = new Set([
        ...fontManager.getCJKFallbackFamilies(),
        ...fontManager.getArabicFallbackFamilies()
      ])
      const fallbacks = await fontManager.ensureFallbackPack(fallbackScripts, characters, options)
      fontsChanged = Object.values(fallbacks).some((families) =>
        families.some((family) => !fallbackFamiliesBefore.has(family))
      )
    }
    fontsChanged ||= fontManager.generation() !== generationBefore
    if (fontsChanged) {
      clearTextPictures(graph, nodeIds)
    }
    return fontsChanged
  } finally {
    if (fontsChanged) renderer?.invalidateAllPictures()
  }
}

function clearTextPictures(graph: SceneGraph, nodeIds: string[]): void {
  const clear = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    if (node.type === 'TEXT') node.textPicture = null
    for (const childId of node.childIds) clear(childId)
  }
  for (const id of nodeIds) clear(id)
}

async function loadSystemFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const data = await invoke<ArrayBuffer | Uint8Array | number[] | null>('load_system_font', {
      family,
      style
    })
    if (data instanceof ArrayBuffer) return data.byteLength > 0 ? data : null
    if (ArrayBuffer.isView(data)) {
      if (data.byteLength === 0) return null
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
    }
    if (!data?.length) return null
    return Uint8Array.from(data).buffer
  } catch {
    return null
  }
}

export async function loadFont(
  family: string,
  style = 'Regular',
  characters = '',
  options?: FontLoadOptions
): Promise<ArrayBuffer | null> {
  configureTauriFontCache()
  const loaded = options
    ? await fontManager.loadFont(family, style, characters, options)
    : await fontManager.loadFont(family, style, characters)
  if (!loaded) showWebFontUnavailableToast()
  return loaded
}

export async function importFontBytes(bytes: ArrayBuffer): Promise<ImportedFontCacheFace> {
  configureTauriFontCache()
  if (!isTauri()) throw new Error('Font file import is only available in the desktop app')
  const inspection = await inspectImportedFontBytes(bytes)
  const transaction = await stageImportedFontCache(inspection, bytes)
  try {
    if (
      !(await fontManager.registerImportedFontBytes(inspection.family, inspection.style, bytes))
    ) {
      throw new Error('CanvasKit could not register the selected font face')
    }
  } catch (error) {
    try {
      await transaction.rollback()
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Font registration failed and its cache transaction could not be rolled back'
      )
    }
    throw error
  }
  resetFontFamilyDemands(inspection.family)
  fontLicenseAuditStyles.set(inspection.family, inspection.style)
  importedFontRevision.value++
  return transaction.face
}

export async function importFontFile(): Promise<ImportedFontCacheFace | null> {
  if (!isTauri()) throw new Error('Font file import is only available in the desktop app')
  const [{ open }, { readFile, stat }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ])
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Font files', extensions: ['ttf', 'otf', 'woff'] }]
  })
  if (typeof path !== 'string') return null
  const fileInfo = await stat(path)
  if (!fileInfo.isFile) throw new Error('The selected path is not a font file')
  if (fileInfo.size > MAX_IMPORTED_FONT_BYTES) {
    throw new Error(`Font files must be ${MAX_IMPORTED_FONT_BYTES / 1024 / 1024} MiB or smaller`)
  }
  const data = await readFile(path)
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  return importFontBytes(bytes)
}

interface LocalFontLicenseProbe {
  bytes: ArrayBuffer
  style: string
}

async function readBrowserLocalFontForLicense(
  family: string
): Promise<LocalFontLicenseProbe | null> {
  if (!IS_BROWSER || !window.queryLocalFonts) return null
  try {
    const fonts = await window.queryLocalFonts()
    const match = chooseLocalFontMatch(fonts, family)
    if (!match) return null
    const blob = await match.blob()
    if (blob.size === 0) return null
    return { bytes: await blob.arrayBuffer(), style: match.style }
  } catch {
    return null
  }
}

async function readLocalFontForLicense(family: string): Promise<LocalFontLicenseProbe | null> {
  if (!isTauri()) return readBrowserLocalFontForLicense(family)
  const style = fontLicenseAuditStyles.get(family)
  if (!style) return null
  const bytes = await loadSystemFont(family, style)
  return bytes ? { bytes, style } : null
}

/**
 * Lazily inspects one catalog option. Provider-policy and reviewed bundled
 * results are returned without loading bytes; unknown local faces are loaded
 * once so their OpenType license metadata can refine the display status.
 */
export function inspectFontFamilyLicense(
  option: FontFamilyOption
): Promise<FontFamilyLicenseDisplay> {
  const current =
    option.licenseDisplay ?? fontFamilyLicenseDisplayForCatalog(option.family, option.source)
  if (current.status !== 'unknown' || option.source !== 'local') return Promise.resolve(current)

  const styleHint = fontLicenseAuditStyles.get(option.family) ?? 'auto'
  const key = `${option.source}|${option.family}|${styleHint}`
  let inspection = fontLicenseInspectionCache.get(key)
  if (!inspection) {
    inspection = scheduleFontLicenseInspection(async () => {
      const probe = await readLocalFontForLicense(option.family)
      if (!probe) {
        fontLicenseInspectionCache.delete(key)
        return current
      }
      const assessment = await assessFontLicenseBytes(option.family, probe.style, probe.bytes)
      return fontFamilyLicenseDisplayFromAssessments([assessment])
    }).catch(() => {
      fontLicenseInspectionCache.delete(key)
      return current
    })
    fontLicenseInspectionCache.set(key, inspection)
  }
  return inspection
}
