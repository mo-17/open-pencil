import type { Size } from '@open-pencil/scene-graph/primitives'

const MAX_HEADER_SCAN_BYTES = 1024 * 1024
const MAX_HEADER_SEGMENTS = 4_096
const MAX_JPEG_TAIL_SCAN_BYTES = 64 * 1024
const JPEG_STANDALONE_MARKERS = new Set([
  0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8
])

export type DimensionStatus = 'parsed' | 'unavailable' | 'invalid' | 'missing'
export type HeaderValidation = 'valid' | 'invalid' | 'missing'

export type ImageDimensions = Size

export interface ImageByteInspection {
  signature: string | null
  mimeType: string | null
  headerValidation: HeaderValidation
  dimensionStatus: DimensionStatus
  dimensions?: ImageDimensions
  reason?: string
}

export const IMAGE_INSPECTION_LIMITS = {
  maxHeaderScanBytes: MAX_HEADER_SCAN_BYTES,
  maxHeaderSegments: MAX_HEADER_SEGMENTS,
  maxJpegTailScanBytes: MAX_JPEG_TAIL_SCAN_BYTES
} as const

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index++) {
    value += String.fromCharCode(bytes[offset + index] ?? 0)
  }
  return value
}

function readUnsigned(
  bytes: Uint8Array,
  offset: number,
  byteLength: number,
  littleEndian: boolean
): number {
  let value = 0
  for (let index = 0; index < byteLength; index++) {
    const byteIndex = littleEndian ? byteLength - index - 1 : index
    value = value * 0x100 + bytes[offset + byteIndex]
  }
  return value
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return readUnsigned(bytes, offset, 2, false)
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return readUnsigned(bytes, offset, 2, true)
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return readUnsigned(bytes, offset, 3, true)
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return readUnsigned(bytes, offset, 4, false)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return readUnsigned(bytes, offset, 4, true)
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  const value = readUint32LE(bytes, offset)
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value
}

function validDimensions(width: number, height: number): ImageDimensions | undefined {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return undefined
  }
  return { width, height }
}

function parsed(
  signature: string,
  mimeType: string,
  width: number,
  height: number
): ImageByteInspection {
  const dimensions = validDimensions(width, height)
  return dimensions
    ? {
        signature,
        mimeType,
        headerValidation: 'valid',
        dimensionStatus: 'parsed',
        dimensions
      }
    : invalid(
        signature,
        mimeType,
        `${signature.toUpperCase()} dimensions are missing, zero, or outside safe integer bounds`
      )
}

function invalid(
  signature: string | null,
  mimeType: string | null,
  reason: string
): ImageByteInspection {
  return { signature, mimeType, headerValidation: 'invalid', dimensionStatus: 'invalid', reason }
}

function unavailable(signature: string, mimeType: string, reason: string): ImageByteInspection {
  return { signature, mimeType, headerValidation: 'valid', dimensionStatus: 'unavailable', reason }
}

function inspectPNG(bytes: Uint8Array): ImageByteInspection {
  const signature = 'png'
  const mimeType = 'image/png'
  if (bytes.byteLength < 33 || readUint32BE(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') {
    return invalid(signature, mimeType, 'PNG is truncated or does not start with IHDR')
  }
  const dimensions = validDimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20))
  if (!dimensions) return parsed(signature, mimeType, 0, 0)

  let offset = 8
  let chunks = 0
  while (offset + 12 <= bytes.byteLength && chunks++ < MAX_HEADER_SEGMENTS) {
    const length = readUint32BE(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    const next = offset + 12 + length
    if (!Number.isSafeInteger(next) || next > bytes.byteLength) {
      return invalid(signature, mimeType, `PNG chunk ${type} exceeds stored bytes`)
    }
    if (type === 'IEND') {
      if (length !== 0) return invalid(signature, mimeType, 'PNG IEND must be empty')
      return parsed(signature, mimeType, dimensions.width, dimensions.height)
    }
    offset = next
  }
  return invalid(signature, mimeType, 'PNG has no bounded, complete IEND chunk')
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function hasJpegEnd(bytes: Uint8Array): boolean {
  const start = Math.max(2, bytes.byteLength - MAX_JPEG_TAIL_SCAN_BYTES)
  for (let index = bytes.byteLength - 2; index >= start; index--) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return true
  }
  return false
}

