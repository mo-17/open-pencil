import {
  importedFontFormat,
  styleToWeight,
  type DownloadedFontCache,
  type FontFamilyLicenseDisplay,
  type ImportedFontFormat,
  type ImportedFontInspection
} from '@open-pencil/core/text'

import {
  readCacheBytes,
  readCacheJSON,
  removeCacheEntry,
  removeCachePrefix,
  writeCacheBytes,
  writeCacheJSON
} from '@/app/cache'
import { preferredFontStyle } from '@/app/editor/fonts/style-selection'

type FontCacheEntry = {
  family: string
  style: string
  file: string
  byteLength: number
  sha256: string
  updatedAt: number
  source?: 'remote' | 'imported'
  format?: ImportedFontFormat
  characters?: string
  fullFace?: boolean
  licenseDisplay?: FontFamilyLicenseDisplay
}

type FontCacheManifest = {
  version: 1
  entries: Partial<Record<string, FontCacheEntry>>
}

export interface DownloadedFontCacheSummary {
  count: number
  byteLength: number
  updatedAt: number | null
}

export interface ImportedFontCacheFace {
  family: string
  style: string
  sha256: string
  byteLength: number
  updatedAt: number
  format: ImportedFontFormat
  licenseDisplay: FontFamilyLicenseDisplay
}

export interface ImportedFontCacheTransaction {
  face: ImportedFontCacheFace
  rollback(): Promise<void>
}

export interface ImportedFontCacheFamily {
  family: string
  auditStyle: string
  licenseDisplay: FontFamilyLicenseDisplay
}

const CACHE_DIR = 'font-cache/v1'
const MANIFEST_PATH = `${CACHE_DIR}/manifest`
const FILE_DIR = `${CACHE_DIR}/files`
const textEncoder = new TextEncoder()
let cacheMutationTail: Promise<void> = Promise.resolve()

function emptyManifest(): FontCacheManifest {
  return { version: 1, entries: {} }
}

function runCacheMutation<T>(task: () => Promise<T>): Promise<T> {
  const operation = cacheMutationTail.then(task)
  cacheMutationTail = operation.then(
    () => undefined,
    () => undefined
  )
  return operation
}

async function cacheKey(family: string, style: string, characters = '') {
  return hashText(`${family}\0${style}\0${Array.from(new Set(characters)).sort().join('')}`)
}

async function hashText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return hexDigest(digest)
}

async function hashBytes(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return hexDigest(digest)
}

function fontExtension(format: ImportedFontFormat): string {
  if (format === 'opentype') return 'otf'
  return format === 'woff' ? 'woff' : 'ttf'
}

function sameFace(entry: FontCacheEntry, family: string, style: string): boolean {
  if (entry.family.trim().toLocaleLowerCase() !== family.trim().toLocaleLowerCase()) return false
  return (
    styleToWeight(entry.style) === styleToWeight(style) &&
    /(?:italic|oblique)/iu.test(entry.style) === /(?:italic|oblique)/iu.test(style)
  )
}

function importedEntries(manifest: FontCacheManifest): FontCacheEntry[] {
  return Object.values(manifest.entries)
    .filter((entry): entry is FontCacheEntry => entry?.source === 'imported')
    .sort((first, second) => second.updatedAt - first.updatedAt)
}

function normalizedImportedLicenseDisplay(
  display: FontFamilyLicenseDisplay
): FontFamilyLicenseDisplay {
  const unknown: FontFamilyLicenseDisplay = {
    status: 'unknown',
    scope: 'loaded_faces',
    evidence: 'insufficient'
  }
  if (display.status === 'unknown') return unknown
  if (display.status === 'requires_license') {
    return ['embedding', 'commercial', 'general'].includes(display.restriction) ? display : unknown
  }
  if (
    display.status === 'declared_open' &&
    Array.isArray(display.licenseIds) &&
    display.licenseIds.every((licenseId) => typeof licenseId === 'string')
  ) {
    return display
  }
  if (
    display.status === 'free' &&
    display.evidence === 'reviewed_bundled_manifest' &&
    Array.isArray(display.licenseIds) &&
    display.licenseIds.every((licenseId) => typeof licenseId === 'string') &&
    typeof display.hasConditions === 'boolean'
  ) {
    return display
  }
  return unknown
}

async function verifiedEntryBytes(entry: FontCacheEntry): Promise<ArrayBuffer | null> {
  const buffer = await readCacheBytes(`${FILE_DIR}/${entry.file}`)
  if (!buffer || buffer.byteLength !== entry.byteLength) return null
  return (await hashBytes(buffer)) === entry.sha256 ? buffer : null
}

