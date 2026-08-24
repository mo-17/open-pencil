import { unzipSync, zipSync, type Zippable } from 'fflate'

import type { FigmaObjectAnimationList, NodeChange } from '@open-pencil/kiwi/fig/codec'
import { buildFigKiwi } from '@open-pencil/kiwi/fig/container'
import { decodeFigKiwiCanvas, type FigKiwiDecodeLimits } from '@open-pencil/kiwi/fig/parse'

export interface FigImageEntry {
  name: string
  data: Uint8Array
}

export interface WriteFigArchiveInput {
  schemaDeflated: Uint8Array
  kiwiData: Uint8Array
  thumbnailPNG: Uint8Array
  metaJSON: string
  images?: FigImageEntry[]
  figKiwiVersion?: number
}

export interface FigParseResult {
  nodeChanges: NodeChange[]
  blobs: Uint8Array[]
  /** Message-level object animations, separate from NodeChange.objectAnimations. */
  objectAnimations: FigmaObjectAnimationList | null
  images: Array<[string, Uint8Array]>
  figKiwiVersion: number
  /** Deflated Kiwi schema bytes from the original file, retained for round-trip fidelity. */
  figSchemaDeflated: Uint8Array
  thumbnailPNG: Uint8Array | null
  metaJSON: string | null
}

export interface FigArchiveLimits extends FigKiwiDecodeLimits {
  /** Maximum byte length of the compressed outer ZIP archive. */
  maxArchiveBytes?: number
  /** Maximum number of entries in the outer ZIP archive. */
  maxEntries?: number
  /** Maximum uncompressed size of one outer ZIP entry. */
  maxEntryBytes?: number
  /** Maximum combined uncompressed size of all outer ZIP entries. */
  maxTotalEntryBytes?: number
  /** Maximum uncompressed size of one image entry. */
  maxImageBytes?: number
  /** Maximum combined uncompressed size of all image entries. */
  maxTotalImageBytes?: number
  /** Maximum SceneGraph nodes after instance population in the isolated parser. */
  maxGraphNodes?: number
  /** Maximum parent-chain depth after graph construction. */
  maxTreeDepth?: number
}

export const REMOTE_FIG_ARCHIVE_LIMITS: Readonly<Required<FigArchiveLimits>> = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 2_048,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalEntryBytes: 256 * 1024 * 1024,
  maxImageBytes: 32 * 1024 * 1024,
  maxTotalImageBytes: 192 * 1024 * 1024,
  maxSchemaBytes: 16 * 1024 * 1024,
  maxDataBytes: 192 * 1024 * 1024,
  maxNodeChanges: 200_000,
  maxArrayLength: 200_000,
  maxArrayItems: 1_000_000,
  maxDecodeDepth: 64,
  maxSchemaDefinitions: 4_096,
  maxFieldsPerDefinition: 4_096,
  maxSchemaFields: 65_536,
  maxGraphNodes: 100_000,
  maxTreeDepth: 256
})

export interface ParseFigBufferOptions {
  /** Omit only for explicitly trusted, application-generated round trips. */
  limits?: FigArchiveLimits
}

function checkedLimit(value: number | undefined, label: string): number {
  if (value === undefined) return Number.POSITIVE_INFINITY
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return value
}

/** Reject a compressed archive before a caller allocates or decompresses it. */
export function assertFigArchiveByteLength(byteLength: number, limits?: FigArchiveLimits): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError('FIG archive byteLength must be a non-negative safe integer')
  }
  const maxArchiveBytes = checkedLimit(limits?.maxArchiveBytes, 'maxArchiveBytes')
  if (byteLength > maxArchiveBytes) {
    throw new Error(`.fig archive exceeds the ${maxArchiveBytes} compressed byte limit`)
  }
}

function isLikelyAsset(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.json')
}

function findCanvasData(entries: Partial<Record<string, Uint8Array>>): Uint8Array | null {
  const canonical = entries['canvas.fig'] ?? entries.canvas
  if (canonical) return canonical

  let largest: Uint8Array | null = null
  for (const [name, data] of Object.entries(entries)) {
    if (!data || isLikelyAsset(name)) continue
    if (!largest || data.byteLength > largest.byteLength) largest = data
  }
  return largest
}