function inspectJpeg(bytes: Uint8Array): ImageByteInspection {
  const signature = 'jpeg'
  const mimeType = 'image/jpeg'
  if (bytes.byteLength < 4 || !hasJpegEnd(bytes)) {
    return invalid(
      signature,
      mimeType,
      'JPEG is truncated or has no end-of-image marker in the bounded tail scan'
    )
  }

  let offset = 2
  let segments = 0
  const scanEnd = Math.min(bytes.byteLength, MAX_HEADER_SCAN_BYTES)
  while (offset < scanEnd && segments++ < MAX_HEADER_SEGMENTS) {
    if (bytes[offset] !== 0xff) {
      return invalid(signature, mimeType, `JPEG marker expected at byte ${offset}`)
    }
    while (offset < scanEnd && bytes[offset] === 0xff) offset++
    if (offset >= scanEnd) break
    const marker = bytes[offset++]
    if (marker === 0x00) return invalid(signature, mimeType, 'JPEG contains a stray marker')
    if (marker === 0xd9) {
      return invalid(signature, mimeType, 'JPEG reached end-of-image before a start-of-frame')
    }
    if (JPEG_STANDALONE_MARKERS.has(marker)) continue
    if (offset + 2 > bytes.byteLength) {
      return invalid(signature, mimeType, 'JPEG segment length is truncated')
    }
    const segmentLength = readUint16BE(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      return invalid(signature, mimeType, 'JPEG segment exceeds stored bytes')
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) {
        return invalid(signature, mimeType, 'JPEG start-of-frame segment is truncated')
      }
      return parsed(
        signature,
        mimeType,
        readUint16BE(bytes, offset + 5),
        readUint16BE(bytes, offset + 3)
      )
    }
    if (marker === 0xda) {
      return invalid(signature, mimeType, 'JPEG reached start-of-scan before a start-of-frame')
    }
    offset += segmentLength
  }

  return unavailable(
    signature,
    mimeType,
    'JPEG signature is valid but dimensions were not found within the bounded header scan'
  )
}

