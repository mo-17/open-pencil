/* eslint-disable max-lines -- CSS parsing and asset validation form one fail-closed boundary. */
import { Buffer } from 'node:buffer'
import { posix } from 'node:path'

import { inspectImageBytes } from '@open-pencil/scene-graph'

const SAFE_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_-]*$/
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9@._+-]+$/
const MAX_CSS_BYTES = 1_100_000
const MAX_CSS_URLS = 4_096
const MAX_ASSET_DATA_URL_BYTES = 1_000_000
const RESOURCE_STRING = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/|\/)/
const UNSUPPORTED_RESOURCE_FUNCTIONS = new Set([
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade'
])

export interface CodePenCSSSource {
  path: string
  content: string
}

export class CodePenCSSAssetError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'CodePenCSSAssetError'
  }
}

export function codePenAssetMimeType(path: string): string | null {
  const extension = posix.extname(path).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.woff') return 'font/woff'
  if (extension === '.woff2') return 'font/woff2'
  if (extension === '.ttf') return 'font/ttf'
  if (extension === '.otf') return 'font/otf'
  return null
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (bytes[offset + 1] ?? 0) * 0x10000 +
    (bytes[offset + 2] ?? 0) * 0x100 +
    (bytes[offset + 3] ?? 0)
  )
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x100 +
    (bytes[offset + 2] ?? 0) * 0x10000 +
    (bytes[offset + 3] ?? 0) * 0x1000000
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function exactPNGContainer(bytes: Uint8Array): boolean {
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32BE(bytes, offset)
    if (length > bytes.byteLength - offset - 12) return false
    const type = ascii(bytes, offset + 4, 4)
    offset += 12 + length
    if (type === 'IEND') return length === 0 && offset === bytes.byteLength
  }
  return false
}

interface JPEGMarker {
  marker: number
  offset: number
}

function readJPEGMarker(bytes: Uint8Array, start: number): JPEGMarker | null {
  let offset = start
  if (bytes[offset++] !== 0xff) return null
  while (bytes[offset] === 0xff) offset++
  if (offset >= bytes.byteLength) return null
  return { marker: bytes[offset++], offset }
}

function readJPEGEntropyMarker(bytes: Uint8Array, start: number): JPEGMarker | null {
  let offset = start
  while (offset < bytes.byteLength) {
    if (bytes[offset++] !== 0xff) continue
    while (bytes[offset] === 0xff) offset++
    if (offset >= bytes.byteLength) return null
    const marker = bytes[offset++]
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue
    return { marker, offset }
  }
  return null
}

function exactJPEGContainer(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let offset = 2
  let inEntropyScan = false
  while (offset < bytes.byteLength) {
    const next = inEntropyScan
      ? readJPEGEntropyMarker(bytes, offset)
      : readJPEGMarker(bytes, offset)
    if (!next) return false
    const { marker } = next
    offset = next.offset
    if (marker === 0xd9) return offset === bytes.byteLength
    if (marker === 0xd8 || marker === 0x00) return false
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      if (!inEntropyScan && marker !== 0x01) return false
      continue
    }
    inEntropyScan = false
    if (offset + 2 > bytes.byteLength) return false
    const segmentLength = readUint16BE(bytes, offset)
    if (segmentLength < 2 || segmentLength > bytes.byteLength - offset) return false
    offset += segmentLength
    if (marker === 0xda) inEntropyScan = true
  }
  return false
}

function exactImageContainer(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/png') return exactPNGContainer(bytes)
  if (mimeType === 'image/jpeg') return exactJPEGContainer(bytes)
  if (mimeType === 'image/webp') {
    return bytes.byteLength >= 12 && readUint32LE(bytes, 4) + 8 === bytes.byteLength
  }
  return false
}

function validSfnt(bytes: Uint8Array, signature: string): boolean {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== signature) return false
  const tables = readUint16BE(bytes, 4)
  if (tables === 0 || 12 + tables * 16 > bytes.byteLength) return false
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16
    const offset = readUint32BE(bytes, record + 8)
    const length = readUint32BE(bytes, record + 12)
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) return false
  }
  return true
}

