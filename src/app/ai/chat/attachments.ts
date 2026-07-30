/* oxlint-disable eslint/max-lines -- MIME header validation and browser normalization share one attachment safety boundary. */
import { isFileUIPart, type FileUIPart, type UIMessage } from 'ai'

import { encodeBase64 } from '@open-pencil/core/bytes'
import { randomHex } from '@open-pencil/core/random'
import type { Size } from '@open-pencil/scene-graph/primitives'

export const SUPPORTED_VISUAL_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const MAX_VISUAL_ATTACHMENTS = 4
export const MAX_VISUAL_ATTACHMENT_EDGE = 2_048
export const MAX_VISUAL_ATTACHMENT_TOTAL_BYTES = 6 * 1024 * 1024
export const MAX_VISUAL_REFERENCE_NODE_IDS = 64

const LOSSY_QUALITIES = [0.9, 0.8, 0.7, 0.6] as const
const MAX_ENCODE_ATTEMPTS = 12
const MAX_VISUAL_REFERENCE_NODE_ID_LENGTH = 128
const VISUAL_REFERENCE_SOURCE_CONTEXT_SCHEMA = 'openpencil.visual-reference-source.v1'
const VISUAL_REFERENCE_SOURCE_CONTEXT_BEGIN = '[BEGIN_OPENPENCIL_VISUAL_REFERENCE_SOURCE_CONTEXT]'
const VISUAL_REFERENCE_SOURCE_CONTEXT_END = '[END_OPENPENCIL_VISUAL_REFERENCE_SOURCE_CONTEXT]'
const SAFE_VISUAL_REFERENCE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/

export type VisualAttachmentMediaType = (typeof SUPPORTED_VISUAL_ATTACHMENT_TYPES)[number]
export type VisualChatAttachmentSource = 'file' | 'selection'

export interface VisualChatAttachmentThumbnail {
  url: string
  sizeBytes: number
  width: number
  height: number
}

/** A metadata-scrubbed image that can be sent as an AI SDK FileUIPart. */
export interface VisualChatAttachment {
  id: string
  name: string
  mediaType: VisualAttachmentMediaType
  url: string
  sizeBytes: number
  width: number
  height: number
  source: VisualChatAttachmentSource
  sourceSizeBytes: number
  sourceWidth: number
  sourceHeight: number
  canvasNodeIds?: string[]
  thumbnail: VisualChatAttachmentThumbnail
}

export interface VisualChatAttachmentInput {
  id?: string
  name?: string
  mediaType: string
  bytes: Uint8Array
  source: VisualChatAttachmentSource
}

export interface VisualAttachmentLimits {
  maxInputBytes: number
  maxSourcePixels: number
  maxOutputPixels: number
  maxOutputEdge: number
  maxOutputBytes: number
  thumbnailMaxEdge: number
  thumbnailMaxBytes: number
}

export const DEFAULT_VISUAL_ATTACHMENT_LIMITS: Readonly<VisualAttachmentLimits> = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxSourcePixels: 50_000_000,
  maxOutputPixels: 4_000_000,
  maxOutputEdge: MAX_VISUAL_ATTACHMENT_EDGE,
  maxOutputBytes: 2 * 1024 * 1024,
  thumbnailMaxEdge: 320,
  thumbnailMaxBytes: 96 * 1024
})

export type VisualAttachmentErrorCode =
  | 'browser-codec-unavailable'
  | 'decode-failed'
  | 'empty-file'
  | 'encode-failed'
  | 'input-too-large'
  | 'invalid-dimensions'
  | 'invalid-limits'
  | 'signature-mismatch'
  | 'source-pixels-too-large'
  | 'unsupported-media-type'
  | 'output-too-large'

export class VisualAttachmentError extends Error {
  constructor(
    readonly code: VisualAttachmentErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'VisualAttachmentError'
  }
}

export interface VisualAttachmentDecodedImage {
  width: number
  height: number
  value: unknown
}

export type VisualAttachmentDecodeRequest = Size