function inspectWebp(bytes: Uint8Array): ImageByteInspection {
  const signature = 'webp'
  const mimeType = 'image/webp'
  if (bytes.byteLength < 20) return invalid(signature, mimeType, 'WebP is truncated')
  const declaredLength = readUint32LE(bytes, 4) + 8
  if (declaredLength > bytes.byteLength || declaredLength < 12) {
    return invalid(signature, mimeType, 'WebP RIFF length exceeds stored bytes')
  }

  let offset = 12
  let chunks = 0
  const scanEnd = Math.min(declaredLength, MAX_HEADER_SCAN_BYTES)
  while (offset + 8 <= scanEnd && chunks++ < MAX_HEADER_SEGMENTS) {
    const name = ascii(bytes, offset, 4)
    const chunkLength = readUint32LE(bytes, offset + 4)
    const dataOffset = offset + 8
    if (chunkLength > declaredLength - dataOffset) {
      return invalid(signature, mimeType, `WebP chunk ${name} exceeds RIFF bytes`)
    }
    if (name === 'VP8X') {
      if (chunkLength < 10) return invalid(signature, mimeType, 'WebP VP8X is truncated')
      return parsed(
        signature,
        mimeType,
        readUint24LE(bytes, dataOffset + 4) + 1,
        readUint24LE(bytes, dataOffset + 7) + 1
      )
    }
    if (name === 'VP8 ') {
      if (chunkLength < 10 || !hasBytes(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) {
        return invalid(signature, mimeType, 'WebP VP8 frame header is invalid')
      }
      return parsed(
        signature,
        mimeType,
        readUint16LE(bytes, dataOffset + 6) & 0x3fff,
        readUint16LE(bytes, dataOffset + 8) & 0x3fff
      )
    }
    if (name === 'VP8L') {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) {
        return invalid(signature, mimeType, 'WebP VP8L frame header is invalid')
      }
      const packed = readUint32LE(bytes, dataOffset + 1)
      return parsed(signature, mimeType, (packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1)
    }
    offset = dataOffset + chunkLength + (chunkLength & 1)
  }
  return invalid(signature, mimeType, 'WebP has no bounded VP8/VP8L/VP8X frame header')
}

function inspectGif(bytes: Uint8Array): ImageByteInspection {
  const signature = ascii(bytes, 0, 6) === 'GIF87a' ? 'gif87a' : 'gif89a'
  const mimeType = 'image/gif'
  if (bytes.byteLength < 14 || bytes[bytes.byteLength - 1] !== 0x3b) {
    return invalid(signature, mimeType, 'GIF is truncated or has no trailer')
  }
  return parsed(signature, mimeType, readUint16LE(bytes, 6), readUint16LE(bytes, 8))
}

function inspectBmp(bytes: Uint8Array): ImageByteInspection {
  const signature = 'bmp'
  const mimeType = 'image/bmp'
  if (bytes.byteLength < 26) return invalid(signature, mimeType, 'BMP is truncated')
  const declaredLength = readUint32LE(bytes, 2)
  if (declaredLength > bytes.byteLength || declaredLength < 26) {
    return invalid(signature, mimeType, 'BMP declared size exceeds stored bytes')
  }
  const dibSize = readUint32LE(bytes, 14)
  if (14 + dibSize > declaredLength || 14 + dibSize > bytes.byteLength) {
    return invalid(signature, mimeType, 'BMP DIB header exceeds stored bytes')
  }
  if (dibSize === 12) {
    return parsed(signature, mimeType, readUint16LE(bytes, 18), readUint16LE(bytes, 20))
  }
  if (dibSize < 40)
    return invalid(signature, mimeType, 'BMP DIB header is unsupported or truncated')
  return parsed(
    signature,
    mimeType,
    Math.abs(readInt32LE(bytes, 18)),
    Math.abs(readInt32LE(bytes, 22))
  )
}

function inspectIco(bytes: Uint8Array): ImageByteInspection {
  const signature = 'ico'
  const mimeType = 'image/x-icon'
  if (bytes.byteLength < 22 || readUint16LE(bytes, 4) < 1) {
    return invalid(signature, mimeType, 'ICO has no complete directory entry')
  }
  const imageLength = readUint32LE(bytes, 14)
  const imageOffset = readUint32LE(bytes, 18)
  if (imageOffset + imageLength > bytes.byteLength || imageLength === 0) {
    return invalid(signature, mimeType, 'ICO image entry exceeds stored bytes')
  }
  return parsed(
    signature,
    mimeType,
    bytes[6] === 0 ? 256 : bytes[6],
    bytes[7] === 0 ? 256 : bytes[7]
  )
}

function inspectIsoImage(bytes: Uint8Array): ImageByteInspection | undefined {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 4) !== 'ftyp') return undefined
  const boxLength = readUint32BE(bytes, 0)
  if (boxLength < 16 || boxLength > bytes.byteLength) {
    return invalid('iso-bmff', null, 'ISO BMFF ftyp box exceeds stored bytes')
  }
  const brands = new Set<string>([ascii(bytes, 8, 4)])
  const scanEnd = Math.min(boxLength, MAX_HEADER_SCAN_BYTES)
  let segments = 0
  for (
    let offset = 16;
    offset + 4 <= scanEnd && segments < MAX_HEADER_SEGMENTS;
    offset += 4, segments++
  ) {
    brands.add(ascii(bytes, offset, 4))
  }
  if (brands.has('avif') || brands.has('avis')) {
    return unavailable(
      'avif',
      'image/avif',
      'AVIF dimensions require container property traversal and were not guessed'
    )
  }
  if ([...brands].some((brand) => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) {
    return unavailable(
      'heic',
      'image/heic',
      'HEIC dimensions require container property traversal and were not guessed'
    )
  }
  return undefined
}

export function inspectImageBytes(bytes: Uint8Array): ImageByteInspection {
  if (bytes.byteLength === 0) return invalid(null, null, 'Stored image has zero bytes')
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return inspectPNG(bytes)
  }
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return inspectJpeg(bytes)
  if (
    hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return inspectWebp(bytes)
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return inspectGif(bytes)
  }
  if (hasBytes(bytes, 0, [0x42, 0x4d])) return inspectBmp(bytes)
  if (hasBytes(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return inspectIco(bytes)
  const iso = inspectIsoImage(bytes)
  if (iso) return iso
  if (
    hasBytes(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    hasBytes(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    if (bytes.byteLength < 8) return invalid('tiff', 'image/tiff', 'TIFF header is truncated')
    const littleEndian = bytes[0] === 0x49
    const firstIfdOffset = littleEndian ? readUint32LE(bytes, 4) : readUint32BE(bytes, 4)
    if (firstIfdOffset !== 0 && firstIfdOffset + 2 > bytes.byteLength) {
      return invalid('tiff', 'image/tiff', 'TIFF first IFD offset exceeds stored bytes')
    }
    return unavailable(
      'tiff',
      'image/tiff',
      'TIFF dimensions require bounded IFD traversal and were not guessed'
    )
  }
  return invalid(null, null, 'Image signature is unsupported or unrecognized')
}