function readBase128(bytes: Uint8Array, start: number): { end: number; value: number } | null {
  let index = start
  let value = 0
  for (let count = 0; count < 5; count++) {
    if (index >= bytes.byteLength) return null
    const byte = bytes[index++]
    if ((count === 0 && byte === 0x80) || value > 0x1ff_ffff) return null
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return { end: index, value }
  }
  return null
}

function validOptionalWoff2Block(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    (offset === 0 && length === 0) ||
    (offset > 0 && length > 0 && length <= bytes.byteLength - offset)
  )
}

function validWoff2Directory(bytes: Uint8Array, tables: number, compressedSize: number): boolean {
  let cursor = 48
  for (let index = 0; index < tables; index++) {
    if (cursor >= bytes.byteLength) return false
    const flags = bytes[cursor++]
    const tagIndex = flags & 0x3f
    let customTag = ''
    if (tagIndex === 0x3f) {
      if (cursor + 4 > bytes.byteLength) return false
      customTag = ascii(bytes, cursor, 4)
      cursor += 4
    }
    const originalLength = readBase128(bytes, cursor)
    if (!originalLength || originalLength.value === 0) return false
    cursor = originalLength.end
    const transformVersion = flags >> 6
    const glyfOrLoca =
      tagIndex === 9 || tagIndex === 10 || customTag === 'glyf' || customTag === 'loca'
    const transformed = glyfOrLoca ? transformVersion === 0 : transformVersion !== 0
    if (transformed) {
      const transformedLength = readBase128(bytes, cursor)
      if (!transformedLength) return false
      cursor = transformedLength.end
    }
  }
  return compressedSize > 0 && cursor <= bytes.byteLength - compressedSize
}

function validWoff(bytes: Uint8Array, signature: 'wOFF' | 'wOF2'): boolean {
  const minimum = signature === 'wOFF' ? 44 : 48
  if (
    bytes.byteLength < minimum ||
    ascii(bytes, 0, 4) !== signature ||
    readUint32BE(bytes, 8) !== bytes.byteLength ||
    readUint16BE(bytes, 12) === 0
  ) {
    return false
  }
  if (signature === 'wOF2') {
    const compressedSize = readUint32BE(bytes, 20)
    const metadataOffset = readUint32BE(bytes, 28)
    const metadataLength = readUint32BE(bytes, 32)
    const metadataOriginalLength = readUint32BE(bytes, 36)
    const privateOffset = readUint32BE(bytes, 40)
    const privateLength = readUint32BE(bytes, 44)
    return (
      readUint16BE(bytes, 14) === 0 &&
      readUint32BE(bytes, 16) > 0 &&
      validWoff2Directory(bytes, readUint16BE(bytes, 12), compressedSize) &&
      validOptionalWoff2Block(bytes, metadataOffset, metadataLength) &&
      ((metadataOffset === 0 && metadataOriginalLength === 0) ||
        (metadataOffset > 0 && metadataOriginalLength > 0)) &&
      validOptionalWoff2Block(bytes, privateOffset, privateLength)
    )
  }
  const tables = readUint16BE(bytes, 12)
  if (44 + tables * 20 > bytes.byteLength) return false
  for (let index = 0; index < tables; index++) {
    const record = 44 + index * 20
    const offset = readUint32BE(bytes, record + 4)
    const compressedLength = readUint32BE(bytes, record + 8)
    if (offset > bytes.byteLength || compressedLength > bytes.byteLength - offset) return false
  }
  return true
}