export interface VisualAttachmentEncodeRequest {
  width: number
  height: number
  mediaType: VisualAttachmentMediaType
  quality?: number
}

/** Injectable so tests and non-browser callers do not depend on a real Canvas implementation. */
export interface VisualAttachmentCodec {
  decode(
    bytes: Uint8Array,
    mediaType: VisualAttachmentMediaType,
    request: VisualAttachmentDecodeRequest
  ): Promise<VisualAttachmentDecodedImage>
  encode(
    image: VisualAttachmentDecodedImage,
    request: VisualAttachmentEncodeRequest
  ): Promise<Uint8Array>
  dispose?(image: VisualAttachmentDecodedImage): void
}

export interface NormalizeVisualChatAttachmentOptions {
  codec?: VisualAttachmentCodec
  limits?: Partial<VisualAttachmentLimits>
  createId?: () => string
}

export interface VisualAttachmentFileLike {
  readonly name: string
  readonly type: string
  readonly size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type NormalizeVisualAttachmentOptions = Omit<
  NormalizeVisualChatAttachmentOptions,
  'limits'
> & {
  limits?: Partial<VisualAttachmentLimits>
  source?: VisualChatAttachmentSource
  id?: string
}

type Dimensions = VisualAttachmentDecodeRequest

interface EncodedImage extends Dimensions {
  bytes: Uint8Array
}

function supportedMediaType(mediaType: string): VisualAttachmentMediaType | undefined {
  const normalized = mediaType.trim().toLowerCase()
  return SUPPORTED_VISUAL_ATTACHMENT_TYPES.find((candidate) => candidate === normalized)
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

export function sniffVisualAttachmentMediaType(
  bytes: Uint8Array
): VisualAttachmentMediaType | undefined {
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (
    hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'image/webp'
  }
  return undefined
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x1_0000
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1_0000_00 +
    bytes[offset + 1] * 0x1_0000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x1_0000 +
    bytes[offset + 3] * 0x1_0000_00
  )
}

function parsePngDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (
    bytes.byteLength < 24 ||
    readUint32BE(bytes, 8) !== 13 ||
    !hasBytes(bytes, 12, [0x49, 0x48, 0x44, 0x52])
  ) {
    return undefined
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
}

function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

const MAX_HEADER_SCAN_BYTES = 1024 * 1024
const MAX_HEADER_SEGMENTS = 1_024

function parseJpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  let offset = 2
  let segments = 0
  const scanEnd = Math.min(bytes.byteLength, MAX_HEADER_SCAN_BYTES)

  while (offset < scanEnd && segments++ < MAX_HEADER_SEGMENTS) {
    if (bytes[offset] !== 0xff) return undefined
    while (offset < scanEnd && bytes[offset] === 0xff) offset++
    if (offset >= scanEnd) return undefined

    const marker = bytes[offset++]
    if (marker === 0x00) return undefined
    if (marker === 0xd9 || marker === 0xda) return undefined
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > scanEnd) return undefined

    const segmentLength = readUint16BE(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return undefined
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7 || offset + 7 > bytes.byteLength) return undefined
      return {
        width: readUint16BE(bytes, offset + 5),
        height: readUint16BE(bytes, offset + 3)
      }
    }
    offset += segmentLength
  }
  return undefined
}

function webpChunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function parseWebpDimensions(bytes: Uint8Array): Dimensions | undefined {
  let offset = 12
  let chunks = 0
  const scanEnd = Math.min(bytes.byteLength, MAX_HEADER_SCAN_BYTES)

  while (offset + 8 <= scanEnd && chunks++ < MAX_HEADER_SEGMENTS) {
    const name = webpChunkName(bytes, offset)
    const chunkLength = readUint32LE(bytes, offset + 4)
    const dataOffset = offset + 8
    if (chunkLength > bytes.byteLength - dataOffset) return undefined

    if (name === 'VP8X') {
      if (chunkLength < 10 || dataOffset + 10 > bytes.byteLength) return undefined
      return {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1
      }
    }
    if (name === 'VP8 ') {
      if (
        chunkLength < 10 ||
        dataOffset + 10 > bytes.byteLength ||
        !hasBytes(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])
      ) {
        return undefined
      }
      return {
        width: readUint16LE(bytes, dataOffset + 6) & 0x3fff,
        height: readUint16LE(bytes, dataOffset + 8) & 0x3fff
      }
    }
    if (name === 'VP8L') {
      if (chunkLength < 5 || dataOffset + 5 > bytes.byteLength || bytes[dataOffset] !== 0x2f) {
        return undefined
      }
      const packed = readUint32LE(bytes, dataOffset + 1)
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1
      }
    }

    offset = dataOffset + chunkLength + (chunkLength & 1)
  }
  return undefined
}

