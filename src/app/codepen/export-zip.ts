import { unzipSync } from 'fflate'

import type { CodePenStaticEvidence } from './contracts'
import { createCodePenStaticEvidence } from './evidence'

export const CODEPEN_EXPORT_ZIP_LIMITS = Object.freeze({
  maxArchiveBytes: 8 * 1024 * 1024,
  maxEntries: 64,
  maxEntryBytes: 2 * 1024 * 1024,
  maxExpandedBytes: 6 * 1024 * 1024,
  maxLicenseBytes: 64 * 1024
})

export interface CodePenExportZipEvidence {
  readonly evidence: CodePenStaticEvidence
  readonly sourceSet: 'src' | 'dist'
  readonly licenseText: string | null
  readonly archive: Readonly<{
    entryCount: number
    compressedBytes: number
    expandedBytes: number
  }>
}

interface ZipEntryMetadata {
  readonly name: string
  readonly compressedBytes: number
  readonly expandedBytes: number
}

interface InspectedZip {
  readonly entries: readonly ZipEntryMetadata[]
  readonly expandedBytes: number
}

interface CentralDirectory {
  readonly entryCount: number
  readonly offset: number
  readonly byteLength: number
}

interface ParsedCentralEntry extends ZipEntryMetadata {
  readonly nextOffset: number
  readonly collisionKey: string
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const ZIP64_SENTINEL_16 = 0xffff
const ZIP64_SENTINEL_32 = 0xffffffff
const UNIX_HOST = 3
const UNIX_SYMLINK = 0o120000
const UNIX_FILE_TYPE_MASK = 0o170000

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function requireRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new Error(`CodePen Export ZIP has an invalid ${label}.`)
  }
  if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
    throw new Error(`CodePen Export ZIP has a truncated ${label}.`)
  }
}

function findEOCD(bytes: Uint8Array): number {
  const view = dataView(bytes)
  const minimum = Math.max(0, bytes.byteLength - (65_535 + 22))
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  throw new Error('CodePen Export ZIP is missing its central directory.')
}

function decodeEntryName(bytes: Uint8Array): string {
  let name: string
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('CodePen Export ZIP contains a non-UTF-8 entry name.')
  }
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name)
  ) {
    throw new Error('CodePen Export ZIP contains an unsafe entry path.')
  }
  const segments = name.split('/')
  if (segments.some((segment, index) => segment === '..' || (segment === '.' && index > 0))) {
    throw new Error('CodePen Export ZIP contains an unsafe entry path.')
  }
  return name.replace(/^\.\//, '')
}

function readCentralDirectory(bytes: Uint8Array): CentralDirectory {
  const view = dataView(bytes)
  const eocd = findEOCD(bytes)
  requireRange(bytes, eocd, 22, 'end record')
  const disk = view.getUint16(eocd + 4, true)
  const centralDisk = view.getUint16(eocd + 6, true)
  const diskEntries = view.getUint16(eocd + 8, true)
  const entryCount = view.getUint16(eocd + 10, true)
  const centralBytes = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  const commentBytes = view.getUint16(eocd + 20, true)
  requireRange(bytes, eocd + 22, commentBytes, 'archive comment')
  if (eocd + 22 + commentBytes !== bytes.byteLength) {
    throw new Error('CodePen Export ZIP has trailing data after its end record.')
  }
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === ZIP64_SENTINEL_16 ||
    centralBytes === ZIP64_SENTINEL_32 ||
    centralOffset === ZIP64_SENTINEL_32
  ) {
    throw new Error('CodePen Export ZIP must be a single bounded non-ZIP64 archive.')
  }
  if (entryCount === 0 || entryCount > CODEPEN_EXPORT_ZIP_LIMITS.maxEntries) {
    throw new Error('CodePen Export ZIP has an invalid number of entries.')
  }
  requireRange(bytes, centralOffset, centralBytes, 'central directory')
  if (centralOffset + centralBytes > eocd) {
    throw new Error('CodePen Export ZIP central directory overlaps its end record.')
  }
  return { entryCount, offset: centralOffset, byteLength: centralBytes }
}