function assertValidAsset(path: string, bytes: Uint8Array, mimeType: string): void {
  if (mimeType.startsWith('image/')) {
    const inspection = inspectImageBytes(bytes)
    const dimensions = inspection.dimensions
    if (
      inspection.mimeType !== mimeType ||
      inspection.headerValidation !== 'valid' ||
      inspection.dimensionStatus !== 'parsed' ||
      !dimensions ||
      !exactImageContainer(bytes, mimeType) ||
      dimensions.width > 32_768 ||
      dimensions.height > 32_768 ||
      dimensions.width * dimensions.height > 50_000_000
    ) {
      throw new CodePenCSSAssetError(
        'invalid-stylesheet-asset',
        'CodePen export blocked: a stylesheet image asset is invalid'
      )
    }
    return
  }
  const extension = posix.extname(path).toLowerCase()
  const valid =
    (extension === '.ttf' && validSfnt(bytes, '\u0000\u0001\u0000\u0000')) ||
    (extension === '.otf' && validSfnt(bytes, 'OTTO')) ||
    (extension === '.woff' && validWoff(bytes, 'wOFF')) ||
    (extension === '.woff2' && validWoff(bytes, 'wOF2'))
  if (!valid) {
    throw new CodePenCSSAssetError(
      'invalid-stylesheet-asset',
      'CodePen export blocked: a stylesheet font asset is invalid'
    )
  }
}