export function readVisualAttachmentDimensions(
  bytes: Uint8Array,
  mediaType: VisualAttachmentMediaType
): Dimensions | undefined {
  if (mediaType === 'image/png') return parsePngDimensions(bytes)
  if (mediaType === 'image/jpeg') return parseJpegDimensions(bytes)
  return parseWebpDimensions(bytes)
}

function resolveLimits(overrides: Partial<VisualAttachmentLimits> = {}): VisualAttachmentLimits {
  const limits = { ...DEFAULT_VISUAL_ATTACHMENT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new VisualAttachmentError(
        'invalid-limits',
        `Visual attachment limit ${name} must be a positive safe integer`
      )
    }
  }
  return limits
}

function validateInput(
  mediaTypeValue: string,
  bytes: Uint8Array,
  maxInputBytes: number
): VisualAttachmentMediaType {
  const mediaType = supportedMediaType(mediaTypeValue)
  if (!mediaType) {
    throw new VisualAttachmentError(
      'unsupported-media-type',
      'Only PNG, JPEG, and WebP images are supported'
    )
  }
  if (bytes.byteLength === 0) {
    throw new VisualAttachmentError('empty-file', 'The image file is empty')
  }
  if (bytes.byteLength > maxInputBytes) {
    throw new VisualAttachmentError(
      'input-too-large',
      `The image exceeds the ${maxInputBytes}-byte input limit`
    )
  }
  if (sniffVisualAttachmentMediaType(bytes) !== mediaType) {
    throw new VisualAttachmentError(
      'signature-mismatch',
      'The image contents do not match its declared media type'
    )
  }
  return mediaType
}

function validateDimensions(
  dimensions: Dimensions,
  maxPixels: number,
  phase: 'source' | 'decoded' = 'decoded'
): void {
  const { width, height } = dimensions
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new VisualAttachmentError(
      'invalid-dimensions',
      `The ${phase} image has invalid dimensions`
    )
  }
  if (width * height > maxPixels) {
    throw new VisualAttachmentError(
      'source-pixels-too-large',
      `The ${phase} image exceeds the ${maxPixels}-pixel source limit`
    )
  }
}

function validateDecodedTarget(
  image: VisualAttachmentDecodedImage,
  request: VisualAttachmentDecodeRequest
): void {
  if (
    image.width * image.height > request.width * request.height ||
    Math.max(image.width, image.height) > Math.max(request.width, request.height)
  ) {
    throw new VisualAttachmentError(
      'invalid-dimensions',
      'The image decoder exceeded the requested safe dimensions'
    )
  }
}

function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
  maxPixels = Number.MAX_SAFE_INTEGER
): Dimensions {
  const pixels = width * height
  const scale = Math.min(1, maxEdge / width, maxEdge / height, Math.sqrt(maxPixels / pixels))
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  }
}

function shrinkDimensions(
  dimensions: Dimensions,
  byteLength: number,
  maxBytes: number
): Dimensions {
  const estimatedScale = Math.sqrt(maxBytes / byteLength) * 0.9
  const scale = Math.min(0.85, Math.max(0.5, estimatedScale))
  const width = Math.max(1, Math.floor(dimensions.width * scale))
  const height = Math.max(1, Math.floor(dimensions.height * scale))
  return {
    width: width === dimensions.width && width > 1 ? width - 1 : width,
    height: height === dimensions.height && height > 1 ? height - 1 : height
  }
}

