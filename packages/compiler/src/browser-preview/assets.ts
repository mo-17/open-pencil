import { inspectImageBytes } from '@open-pencil/scene-graph'

import { failBrowserPreview } from './error'
import { BROWSER_PREVIEW_LIMITS } from './limits'
import { extension } from './path'

const IMAGE_MIME_TYPES: Readonly<Partial<Record<string, string>>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
})
const FONT_MIME_TYPES: Readonly<Partial<Record<string, string>>> = Object.freeze({
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
})

export function isBrowserPreviewFontPath(path: string): boolean {
  return FONT_MIME_TYPES[extension(path)] !== undefined
}

function uint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function uint32BE(bytes: Uint8Array, offset: number): number {
  let value = 0
  for (let index = offset; index < offset + 4; index++) value = value * 256 + (bytes[index] ?? 0)
  return value
}

function uint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x100 +
    (bytes[offset + 2] ?? 0) * 0x10000 +
    (bytes[offset + 3] ?? 0) * 0x1000000
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = ''
  for (let index = offset; index < offset + length; index++) {
    value += String.fromCharCode(bytes[index] ?? 0)
  }
  return value
}

function completePNG(bytes: Uint8Array): boolean {
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = uint32BE(bytes, offset)
    if (length > bytes.byteLength - offset - 12) return false
    const kind = ascii(bytes, offset + 4, 4)
    offset += length + 12
    if (kind === 'IEND') return length === 0 && offset === bytes.byteLength
  }
  return false
}

function completeJPEG(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let offset = 2
  let entropy = false
  while (offset < bytes.byteLength) {
    if (bytes[offset++] !== 0xff) {
      if (entropy) continue
      return false
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset++]
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!entropy && marker !== 0x01) return false
      continue
    }
    if (marker === 0xd9) return offset === bytes.byteLength
    if (marker === 0xd8 || offset + 2 > bytes.byteLength) return false
    entropy = false
    const segmentLength = uint16BE(bytes, offset)
    if (segmentLength < 2 || segmentLength > bytes.byteLength - offset) return false
    offset += segmentLength
    if (marker === 0xda) entropy = true
  }
  return false
}

function completeWebP(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WEBP' &&
    uint32LE(bytes, 4) + 8 === bytes.byteLength
  )
}

function validSfnt(bytes: Uint8Array, signature: string): boolean {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== signature) return false
  const tableCount = uint16BE(bytes, 4)
  if (tableCount === 0 || 12 + tableCount * 16 > bytes.byteLength) return false
  for (let index = 0; index < tableCount; index++) {
    const record = 12 + index * 16
    const offset = uint32BE(bytes, record + 8)
    const length = uint32BE(bytes, record + 12)
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) return false
  }
  return true
}

function declaredWoffExpandedSize(bytes: Uint8Array, signature: 'wOFF' | 'wOF2'): number | null {
  const minimum = signature === 'wOFF' ? 44 : 48
  const expandedSize = uint32BE(bytes, 16)
  if (
    bytes.byteLength < minimum ||
    ascii(bytes, 0, 4) !== signature ||
    uint32BE(bytes, 8) !== bytes.byteLength ||
    uint16BE(bytes, 12) === 0 ||
    uint16BE(bytes, 14) !== 0 ||
    expandedSize === 0 ||
    expandedSize > BROWSER_PREVIEW_LIMITS.maxExpandedFontBytes
  ) {
    return null
  }
  return expandedSize
}

function validWoff2Payload(bytes: Uint8Array): boolean {
  const compressedSize = uint32BE(bytes, 20)
  const metadataOffset = uint32BE(bytes, 28)
  const metadataLength = uint32BE(bytes, 32)
  const privateOffset = uint32BE(bytes, 40)
  const privateLength = uint32BE(bytes, 44)
  return (
    compressedSize > 0 &&
    compressedSize <= bytes.byteLength - 48 &&
    validOptionalBlock(bytes, metadataOffset, metadataLength) &&
    validOptionalBlock(bytes, privateOffset, privateLength)
  )
}

function woff1ExpandedSize(bytes: Uint8Array, expandedSize: number): number | null {
  const tableCount = uint16BE(bytes, 12)
  if (44 + tableCount * 20 > bytes.byteLength) return null
  let expandedTableBytes = 12 + tableCount * 16
  for (let index = 0; index < tableCount; index++) {
    const record = 44 + index * 20
    const offset = uint32BE(bytes, record + 4)
    const compressedLength = uint32BE(bytes, record + 8)
    const originalLength = uint32BE(bytes, record + 12)
    if (
      offset > bytes.byteLength ||
      compressedLength > bytes.byteLength - offset ||
      compressedLength > originalLength
    ) {
      return null
    }
    expandedTableBytes += Math.ceil(originalLength / 4) * 4
    if (expandedTableBytes > BROWSER_PREVIEW_LIMITS.maxExpandedFontBytes) return null
  }
  return expandedTableBytes === expandedSize ? expandedSize : null
}