/** Parse a complete zipped `.fig` file into its Figma protocol payload and binary resources. */
export function parseFigBuffer(
  buffer: ArrayBuffer,
  options: ParseFigBufferOptions = {}
): FigParseResult {
  const limits = options.limits
  let entryCount = 0
  let totalEntryBytes = 0
  let totalImageBytes = 0
  const maxEntries = checkedLimit(limits?.maxEntries, 'maxEntries')
  const maxEntryBytes = checkedLimit(limits?.maxEntryBytes, 'maxEntryBytes')
  const maxTotalEntryBytes = checkedLimit(limits?.maxTotalEntryBytes, 'maxTotalEntryBytes')
  const maxImageBytes = checkedLimit(limits?.maxImageBytes, 'maxImageBytes')
  const maxTotalImageBytes = checkedLimit(limits?.maxTotalImageBytes, 'maxTotalImageBytes')
  assertFigArchiveByteLength(buffer.byteLength, limits)
  const archive = unzipSync(new Uint8Array(buffer), {
    filter(entry) {
      entryCount += 1
      if (entryCount > maxEntries) {
        throw new Error(`.fig archive exceeds the ${maxEntries} entry limit`)
      }
      if (entry.originalSize > maxEntryBytes) {
        throw new Error(
          `.fig archive entry "${entry.name}" exceeds the ${maxEntryBytes} byte limit`
        )
      }
      totalEntryBytes += entry.originalSize
      if (totalEntryBytes > maxTotalEntryBytes) {
        throw new Error(
          `.fig archive exceeds the ${maxTotalEntryBytes} total uncompressed byte limit`
        )
      }
      if (entry.name.startsWith('images/') && entry.name !== 'images/') {
        if (entry.originalSize > maxImageBytes) {
          throw new Error(`.fig image "${entry.name}" exceeds the ${maxImageBytes} byte limit`)
        }
        totalImageBytes += entry.originalSize
        if (totalImageBytes > maxTotalImageBytes) {
          throw new Error(
            `.fig images exceed the ${maxTotalImageBytes} total uncompressed byte limit`
          )
        }
      }
      return true
    }
  })
  // Recheck the actual output as well as ZIP metadata. A hostile archive may
  // announce inconsistent sizes; only the decompressed byte arrays are
  // authoritative after extraction.
  const actualEntries = Object.entries(archive)
  if (actualEntries.length > maxEntries) {
    throw new Error(`.fig archive exceeds the ${maxEntries} entry limit`)
  }
  let actualTotalEntryBytes = 0
  let actualTotalImageBytes = 0
  for (const [name, data] of actualEntries) {
    if (data.byteLength > maxEntryBytes) {
      throw new Error(`.fig archive entry "${name}" exceeds the ${maxEntryBytes} byte limit`)
    }
    actualTotalEntryBytes += data.byteLength
    if (actualTotalEntryBytes > maxTotalEntryBytes) {
      throw new Error(
        `.fig archive exceeds the ${maxTotalEntryBytes} total uncompressed byte limit`
      )
    }
    if (name.startsWith('images/') && name !== 'images/') {
      if (data.byteLength > maxImageBytes) {
        throw new Error(`.fig image "${name}" exceeds the ${maxImageBytes} byte limit`)
      }
      actualTotalImageBytes += data.byteLength
      if (actualTotalImageBytes > maxTotalImageBytes) {
        throw new Error(
          `.fig images exceed the ${maxTotalImageBytes} total uncompressed byte limit`
        )
      }
    }
  }
  const canvasData = findCanvasData(archive)
  if (!canvasData) {
    throw new Error(
      `No canvas data found in .fig file. Entries: ${Object.keys(archive).join(', ')}`
    )
  }

  const decoded = decodeFigKiwiCanvas(
    canvasData,
    limits
      ? {
          maxSchemaBytes: limits.maxSchemaBytes,
          maxDataBytes: limits.maxDataBytes,
          maxNodeChanges: limits.maxNodeChanges,
          maxArrayLength: limits.maxArrayLength,
          maxArrayItems: limits.maxArrayItems,
          maxDecodeDepth: limits.maxDecodeDepth,
          maxSchemaDefinitions: limits.maxSchemaDefinitions,
          maxFieldsPerDefinition: limits.maxFieldsPerDefinition,
          maxSchemaFields: limits.maxSchemaFields
        }
      : undefined
  )
  const metaBytes = archive['meta.json']
  const images = Object.entries(archive)
    .filter(([name]) => name.startsWith('images/') && name !== 'images/')
    .map(([name, data]) => [name.slice('images/'.length), data] as [string, Uint8Array])

  return {
    ...decoded,
    images,
    thumbnailPNG: archive['thumbnail.png'] ?? null,
    metaJSON: Object.hasOwn(archive, 'meta.json') ? new TextDecoder().decode(metaBytes) : null
  }
}

/** Assemble a complete zipped `.fig` archive from an encoded Kiwi message and resources. */
export function writeFigArchive(input: WriteFigArchiveInput): Uint8Array {
  const canvasData = buildFigKiwi(input.schemaDeflated, input.kiwiData, input.figKiwiVersion)
  const entries: Zippable = {
    'canvas.fig': [canvasData, { level: 0 }],
    'thumbnail.png': [input.thumbnailPNG, { level: 0 }],
    'meta.json': new TextEncoder().encode(input.metaJSON)
  }
  for (const image of input.images ?? []) entries[image.name] = [image.data, { level: 0 }]
  return zipSync(entries)
}

/** Compatibility signature used by core while archive assembly migrates to this package. */
export function compressFigDataSync(
  schemaDeflated: Uint8Array,
  kiwiData: Uint8Array,
  thumbnailPNG: Uint8Array,
  metaJSON: string,
  imageEntries: FigImageEntry[],
  figKiwiVersion?: number
): Uint8Array {
  return writeFigArchive({
    schemaDeflated,
    kiwiData,
    thumbnailPNG,
    metaJSON,
    images: imageEntries,
    figKiwiVersion
  })
}