async function removeUnreferencedFontFile(file: string): Promise<void> {
  const manifest = await readManifest()
  if (Object.values(manifest.entries).some((entry) => entry?.file === file)) return
  await removeCacheEntry(`${FILE_DIR}/${file}`)
}

function importedFaceMetadata(entry: FontCacheEntry): ImportedFontCacheFace | null {
  if (
    entry.fullFace !== true ||
    typeof entry.family !== 'string' ||
    !entry.family.trim() ||
    typeof entry.style !== 'string' ||
    !entry.style.trim() ||
    !['truetype', 'opentype', 'woff'].includes(entry.format ?? '') ||
    typeof entry.sha256 !== 'string' ||
    !/^[a-f\d]{64}$/iu.test(entry.sha256) ||
    !Number.isFinite(entry.byteLength) ||
    entry.byteLength <= 0 ||
    !Number.isFinite(entry.updatedAt) ||
    !entry.licenseDisplay
  ) {
    return null
  }
  return {
    family: entry.family,
    style: entry.style,
    sha256: entry.sha256,
    byteLength: entry.byteLength,
    updatedAt: entry.updatedAt,
    format: entry.format as ImportedFontFormat,
    licenseDisplay: normalizedImportedLicenseDisplay(entry.licenseDisplay)
  }
}

function sameCacheEntry(first: FontCacheEntry | undefined, second: FontCacheEntry): boolean {
  return (
    first?.family === second.family &&
    first.style === second.style &&
    first.file === second.file &&
    first.sha256 === second.sha256 &&
    first.updatedAt === second.updatedAt &&
    first.source === second.source
  )
}

async function restoreManifestEntry(
  key: string,
  written: FontCacheEntry,
  previous: FontCacheEntry | undefined
): Promise<void> {
  const manifest = await readManifest()
  if (!sameCacheEntry(manifest.entries[key], written)) return
  if (previous) manifest.entries[key] = previous
  else Reflect.deleteProperty(manifest.entries, key)
  await writeManifest(manifest)
}