function readCentralEntry(bytes: Uint8Array, offset: number, index: number): ParsedCentralEntry {
  const view = dataView(bytes)
  requireRange(bytes, offset, 46, `central entry ${index}`)
  if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
    throw new Error('CodePen Export ZIP has an invalid central entry.')
  }
  const host = view.getUint8(offset + 5)
  const flags = view.getUint16(offset + 8, true)
  const compression = view.getUint16(offset + 10, true)
  const compressedBytes = view.getUint32(offset + 20, true)
  const expandedBytes = view.getUint32(offset + 24, true)
  const nameBytes = view.getUint16(offset + 28, true)
  const extraBytes = view.getUint16(offset + 30, true)
  const entryCommentBytes = view.getUint16(offset + 32, true)
  const diskStart = view.getUint16(offset + 34, true)
  const unixMode = view.getUint32(offset + 38, true) >>> 16
  const variableBytes = nameBytes + extraBytes + entryCommentBytes
  requireRange(bytes, offset + 46, variableBytes, `central entry ${index} data`)
  if (
    diskStart !== 0 ||
    compressedBytes === ZIP64_SENTINEL_32 ||
    expandedBytes === ZIP64_SENTINEL_32
  ) {
    throw new Error('CodePen Export ZIP contains an unsupported split or ZIP64 entry.')
  }
  if ((flags & 1) !== 0) throw new Error('Encrypted CodePen Export ZIP entries are not allowed.')
  if (compression !== 0 && compression !== 8) {
    throw new Error('CodePen Export ZIP uses an unsupported compression method.')
  }
  if (host === UNIX_HOST && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK) {
    throw new Error('CodePen Export ZIP symbolic links are not allowed.')
  }
  const name = decodeEntryName(bytes.subarray(offset + 46, offset + 46 + nameBytes))
  if (expandedBytes > CODEPEN_EXPORT_ZIP_LIMITS.maxEntryBytes) {
    throw new Error(`CodePen Export ZIP entry ${name} exceeds the entry size limit.`)
  }
  return {
    name,
    compressedBytes,
    expandedBytes,
    collisionKey: name.toLocaleLowerCase('en-US'),
    nextOffset: offset + 46 + variableBytes
  }
}

function inspectZip(bytes: Uint8Array): InspectedZip {
  if (bytes.byteLength === 0 || bytes.byteLength > CODEPEN_EXPORT_ZIP_LIMITS.maxArchiveBytes) {
    throw new Error('CodePen Export ZIP exceeds the archive size limit.')
  }
  const central = readCentralDirectory(bytes)

  const entries: ZipEntryMetadata[] = []
  const names = new Set<string>()
  let expandedBytes = 0
  let offset = central.offset
  for (let index = 0; index < central.entryCount; index++) {
    const entry = readCentralEntry(bytes, offset, index)
    if (names.has(entry.collisionKey)) {
      throw new Error('CodePen Export ZIP contains duplicate entry paths.')
    }
    names.add(entry.collisionKey)
    expandedBytes += entry.expandedBytes
    if (expandedBytes > CODEPEN_EXPORT_ZIP_LIMITS.maxExpandedBytes) {
      throw new Error('CodePen Export ZIP exceeds the expanded size limit.')
    }
    entries.push({
      name: entry.name,
      compressedBytes: entry.compressedBytes,
      expandedBytes: entry.expandedBytes
    })
    offset = entry.nextOffset
  }
  if (offset !== central.offset + central.byteLength) {
    throw new Error('CodePen Export ZIP central directory size does not match its entries.')
  }
  return { entries, expandedBytes }
}

function suffixMatch(entries: readonly ZipEntryMetadata[], suffix: string): string | null {
  const matches = entries
    .filter((entry) => entry.name === suffix || entry.name.endsWith(`/${suffix}`))
    .map((entry) => entry.name)
  if (matches.length > 1) {
    throw new Error(`CodePen Export ZIP contains multiple ${suffix} candidates.`)
  }
  return matches[0] ?? null
}

function sourcePaths(entries: readonly ZipEntryMetadata[]): {
  sourceSet: 'src' | 'dist'
  html: string
  css: string
  js: string
} {
  for (const sourceSet of ['src', 'dist'] as const) {
    const html = suffixMatch(entries, `${sourceSet}/index.html`)
    const css = suffixMatch(entries, `${sourceSet}/style.css`)
    const js = suffixMatch(entries, `${sourceSet}/script.js`)
    if (html && css && js) return { sourceSet, html, css, js }
  }
  throw new Error(
    'CodePen Export ZIP must contain src/index.html, src/style.css, and src/script.js (or the equivalent dist files).'
  )
}

function decodeText(value: Uint8Array | undefined, label: string): string {
  if (!value) throw new Error(`CodePen Export ZIP is missing ${label}.`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new Error(`CodePen Export ZIP ${label} is not valid UTF-8.`)
  }
}

export async function createCodePenStaticEvidenceFromExportZip(
  archiveBytes: Uint8Array,
  penURL: string
): Promise<CodePenExportZipEvidence> {
  const inspected = inspectZip(archiveBytes)
  const paths = sourcePaths(inspected.entries)
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(archiveBytes)
  } catch {
    throw new Error('CodePen Export ZIP could not be decompressed safely.')
  }
  const licensePath = suffixMatch(inspected.entries, 'LICENSE.txt')
  const rawLicense = licensePath ? unzipped[licensePath] : undefined
  let licenseText: string | null = null
  if (rawLicense && rawLicense.byteLength <= CODEPEN_EXPORT_ZIP_LIMITS.maxLicenseBytes) {
    licenseText = decodeText(rawLicense, 'LICENSE.txt')
  }
  const evidence = await createCodePenStaticEvidence({
    penURL,
    sources: {
      html: decodeText(unzipped[paths.html], paths.html),
      css: decodeText(unzipped[paths.css], paths.css),
      js: decodeText(unzipped[paths.js], paths.js)
    }
  })
  return Object.freeze({
    evidence,
    sourceSet: paths.sourceSet,
    licenseText,
    archive: Object.freeze({
      entryCount: inspected.entries.length,
      compressedBytes: archiveBytes.byteLength,
      expandedBytes: inspected.expandedBytes
    })
  })
}