function woffExpandedSize(bytes: Uint8Array, signature: 'wOFF' | 'wOF2'): number | null {
  const expandedSize = declaredWoffExpandedSize(bytes, signature)
  if (expandedSize === null) return null
  if (signature === 'wOF2') return validWoff2Payload(bytes) ? expandedSize : null
  return woff1ExpandedSize(bytes, expandedSize)
}

function validOptionalBlock(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    (offset === 0 && length === 0) ||
    (offset >= 48 && length > 0 && length <= bytes.byteLength - offset)
  )
}

function validateImage(path: string, bytes: Uint8Array, mimeType: string): void {
  const inspected = inspectImageBytes(bytes)
  const dimensions = inspected.dimensions
  let complete = false
  if (mimeType === 'image/png') complete = completePNG(bytes)
  else if (mimeType === 'image/jpeg') complete = completeJPEG(bytes)
  else complete = completeWebP(bytes)
  if (
    inspected.mimeType !== mimeType ||
    inspected.headerValidation !== 'valid' ||
    inspected.dimensionStatus !== 'parsed' ||
    !dimensions ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > 32_768 ||
    dimensions.height > 32_768 ||
    dimensions.width * dimensions.height > BROWSER_PREVIEW_LIMITS.maxImagePixels ||
    !complete
  ) {
    failBrowserPreview(
      'browser-preview-image-invalid',
      'Browser preview blocked an invalid or oversized image asset.',
      path
    )
  }
}

function validateFont(path: string, bytes: Uint8Array): number {
  const ext = extension(path)
  let expandedSize: number | null = null
  if (ext === '.ttf' && validSfnt(bytes, '\u0000\u0001\u0000\u0000')) {
    expandedSize = bytes.byteLength
  } else if (ext === '.otf' && validSfnt(bytes, 'OTTO')) {
    expandedSize = bytes.byteLength
  } else if (ext === '.woff') {
    expandedSize = woffExpandedSize(bytes, 'wOFF')
  } else if (ext === '.woff2') {
    expandedSize = woffExpandedSize(bytes, 'wOF2')
  }
  if (expandedSize === null) {
    failBrowserPreview(
      'browser-preview-font-invalid',
      'Browser preview blocked an invalid font asset.',
      path
    )
  }
  return expandedSize
}

function mimeType(path: string): string | null {
  const ext = extension(path)
  return IMAGE_MIME_TYPES[ext] ?? FONT_MIME_TYPES[ext] ?? null
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength))
    for (const byte of chunk) binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

export class BrowserPreviewAssetRegistry {
  readonly #cache = new Map<string, string>()
  #encodedBytes = 0

  constructor(files: ReadonlyMap<string, string | Uint8Array>) {
    let images = 0
    let fonts = 0
    let expandedFontBytes = 0
    for (const [path, content] of files) {
      if (!(content instanceof Uint8Array)) continue
      const type = mimeType(path)
      if (!type) {
        failBrowserPreview(
          'browser-preview-asset-type-unsupported',
          'Browser preview supports only PNG, JPEG, WebP, WOFF, WOFF2, TTF, and OTF assets.',
          path
        )
      }
      if (type.startsWith('image/')) {
        images += 1
        validateImage(path, content, type)
      } else {
        fonts += 1
        if (content.byteLength > BROWSER_PREVIEW_LIMITS.maxFontFileBytes) {
          failBrowserPreview(
            'browser-preview-font-size-limit',
            `Browser preview font assets must be ${BROWSER_PREVIEW_LIMITS.maxFontFileBytes / 1024 / 1024} MiB or smaller.`,
            path
          )
        }
        expandedFontBytes += validateFont(path, content)
        if (expandedFontBytes > BROWSER_PREVIEW_LIMITS.maxExpandedFontBytes) {
          failBrowserPreview(
            'browser-preview-font-expanded-limit',
            'Browser preview font assets exceed the aggregate expanded byte limit.',
            path
          )
        }
      }
      if (images > BROWSER_PREVIEW_LIMITS.maxImageAssets) {
        failBrowserPreview(
          'browser-preview-asset-count-limit',
          'Browser preview image count exceeds its dedicated limit.'
        )
      }
      if (fonts > BROWSER_PREVIEW_LIMITS.maxFontAssets) {
        failBrowserPreview(
          'browser-preview-font-count-limit',
          `Browser preview supports at most ${BROWSER_PREVIEW_LIMITS.maxFontAssets} font assets.`
        )
      }
      const encodedLength = `data:${type};base64,`.length + 4 * Math.ceil(content.byteLength / 3)
      this.#encodedBytes += encodedLength
      if (this.#encodedBytes > BROWSER_PREVIEW_LIMITS.maxEncodedAssetBytes) {
        failBrowserPreview(
          'browser-preview-asset-output-limit',
          'Browser preview encoded assets exceed the aggregate output limit.'
        )
      }
    }
  }

  dataURL(path: string, bytes: Uint8Array): string {
    const cached = this.#cache.get(path)
    if (cached) return cached
    const type = mimeType(path)
    if (!type) {
      failBrowserPreview(
        'browser-preview-asset-type-unsupported',
        'Browser preview blocked an unsupported asset type.',
        path
      )
    }
    const url = `data:${type};base64,${base64(bytes)}`
    this.#cache.set(path, url)
    return url
  }
}