function hexDigest(data: ArrayBuffer) {
  return [...new Uint8Array(data)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readManifest(): Promise<FontCacheManifest> {
  const manifest = await readCacheJSON<Partial<FontCacheManifest>>(MANIFEST_PATH)
  if (manifest?.version !== 1 || !manifest.entries) return emptyManifest()
  return { version: 1, entries: manifest.entries }
}

async function writeManifest(manifest: FontCacheManifest) {
  await writeCacheJSON(MANIFEST_PATH, manifest)
}

export async function downloadedFontCacheSummary(): Promise<DownloadedFontCacheSummary> {
  const manifest = await readManifest()
  const entries = Object.values(manifest.entries).filter(
    (entry): entry is FontCacheEntry => !!entry
  )
  return {
    count: entries.length,
    byteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
    updatedAt: entries.length > 0 ? Math.max(...entries.map((entry) => entry.updatedAt)) : null
  }
}

export async function clearDownloadedFontCache(): Promise<void> {
  await runCacheMutation(() => removeCachePrefix(CACHE_DIR))
}

export async function listImportedFontCacheFaces(): Promise<ImportedFontCacheFace[]> {
  const manifest = await readManifest()
  const seen = new Set<string>()
  const faces: ImportedFontCacheFace[] = []
  for (const entry of importedEntries(manifest)) {
    const face = importedFaceMetadata(entry)
    if (!face) continue
    const weight = styleToWeight(face.style)
    const italic = /(?:italic|oblique)/iu.test(face.style)
    const key = `${face.family.trim().toLocaleLowerCase()}\0${weight}\0${italic}`
    if (seen.has(key)) continue
    if (!(await verifiedEntryBytes(entry))) continue
    seen.add(key)
    faces.push(face)
  }
  return faces
}

function importedFamilyLicenseDisplay(
  faces: readonly ImportedFontCacheFace[]
): FontFamilyLicenseDisplay {
  const displays = faces.map((face) => normalizedImportedLicenseDisplay(face.licenseDisplay))
  const restrictions = displays
    .filter(
      (display): display is Extract<FontFamilyLicenseDisplay, { status: 'requires_license' }> =>
        display.status === 'requires_license'
    )
    .sort((first, second) => {
      const priority = { embedding: 0, commercial: 1, general: 2 } as const
      return priority[second.restriction] - priority[first.restriction]
    })
  if (restrictions[0]) return restrictions[0]

  if (displays.some((display) => display.status === 'unknown')) {
    return { status: 'unknown', scope: 'loaded_faces', evidence: 'insufficient' }
  }

  const licenseIds = [
    ...new Set(
      displays.flatMap((display) =>
        display.status === 'free' || display.status === 'declared_open' ? display.licenseIds : []
      )
    )
  ].sort((first, second) => first.localeCompare(second))
  if (displays.some((display) => display.status === 'declared_open')) {
    return {
      status: 'declared_open',
      scope: 'loaded_faces',
      evidence: 'embedded_name_table',
      licenseIds,
      hasConditions: true
    }
  }
  return {
    status: 'free',
    scope: 'loaded_faces',
    evidence: 'reviewed_bundled_manifest',
    licenseIds,
    hasConditions: displays.some((display) => display.status === 'free' && display.hasConditions)
  }
}

export function groupImportedFontCacheFamilies(
  faces: readonly ImportedFontCacheFace[]
): ImportedFontCacheFamily[] {
  const grouped = new Map<string, ImportedFontCacheFace[]>()
  for (const face of faces) {
    const key = face.family.trim().toLocaleLowerCase()
    const familyFaces = grouped.get(key) ?? []
    familyFaces.push(face)
    grouped.set(key, familyFaces)
  }
  return [...grouped.values()].map((familyFaces) => ({
    family: familyFaces[0].family,
    auditStyle: preferredFontStyle(familyFaces.map((face) => face.style)),
    licenseDisplay: importedFamilyLicenseDisplay(familyFaces)
  }))
}

export async function stageImportedFontCache(
  inspection: ImportedFontInspection,
  data: ArrayBuffer
): Promise<ImportedFontCacheTransaction> {
  const sha256 = await hashBytes(data)
  const key = await hashText(`imported\0${inspection.family}\0${inspection.style}\0${sha256}`)
  const file = `${sha256}.${fontExtension(inspection.format)}`
  const staged = await runCacheMutation(async () => {
    let previous: FontCacheEntry | undefined
    let written: FontCacheEntry | undefined
    try {
      await writeCacheBytes(`${FILE_DIR}/${file}`, data)

      const manifest = await readManifest()
      previous = manifest.entries[key]
      const latestTimestamp = Math.max(
        0,
        ...Object.values(manifest.entries).flatMap((entry) =>
          entry && Number.isFinite(entry.updatedAt) ? [entry.updatedAt] : []
        )
      )
      const updatedAt = Math.max(Date.now(), latestTimestamp + 1)
      written = {
        family: inspection.family,
        style: inspection.style,
        file,
        byteLength: data.byteLength,
        sha256,
        updatedAt,
        source: 'imported',
        format: inspection.format,
        fullFace: true,
        licenseDisplay: inspection.licenseDisplay
      }
      manifest.entries[key] = written
      await writeManifest(manifest)
      const face: ImportedFontCacheFace = {
        family: inspection.family,
        style: inspection.style,
        sha256,
        byteLength: data.byteLength,
        updatedAt,
        format: inspection.format,
        licenseDisplay: inspection.licenseDisplay
      }
      return { face, previous, written }
    } catch (error) {
      try {
        if (written) await restoreManifestEntry(key, written, previous)
      } finally {
        await removeUnreferencedFontFile(file)
      }
      throw error
    }
  })
  return {
    face: staged.face,
    async rollback() {
      await runCacheMutation(async () => {
        try {
          await restoreManifestEntry(key, staged.written, staged.previous)
        } finally {
          await removeUnreferencedFontFile(file)
        }
      })
    }
  }
}

export async function writeImportedFontCache(
  inspection: ImportedFontInspection,
  data: ArrayBuffer
): Promise<ImportedFontCacheFace> {
  return (await stageImportedFontCache(inspection, data)).face
}

export function createTauriDownloadedFontCache(): DownloadedFontCache {
  async function readImported(family: string, style: string): Promise<ArrayBuffer | null> {
    const manifest = await readManifest()
    for (const entry of importedEntries(manifest)) {
      if (!importedFaceMetadata(entry) || !sameFace(entry, family, style)) continue
      const buffer = await verifiedEntryBytes(entry)
      if (buffer) return buffer
    }
    return null
  }

  return {
    readImported,
    async read(family, style, characters) {
      const manifest = await readManifest()
      const exact = manifest.entries[await cacheKey(family, style, characters)]
      return exact ? verifiedEntryBytes(exact) : null
    },

    async write(family, style, data, characters) {
      const key = await cacheKey(family, style, characters)
      const sha256 = await hashBytes(data)
      const format = importedFontFormat(data) ?? 'truetype'
      const file = `${key}.${fontExtension(format)}`
      await runCacheMutation(async () => {
        await writeCacheBytes(`${FILE_DIR}/${file}`, data)

        const manifest = await readManifest()
        manifest.entries[key] = {
          family,
          style,
          file,
          byteLength: data.byteLength,
          sha256,
          updatedAt: Date.now(),
          source: 'remote',
          format,
          characters
        }
        await writeManifest(manifest)
      })
    }
  }
}