async function encodeWithinLimit(
  codec: VisualAttachmentCodec,
  image: VisualAttachmentDecodedImage,
  initialDimensions: Dimensions,
  mediaType: VisualAttachmentMediaType,
  maxBytes: number
): Promise<EncodedImage> {
  let dimensions = initialDimensions
  let qualityIndex = 0
  let lastByteLength = 0

  for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt++) {
    let bytes: Uint8Array
    try {
      bytes = await codec.encode(image, {
        ...dimensions,
        mediaType,
        quality: mediaType === 'image/png' ? undefined : LOSSY_QUALITIES[qualityIndex]
      })
    } catch (error) {
      if (error instanceof VisualAttachmentError) throw error
      throw new VisualAttachmentError('encode-failed', 'The image could not be encoded', {
        cause: error
      })
    }
    if (bytes.byteLength === 0) {
      throw new VisualAttachmentError('encode-failed', 'The image encoder returned no data')
    }
    if (bytes.byteLength <= maxBytes) return { bytes, ...dimensions }

    lastByteLength = bytes.byteLength
    if (mediaType !== 'image/png' && qualityIndex < LOSSY_QUALITIES.length - 1) {
      qualityIndex++
      continue
    }

    const nextDimensions = shrinkDimensions(dimensions, bytes.byteLength, maxBytes)
    if (nextDimensions.width === dimensions.width && nextDimensions.height === dimensions.height) {
      break
    }
    dimensions = nextDimensions
    qualityIndex = 0
  }

  throw new VisualAttachmentError(
    'output-too-large',
    `The re-encoded image is ${lastByteLength} bytes and cannot fit the ${maxBytes}-byte limit`
  )
}

function extensionFor(mediaType: VisualAttachmentMediaType): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  return 'png'
}

function safeAttachmentName(
  name: string | undefined,
  mediaType: VisualAttachmentMediaType
): string {
  const basename = (name ?? '')
    .split(/[\\/]/)
    .at(-1)
    ?.split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')
    .trim()
  const extension = extensionFor(mediaType)
  const stem = (basename || 'image')
    .replace(/^\.+/, '')
    .replace(/\.(?:png|jpe?g|webp)$/i, '')
    .trim()
    .slice(0, 100)
  return `${stem || 'image'}.${extension}`
}

function toDataUrl(bytes: Uint8Array, mediaType: VisualAttachmentMediaType): string {
  return `data:${mediaType};base64,${encodeBase64(bytes)}`
}

function createAttachmentId(): string {
  return `visual-attachment-${randomHex(16)}`
}

export function toFileUIPart(attachment: VisualChatAttachment): FileUIPart {
  return {
    type: 'file',
    mediaType: attachment.mediaType,
    filename: attachment.name,
    url: attachment.url
  }
}

export const visualChatAttachmentToFilePart = toFileUIPart

export interface VisualChatMessageMetadata {
  visualAttachments: Array<{
    id: string
    name: string
    mediaType: VisualAttachmentMediaType
    source: VisualChatAttachmentSource
    canvasNodeIds?: string[]
    thumbnail: VisualChatAttachmentThumbnail
  }>
  visualReferenceSourceContext?: VisualReferenceSourceContext
}

interface VisualReferenceSourceContext {
  schema: typeof VISUAL_REFERENCE_SOURCE_CONTEXT_SCHEMA
  references: Array<{
    attachmentIndex: number
    source: VisualChatAttachmentSource
    canvasNodeIds?: string[]
  }>
}

export function createVisualChatMessageMetadata(
  attachments: readonly VisualChatAttachment[]
): VisualChatMessageMetadata {
  return {
    visualAttachments: attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mediaType: attachment.mediaType,
      source: attachment.source,
      ...(attachment.canvasNodeIds?.length
        ? { canvasNodeIds: sanitizeVisualReferenceNodeIds(attachment.canvasNodeIds) }
        : {}),
      thumbnail: attachment.thumbnail
    }))
  }
}

function sanitizeVisualReferenceNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const candidate of value) {
    if (result.length >= MAX_VISUAL_REFERENCE_NODE_IDS) break
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > MAX_VISUAL_REFERENCE_NODE_ID_LENGTH ||
      !SAFE_VISUAL_REFERENCE_NODE_ID.test(candidate) ||
      result.includes(candidate)
    ) {
      continue
    }
    result.push(candidate)
  }
  return result
}

function parseVisualReferenceSourceContext(value: unknown): VisualReferenceSourceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { schema?: unknown; references?: unknown }
  if (
    candidate.schema !== VISUAL_REFERENCE_SOURCE_CONTEXT_SCHEMA ||
    !Array.isArray(candidate.references) ||
    candidate.references.length === 0 ||
    candidate.references.length > MAX_VISUAL_ATTACHMENTS
  ) {
    return null
  }

  const references: VisualReferenceSourceContext['references'] = []
  for (const [attachmentIndex, value] of candidate.references.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const reference = value as {
      attachmentIndex?: unknown
      source?: unknown
      canvasNodeIds?: unknown
    }
    if (reference.attachmentIndex !== attachmentIndex) return null
    if (reference.source !== 'file' && reference.source !== 'selection') return null
    const canvasNodeIds = sanitizeVisualReferenceNodeIds(reference.canvasNodeIds)
    references.push({
      attachmentIndex,
      source: reference.source,
      ...(reference.source === 'selection' && canvasNodeIds.length > 0 ? { canvasNodeIds } : {})
    })
  }
  return { schema: VISUAL_REFERENCE_SOURCE_CONTEXT_SCHEMA, references }
}

function deriveVisualReferenceSourceContext(
  message: UIMessage
): VisualReferenceSourceContext | null {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const existing = parseVisualReferenceSourceContext(
    (metadata as { visualReferenceSourceContext?: unknown }).visualReferenceSourceContext
  )
  if (existing) return existing

  const visualAttachments = (metadata as { visualAttachments?: unknown }).visualAttachments
  if (!Array.isArray(visualAttachments) || visualAttachments.length === 0) return null
  const references: VisualReferenceSourceContext['references'] = []
  for (const [attachmentIndex, value] of visualAttachments
    .slice(0, MAX_VISUAL_ATTACHMENTS)
    .entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const attachment = value as { source?: unknown; canvasNodeIds?: unknown }
    if (attachment.source !== 'file' && attachment.source !== 'selection') return null
    const canvasNodeIds = sanitizeVisualReferenceNodeIds(attachment.canvasNodeIds)
    references.push({
      attachmentIndex,
      source: attachment.source,
      ...(attachment.source === 'selection' && canvasNodeIds.length > 0 ? { canvasNodeIds } : {})
    })
  }
  if (references.length === 0) return null
  return { schema: VISUAL_REFERENCE_SOURCE_CONTEXT_SCHEMA, references }
}

function formatVisualReferenceSourceContextValue(context: VisualReferenceSourceContext): string {
  return `${VISUAL_REFERENCE_SOURCE_CONTEXT_BEGIN}\n${JSON.stringify(context)}\n${VISUAL_REFERENCE_SOURCE_CONTEXT_END}`
}

/** Format bounded app provenance without thumbnails or image payloads. */
export function formatVisualReferenceSourceContext(message: UIMessage): string | null {
  const context = deriveVisualReferenceSourceContext(message)
  if (!context) return null
  return formatVisualReferenceSourceContextValue(context)
}

function withVisualReferenceSourceContext(message: UIMessage): UIMessage {
  const existing =
    message.metadata && typeof message.metadata === 'object'
      ? parseVisualReferenceSourceContext(
          (message.metadata as { visualReferenceSourceContext?: unknown })
            .visualReferenceSourceContext
        )
      : null
  if (existing) return message
  const context = deriveVisualReferenceSourceContext(message)
  if (!context) return message
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
  return { ...message, metadata: { ...metadata, visualReferenceSourceContext: context } }
}