export function codePenAssetDataURL(path: string, bytes: Uint8Array): string {
  const mimeType = codePenAssetMimeType(path)
  if (!mimeType) {
    throw new CodePenCSSAssetError(
      'unsupported-stylesheet-asset',
      'CodePen export blocked: a stylesheet asset type is unsupported'
    )
  }
  assertValidAsset(path, bytes, mimeType)
  const encodedLength = `data:${mimeType};base64,`.length + 4 * Math.ceil(bytes.byteLength / 3)
  if (encodedLength > MAX_ASSET_DATA_URL_BYTES) {
    throw new CodePenCSSAssetError(
      'asset-output-limit',
      'CodePen export blocked: encoded browser assets exceed the CSS pane limit'
    )
  }
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`
}

export function assertCodePenBinaryAssetBudget(
  files: ReadonlyMap<string, string | Uint8Array>
): void {
  let encodedBytes = 0
  for (const [path, content] of files) {
    if (!(content instanceof Uint8Array)) continue
    const mimeType = codePenAssetMimeType(path)
    if (!mimeType) {
      throw new CodePenCSSAssetError(
        'unsupported-stylesheet-asset',
        'CodePen export blocked: a browser asset type is unsupported'
      )
    }
    assertValidAsset(path, content, mimeType)
    encodedBytes += `data:${mimeType};base64,`.length + 4 * Math.ceil(content.byteLength / 3)
    if (encodedBytes > MAX_ASSET_DATA_URL_BYTES) {
      throw new CodePenCSSAssetError(
        'asset-output-limit',
        'CodePen export blocked: encoded browser assets exceed the CSS pane limit'
      )
    }
  }
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character)
}

function readIdentifier(source: string, start: number): { decoded: string; end: number } {
  let decoded = ''
  let index = start
  while (index < source.length) {
    if (isIdentifierCharacter(source[index])) {
      decoded += source[index++]
      continue
    }
    if (source[index] !== '\\') break
    index++
    const hex = source.slice(index).match(/^[0-9A-Fa-f]{1,6}/)?.[0]
    if (hex) {
      const codePoint = Number.parseInt(hex, 16)
      if (codePoint === 0 || codePoint > 0x10ffff) {
        throw new CodePenCSSAssetError(
          'unsafe-stylesheet-url',
          'CodePen export blocked: stylesheet syntax is unsafe'
        )
      }
      decoded += String.fromCodePoint(codePoint)
      index += hex.length
      if (/\s/.test(source[index] ?? '')) index++
      continue
    }
    const escaped = source[index]
    if (escaped === '\n' || escaped === '\r') {
      throw new CodePenCSSAssetError(
        'unsafe-stylesheet-url',
        'CodePen export blocked: stylesheet syntax is unsafe'
      )
    }
    decoded += escaped
    index++
  }
  return { decoded, end: index }
}

function skipComment(source: string, start: number): number {
  const end = source.indexOf('*/', start + 2)
  if (end === -1) {
    throw new CodePenCSSAssetError(
      'unsafe-stylesheet-url',
      'CodePen export blocked: stylesheet syntax is unsafe'
    )
  }
  return end + 2
}

function readString(source: string, start: number): { decoded: string; end: number } {
  const quote = source[start]
  let decoded = ''
  let index = start + 1
  while (index < source.length) {
    if (source[index] === '\\') {
      index++
      const hex = source.slice(index).match(/^[0-9A-Fa-f]{1,6}/)?.[0]
      if (hex) {
        const codePoint = Number.parseInt(hex, 16)
        if (codePoint === 0 || codePoint > 0x10ffff) {
          throw new CodePenCSSAssetError(
            'unsafe-stylesheet-url',
            'CodePen export blocked: stylesheet syntax is unsafe'
          )
        }
        decoded += String.fromCodePoint(codePoint)
        index += hex.length
        if (/\s/.test(source[index] ?? '')) index++
        continue
      }
      const escaped = source[index]
      if (escaped === '\n' || escaped === '\r') {
        throw new CodePenCSSAssetError(
          'unsafe-stylesheet-url',
          'CodePen export blocked: stylesheet syntax is unsafe'
        )
      }
      decoded += escaped
      index++
      continue
    }
    if (source[index] === quote) return { decoded, end: index + 1 }
    decoded += source[index++]
  }
  throw new CodePenCSSAssetError(
    'unsafe-stylesheet-url',
    'CodePen export blocked: stylesheet syntax is unsafe'
  )
}

interface URLToken {
  end: number
  value: string
}

function unsafeURL(): never {
  throw new CodePenCSSAssetError(
    'unsafe-stylesheet-url',
    'CodePen export blocked: a stylesheet URL is unsafe'
  )
}

function parseQuotedURL(source: string, start: number, quote: string): URLToken {
  let index = start
  const valueStart = index
  while (index < source.length && source[index] !== quote) {
    if (source[index] === '\\' || source.startsWith('/*', index)) unsafeURL()
    index++
  }
  if (source[index] !== quote) unsafeURL()
  const value = source.slice(valueStart, index)
  index++
  while (/\s/.test(source[index] ?? '')) index++
  if (source[index] !== ')') unsafeURL()
  return { end: index + 1, value }
}

function parseUnquotedURL(source: string, start: number): URLToken {
  let index = start
  const valueStart = index
  while (index < source.length && source[index] !== ')') {
    const character = source[index]
    if (
      character === '\\' ||
      character === '"' ||
      character === "'" ||
      character === '(' ||
      source.startsWith('/*', index)
    ) {
      unsafeURL()
    }
    index++
  }
  if (source[index] !== ')') unsafeURL()
  const value = source.slice(valueStart, index).trim()
  if (/\s/.test(value)) unsafeURL()
  return { end: index + 1, value }
}

function parseURLToken(source: string, openParenthesis: number): URLToken {
  let index = openParenthesis + 1
  while (/\s/.test(source[index] ?? '')) index++
  const quote = source[index] === '"' || source[index] === "'" ? source[index++] : null
  return quote ? parseQuotedURL(source, index, quote) : parseUnquotedURL(source, index)
}

function safeRelativeAssetPath(value: string): boolean {
  let hasControlCharacter = false
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    hasControlCharacter ||= codePoint <= 0x20 || codePoint === 0x7f
  }
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('%') ||
    hasControlCharacter
  ) {
    return false
  }
  return value
    .split('/')
    .every(
      (segment, index) =>
        segment === '..' || (segment === '.' && index === 0) || SAFE_PATH_SEGMENT.test(segment)
    )
}

function resolveAssetURL(
  value: string,
  sourcePaths: readonly string[],
  files: ReadonlyMap<string, string | Uint8Array>,
  allowedDataURLs: ReadonlySet<string>,
  dataURLCache: Map<string, string>
): string {
  if (SAFE_FRAGMENT.test(value)) return value
  if (allowedDataURLs.has(value)) return value
  if (!safeRelativeAssetPath(value)) {
    throw new CodePenCSSAssetError(
      'unsafe-stylesheet-url',
      'CodePen export blocked: a stylesheet URL is unsafe'
    )
  }
  const matches = new Map<string, Uint8Array>()
  for (const sourcePath of sourcePaths) {
    const candidate = posix.normalize(posix.join(posix.dirname(sourcePath), value))
    if (candidate.startsWith('../') || candidate.startsWith('/')) continue
    const content = files.get(candidate)
    if (content instanceof Uint8Array) matches.set(candidate, content)
  }
  if (matches.size !== 1) {
    throw new CodePenCSSAssetError(
      matches.size === 0 ? 'missing-stylesheet-asset' : 'ambiguous-stylesheet-asset',
      matches.size === 0
        ? 'CodePen export blocked: a stylesheet asset is missing or is not binary'
        : 'CodePen export blocked: a stylesheet asset reference is ambiguous'
    )
  }
  const match = matches.entries().next()
  if (match.done) {
    throw new CodePenCSSAssetError(
      'missing-stylesheet-asset',
      'CodePen export blocked: a stylesheet asset is missing or is not binary'
    )
  }
  const cached = dataURLCache.get(match.value[0])
  if (cached) return cached
  const dataURL = codePenAssetDataURL(match.value[0], match.value[1])
  dataURLCache.set(match.value[0], dataURL)
  return dataURL
}

export function rewriteCodePenCSSAssetURLs(
  source: string,
  sourcePaths: readonly string[],
  files: ReadonlyMap<string, string | Uint8Array>,
  allowedDataURLs: ReadonlySet<string> = new Set()
): { content: string; dataURLs: readonly string[] } {
  if (new TextEncoder().encode(source).byteLength > MAX_CSS_BYTES) {
    throw new CodePenCSSAssetError(
      'stylesheet-limit',
      'CodePen export blocked: a stylesheet exceeds the processing limit'
    )
  }
  let index = 0
  let copiedUntil = 0
  let output = ''
  let outputBytes = 0
  const dataURLs = new Set<string>()
  const dataURLCache = new Map<string, string>()
  let urlCount = 0
  const append = (value: string, assetExpansion: boolean): void => {
    outputBytes += new TextEncoder().encode(value).byteLength
    if (outputBytes > MAX_ASSET_DATA_URL_BYTES) {
      throw new CodePenCSSAssetError(
        assetExpansion ? 'asset-output-limit' : 'stylesheet-limit',
        assetExpansion
          ? 'CodePen export blocked: encoded browser assets exceed the CSS pane limit'
          : 'CodePen export blocked: a stylesheet exceeds the output limit'
      )
    }
    output += value
  }
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      index = skipComment(source, index)
      continue
    }
    if (source[index] === '"' || source[index] === "'") {
      const string = readString(source, index)
      if (RESOURCE_STRING.test(string.decoded.trim())) {
        throw new CodePenCSSAssetError(
          'unsafe-stylesheet-url',
          'CodePen export blocked: a stylesheet resource string is unsafe'
        )
      }
      index = string.end
      continue
    }
    if (!isIdentifierCharacter(source[index]) && source[index] !== '\\') {
      index++
      continue
    }
    const identifierStart = index
    const identifier = readIdentifier(source, index)
    index = identifier.end
    const normalizedIdentifier = identifier.decoded.toLowerCase()
    while (/\s/.test(source[index] ?? '')) index++
    if (source[index] !== '(') continue
    if (UNSUPPORTED_RESOURCE_FUNCTIONS.has(normalizedIdentifier)) {
      throw new CodePenCSSAssetError(
        'unsafe-stylesheet-url',
        'CodePen export blocked: a stylesheet resource function is unsupported'
      )
    }
    if (normalizedIdentifier !== 'url') continue
    urlCount++
    if (urlCount > MAX_CSS_URLS) {
      throw new CodePenCSSAssetError(
        'stylesheet-limit',
        'CodePen export blocked: a stylesheet exceeds the URL processing limit'
      )
    }
    const token = parseURLToken(source, index)
    const replacement = resolveAssetURL(
      token.value,
      sourcePaths,
      files,
      allowedDataURLs,
      dataURLCache
    )
    if (replacement.startsWith('data:')) dataURLs.add(replacement)
    append(source.slice(copiedUntil, identifierStart), false)
    append(`url(${JSON.stringify(replacement)})`, replacement.startsWith('data:'))
    copiedUntil = token.end
    index = token.end
  }
  append(source.slice(copiedUntil), false)
  return { content: output, dataURLs: [...dataURLs] }
}