function visualAttachmentMetadata(message: UIMessage): VisualChatMessageMetadata | null {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object' || !('visualAttachments' in metadata)) return null
  const visualAttachments = (metadata as { visualAttachments?: unknown }).visualAttachments
  if (!Array.isArray(visualAttachments)) return null
  const valid = visualAttachments.every((attachment) => {
    if (!attachment || typeof attachment !== 'object' || !('thumbnail' in attachment)) return false
    const thumbnail = (attachment as { thumbnail?: unknown }).thumbnail
    if (!thumbnail || typeof thumbnail !== 'object') return false
    return 'url' in thumbnail && typeof thumbnail.url === 'string'
  })
  if (!valid) return null
  return metadata as VisualChatMessageMetadata
}

export function stripVisualAttachmentMetadata(message: UIMessage): UIMessage {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object' || !('visualAttachments' in metadata)) {
    return message
  }
  const sanitizedMetadata = { ...metadata }
  Reflect.deleteProperty(sanitizedMetadata, 'visualAttachments')
  const sanitized = { ...message }
  if (Object.keys(sanitizedMetadata).length > 0) sanitized.metadata = sanitizedMetadata
  else delete sanitized.metadata
  return sanitized
}

/** Replace full model payloads with bounded thumbnails after a request settles. */
export function archiveVisualChatMessage(message: UIMessage): UIMessage {
  const contextualMessage = withVisualReferenceSourceContext(message)
  const metadata = visualAttachmentMetadata(contextualMessage)
  if (!metadata) return stripVisualAttachmentMetadata(contextualMessage)

  let fileIndex = 0
  const parts = contextualMessage.parts.map((part) => {
    if (!isFileUIPart(part)) return part
    const attachment = metadata.visualAttachments.at(fileIndex++)
    if (!attachment || part.url === attachment.thumbnail.url) return part
    return { ...part, url: attachment.thumbnail.url }
  })
  const changed = parts.some((part, index) => part !== contextualMessage.parts[index])
  return stripVisualAttachmentMetadata(
    changed ? { ...contextualMessage, parts } : contextualMessage
  )
}

export function archiveVisualChatMessages(messages: UIMessage[]): UIMessage[] {
  const archived = messages.map(archiveVisualChatMessage)
  const changed = archived.some((message, index) => message !== messages[index])
  return changed ? archived : messages
}

export async function normalizeVisualChatAttachment(
  input: VisualChatAttachmentInput,
  options: NormalizeVisualChatAttachmentOptions = {}
): Promise<VisualChatAttachment> {
  const limits = resolveLimits(options.limits)
  const mediaType = validateInput(input.mediaType, input.bytes, limits.maxInputBytes)
  const sourceDimensions = readVisualAttachmentDimensions(input.bytes, mediaType)
  if (!sourceDimensions) {
    throw new VisualAttachmentError(
      'invalid-dimensions',
      'The image header does not contain valid dimensions'
    )
  }
  validateDimensions(sourceDimensions, limits.maxSourcePixels, 'source')
  const decodeRequest = scaledDimensions(
    sourceDimensions.width,
    sourceDimensions.height,
    limits.maxOutputEdge,
    limits.maxOutputPixels
  )
  const codec = options.codec ?? createBrowserVisualAttachmentCodec()
  let image: VisualAttachmentDecodedImage
  try {
    image = await codec.decode(input.bytes, mediaType, decodeRequest)
  } catch (error) {
    throw new VisualAttachmentError('decode-failed', 'The image could not be decoded', {
      cause: error
    })
  }

  try {
    validateDimensions(image, limits.maxSourcePixels)
    validateDecodedTarget(image, decodeRequest)
    const outputDimensions = scaledDimensions(
      image.width,
      image.height,
      limits.maxOutputEdge,
      limits.maxOutputPixels
    )
    const output = await encodeWithinLimit(
      codec,
      image,
      outputDimensions,
      mediaType,
      limits.maxOutputBytes
    )
    const thumbnailDimensions = scaledDimensions(image.width, image.height, limits.thumbnailMaxEdge)
    const thumbnail = await encodeWithinLimit(
      codec,
      image,
      thumbnailDimensions,
      mediaType,
      limits.thumbnailMaxBytes
    )

    return {
      id: input.id ?? (options.createId ?? createAttachmentId)(),
      name: safeAttachmentName(input.name, mediaType),
      mediaType,
      url: toDataUrl(output.bytes, mediaType),
      sizeBytes: output.bytes.byteLength,
      width: output.width,
      height: output.height,
      source: input.source,
      sourceSizeBytes: input.bytes.byteLength,
      sourceWidth: sourceDimensions.width,
      sourceHeight: sourceDimensions.height,
      thumbnail: {
        url: toDataUrl(thumbnail.bytes, mediaType),
        sizeBytes: thumbnail.bytes.byteLength,
        width: thumbnail.width,
        height: thumbnail.height
      }
    }
  } finally {
    codec.dispose?.(image)
  }
}

export async function normalizeVisualChatFile(
  file: VisualAttachmentFileLike,
  options: NormalizeVisualAttachmentOptions = {}
): Promise<VisualChatAttachment> {
  const limits = resolveLimits(options.limits)
  if (!supportedMediaType(file.type)) {
    throw new VisualAttachmentError(
      'unsupported-media-type',
      'Only PNG, JPEG, and WebP images are supported'
    )
  }
  if (file.size === 0) {
    throw new VisualAttachmentError('empty-file', 'The image file is empty')
  }
  if (file.size > limits.maxInputBytes) {
    throw new VisualAttachmentError(
      'input-too-large',
      `The image exceeds the ${limits.maxInputBytes}-byte input limit`
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return normalizeVisualChatAttachment(
    {
      id: options.id,
      name: file.name,
      mediaType: file.type,
      bytes,
      source: options.source ?? 'file'
    },
    options
  )
}

export async function normalizeVisualAttachment(
  file: VisualAttachmentFileLike,
  options: NormalizeVisualAttachmentOptions = {}
): Promise<VisualChatAttachment> {
  return normalizeVisualChatFile(file, options)
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function canvasToBlob(
  image: ImageBitmap,
  request: VisualAttachmentEncodeRequest
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(request.width, request.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas context is unavailable')
    context.drawImage(image, 0, 0, request.width, request.height)
    return canvas.convertToBlob({ type: request.mediaType, quality: request.quality })
  }
  if (typeof document === 'undefined') {
    throw new VisualAttachmentError(
      'browser-codec-unavailable',
      'Canvas image encoding is unavailable in this environment'
    )
  }
  const canvas = document.createElement('canvas')
  canvas.width = request.width
  canvas.height = request.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context is unavailable')
  context.drawImage(image, 0, 0, request.width, request.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas image encoding failed'))
          return
        }
        resolve(blob)
      },
      request.mediaType,
      request.quality
    )
  })
}

export function createBrowserVisualAttachmentCodec(): VisualAttachmentCodec {
  if (typeof createImageBitmap !== 'function') {
    throw new VisualAttachmentError(
      'browser-codec-unavailable',
      'Browser image decoding is unavailable in this environment'
    )
  }
  return {
    async decode(bytes, mediaType, request) {
      const bitmap = await createImageBitmap(
        new Blob([ownedArrayBuffer(bytes)], { type: mediaType }),
        {
          imageOrientation: 'from-image',
          resizeWidth: request.width,
          resizeHeight: request.height,
          resizeQuality: 'high'
        }
      )
      return { width: bitmap.width, height: bitmap.height, value: bitmap }
    },
    async encode(image, request) {
      const blob = await canvasToBlob(image.value as ImageBitmap, request)
      if (blob.type !== request.mediaType) {
        throw new Error(`Canvas returned ${blob.type || 'an unknown format'}`)
      }
      return new Uint8Array(await blob.arrayBuffer())
    },
    dispose(image) {
      ;(image.value as ImageBitmap).close()
    }
  }
}
