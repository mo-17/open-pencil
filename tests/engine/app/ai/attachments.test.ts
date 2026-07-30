import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import {
  archiveVisualChatMessages,
  createBrowserVisualAttachmentCodec,
  createVisualChatMessageMetadata,
  formatVisualReferenceSourceContext,
  normalizeVisualAttachment,
  normalizeVisualChatAttachment,
  sniffVisualAttachmentMediaType,
  toFileUIPart,
  VisualAttachmentError,
  type VisualAttachmentCodec,
  type VisualAttachmentDecodeRequest,
  type VisualAttachmentEncodeRequest,
  type VisualAttachmentMediaType
} from '@/app/ai/chat/attachments'

interface SourceOptions {
  width?: number
  height?: number
  extraBytes?: number
}

function uint16BE(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

function uint24LE(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff]
}

function uint32BE(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function uint32LE(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
}

function sourceBytes(
  mediaType: VisualAttachmentMediaType,
  { width = 32, height = 16, extraBytes = 0 }: SourceOptions = {}
): Uint8Array {
  const extra = Array.from({ length: extraBytes }, () => 0xa5)
  if (mediaType === 'image/png') {
    return new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      ...uint32BE(width),
      ...uint32BE(height),
      8,
      6,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...extra
    ])
  }
  if (mediaType === 'image/jpeg') {
    return new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      8,
      ...uint16BE(height),
      ...uint16BE(width),
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      0,
      3,
      0x11,
      0,
      0xff,
      0xd9,
      ...extra
    ])
  }
  const fileSize = 30 + extraBytes
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    ...uint32LE(fileSize - 8),
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x58,
    ...uint32LE(10),
    0,
    0,
    0,
    0,
    ...uint24LE(width - 1),
    ...uint24LE(height - 1),
    ...extra
  ])
}

interface TestCodec extends VisualAttachmentCodec {
  requests: VisualAttachmentEncodeRequest[]
  decodeRequests: VisualAttachmentDecodeRequest[]
  decoded: number
  disposed: number
}

function testCodec(
  options: {
    decoded?: { width: number; height: number }
    encode?: (request: VisualAttachmentEncodeRequest) => Uint8Array
  } = {}
): TestCodec {
  const requests: VisualAttachmentEncodeRequest[] = []
  const decodeRequests: VisualAttachmentDecodeRequest[] = []
  return {
    requests,
    decodeRequests,
    decoded: 0,
    disposed: 0,
    async decode(_bytes, _mediaType, request) {
      this.decoded++
      decodeRequests.push(request)
      return { ...(options.decoded ?? request), value: 'test-image' }
    },
    async encode(_image, request) {
      requests.push(request)
      return options.encode?.(request) ?? new Uint8Array([1, 2, 3])
    },
    dispose() {
      this.disposed++
    }
  }
}

async function expectErrorCode(promise: Promise<unknown>, code: VisualAttachmentError['code']) {
  try {
    await promise
    throw new Error(`Expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(VisualAttachmentError)
    expect((error as VisualAttachmentError).code).toBe(code)
  }
}

describe('visual chat attachment normalization', () => {
  test('sniffs exactly the supported PNG, JPEG, and WebP signatures', () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      expect(sniffVisualAttachmentMediaType(sourceBytes(mediaType))).toBe(mediaType)
    }
    expect(sniffVisualAttachmentMediaType(new Uint8Array([0x47, 0x49, 0x46]))).toBeUndefined()
  })

  test('always re-encodes, scales by edge and pixels, and returns FileUIPart-ready metadata', async () => {
    let encoded = 0
    const codec = testCodec({
      encode: () => {
        encoded++
        return encoded === 1 ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5])
      }
    })
    const bytes = sourceBytes('image/png', {
      width: 4_000,
      height: 2_000,
      extraBytes: 20
    })

    const attachment = await normalizeVisualChatAttachment(
      {
        id: 'attachment-1',
        name: '../../draft.jpeg',
        mediaType: 'IMAGE/PNG',
        bytes,
        source: 'selection'
      },
      {
        codec,
        limits: {
          maxSourcePixels: 10_000_000,
          maxOutputPixels: 500_000,
          maxOutputEdge: 1_000,
          thumbnailMaxEdge: 200
        }
      }
    )

    expect(codec.decodeRequests).toEqual([{ width: 1_000, height: 500 }])
    expect(codec.requests).toEqual([
      { width: 1_000, height: 500, mediaType: 'image/png', quality: undefined },
      { width: 200, height: 100, mediaType: 'image/png', quality: undefined }
    ])
    expect(attachment).toEqual({
      id: 'attachment-1',
      name: 'draft.png',
      mediaType: 'image/png',
      url: 'data:image/png;base64,AQID',
      sizeBytes: 3,
      width: 1_000,
      height: 500,
      source: 'selection',
      sourceSizeBytes: bytes.byteLength,
      sourceWidth: 4_000,
      sourceHeight: 2_000,
      thumbnail: {
        url: 'data:image/png;base64,BAU=',
        sizeBytes: 2,
        width: 200,
        height: 100
      }
    })
    expect(toFileUIPart(attachment)).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'draft.png',
      url: 'data:image/png;base64,AQID'
    })
    expect(codec.decoded).toBe(1)
    expect(codec.disposed).toBe(1)
  })

  test('preserves each supported media type through normalization', async () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      const codec = testCodec()
      const attachment = await normalizeVisualChatAttachment(
        {
          name: 'capture',
          mediaType,
          bytes: sourceBytes(mediaType),
          source: 'file'
        },
        { codec, createId: () => `id-${mediaType}` }
      )

      expect(attachment.mediaType).toBe(mediaType)
      expect(attachment.url.startsWith(`data:${mediaType};base64,`)).toBe(true)
      expect(codec.decodeRequests).toEqual([{ width: 32, height: 16 }])
      expect(codec.requests.every((request) => request.mediaType === mediaType)).toBe(true)
    }
  })

  test('rejects unsupported MIME types, empty files, oversized inputs, and signature mismatches', async () => {
    const codec = testCodec()
    await expectErrorCode(
      normalizeVisualChatAttachment(
        {
          mediaType: 'image/gif',
          bytes: new Uint8Array([1]),
          source: 'file'
        },
        { codec }
      ),
      'unsupported-media-type'
    )
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: new Uint8Array(), source: 'file' },
        { codec }
      ),
      'empty-file'
    )
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: sourceBytes('image/png'), source: 'file' },
        { codec, limits: { maxInputBytes: 7 } }
      ),
      'input-too-large'
    )
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/jpeg', bytes: sourceBytes('image/png'), source: 'file' },
        { codec }
      ),
      'signature-mismatch'
    )
    expect(codec.decoded).toBe(0)
  })

  test('rejects invalid and decompression-bomb-sized decoded dimensions', async () => {
    const invalid = testCodec({ decoded: { width: 0, height: 10 } })
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: sourceBytes('image/png'), source: 'file' },
        { codec: invalid }
      ),
      'invalid-dimensions'
    )
    expect(invalid.disposed).toBe(1)

    const tooManyPixels = testCodec({ decoded: { width: 10_000, height: 10_000 } })
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: sourceBytes('image/png'), source: 'file' },
        { codec: tooManyPixels, limits: { maxSourcePixels: 50_000_000 } }
      ),
      'source-pixels-too-large'
    )
    expect(tooManyPixels.disposed).toBe(1)
  })

  test('rejects oversized PNG, JPEG, and WebP headers before decoding', async () => {
    for (const mediaType of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      const codec = testCodec()
      await expectErrorCode(
        normalizeVisualChatAttachment(
          {
            mediaType,
            bytes: sourceBytes(mediaType, { width: 10_000, height: 10_000 }),
            source: 'file'
          },
          { codec, limits: { maxSourcePixels: 50_000_000 } }
        ),
        'source-pixels-too-large'
      )
      expect(codec.decoded).toBe(0)
      expect(codec.decodeRequests).toEqual([])
    }
  })

  test('passes safe resize dimensions to the browser decoder', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
    let receivedOptions: ImageBitmapOptions | undefined
    let closed = false
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: async (_blob: Blob, options?: ImageBitmapOptions) => {
        receivedOptions = options
        return {
          width: 1_000,
          height: 500,
          close() {
            closed = true
          }
        } as ImageBitmap
      }
    })

    try {
      const codec = createBrowserVisualAttachmentCodec()
      const image = await codec.decode(sourceBytes('image/png'), 'image/png', {
        width: 1_000,
        height: 500
      })
      expect(receivedOptions).toEqual({
        imageOrientation: 'from-image',
        resizeWidth: 1_000,
        resizeHeight: 500,
        resizeQuality: 'high'
      })
      codec.dispose?.(image)
      expect(closed).toBe(true)
    } finally {
      if (original) Object.defineProperty(globalThis, 'createImageBitmap', original)
      else Reflect.deleteProperty(globalThis, 'createImageBitmap')
    }
  })

  test('reduces dimensions until a PNG fits the encoded byte limit', async () => {
    const codec = testCodec({
      encode: ({ width, height }) => new Uint8Array(Math.max(1, Math.ceil((width * height) / 100)))
    })

    const attachment = await normalizeVisualChatAttachment(
      {
        mediaType: 'image/png',
        bytes: sourceBytes('image/png', { width: 100, height: 50 }),
        source: 'file'
      },
      {
        codec,
        createId: () => 'shrunk',
        limits: { maxOutputBytes: 10, thumbnailMaxEdge: 20, thumbnailMaxBytes: 10 }
      }
    )

    expect(attachment.sizeBytes).toBeLessThanOrEqual(10)
    expect(attachment.width).toBeLessThan(100)
    expect(attachment.height).toBeLessThan(50)
    expect(codec.requests.slice(0, 3).map(({ width, height }) => [width, height])).toEqual([
      [100, 50],
      [50, 25],
      [39, 19]
    ])
  })

  test('tries lower JPEG quality before reducing dimensions', async () => {
    const codec = testCodec({
      encode: ({ quality }) => new Uint8Array((quality ?? 1) <= 0.7 ? 5 : 20)
    })

    const attachment = await normalizeVisualChatAttachment(
      {
        mediaType: 'image/jpeg',
        bytes: sourceBytes('image/jpeg', { width: 100, height: 50 }),
        source: 'file'
      },
      {
        codec,
        createId: () => 'quality',
        limits: { maxOutputBytes: 10, thumbnailMaxBytes: 10 }
      }
    )

    expect(codec.requests.slice(0, 3).map(({ quality }) => quality)).toEqual([0.9, 0.8, 0.7])
    expect(attachment.width).toBe(100)
    expect(attachment.height).toBe(50)
  })

  test('fails closed when even a one-pixel image cannot fit the byte limit', async () => {
    const codec = testCodec({ encode: () => new Uint8Array([1, 2]) })
    await expectErrorCode(
      normalizeVisualChatAttachment(
        {
          mediaType: 'image/png',
          bytes: sourceBytes('image/png', { width: 1, height: 1 }),
          source: 'file'
        },
        { codec, limits: { maxOutputBytes: 1 } }
      ),
      'output-too-large'
    )
    expect(codec.disposed).toBe(1)
  })

  test('wraps codec failures and still disposes decoded images', async () => {
    const codec = testCodec()
    codec.encode = async () => {
      throw new Error('native encoder details')
    }

    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: sourceBytes('image/png'), source: 'file' },
        { codec }
      ),
      'encode-failed'
    )
    expect(codec.disposed).toBe(1)
  })

  test('rejects oversized file-like inputs before allocating their bytes', async () => {
    let reads = 0
    const file = {
      name: 'huge.png',
      type: 'image/png',
      size: 101,
      async arrayBuffer() {
        reads++
        return sourceBytes('image/png').buffer
      }
    }

    await expectErrorCode(
      normalizeVisualAttachment(file, {
        codec: testCodec(),
        limits: { maxInputBytes: 100 }
      }),
      'input-too-large'
    )
    expect(reads).toBe(0)
  })

  test('rejects non-positive or non-integer limits', async () => {
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: sourceBytes('image/png'), source: 'file' },
        { codec: testCodec(), limits: { maxOutputPixels: 0 } }
      ),
      'invalid-limits'
    )
    await expectErrorCode(
      normalizeVisualChatAttachment(
        { mediaType: 'image/png', bytes: sourceBytes('image/png'), source: 'file' },
        { codec: testCodec(), limits: { thumbnailMaxEdge: 1.5 } }
      ),
      'invalid-limits'
    )
  })

  test('archives full message payloads to bounded thumbnails without mutating the input', () => {
    const attachment = {
      id: 'visual-1',
      name: 'reference.png',
      mediaType: 'image/png' as const,
      url: 'data:image/png;base64,FULL',
      sizeBytes: 2_000,
      width: 2_048,
      height: 1_024,
      source: 'file' as const,
      sourceSizeBytes: 4_000,
      sourceWidth: 4_096,
      sourceHeight: 2_048,
      thumbnail: {
        url: 'data:image/png;base64,THUMB',
        sizeBytes: 20,
        width: 320,
        height: 160
      }
    }
    const message: UIMessage = {
      id: 'user-1',
      role: 'user',
      metadata: {
        ...createVisualChatMessageMetadata([attachment]),
        visualAnalysis: 'A persisted bounded analysis'
      },
      parts: [toFileUIPart(attachment), { type: 'text', text: 'Recreate this' }]
    }

    const archived = archiveVisualChatMessages([message])

    expect(archived[0]).not.toBe(message)
    expect(archived[0].parts[0]).toEqual({
      type: 'file',
      mediaType: 'image/png',
      filename: 'reference.png',
      url: attachment.thumbnail.url
    })
    expect(archived[0].metadata).toEqual({
      visualAnalysis: 'A persisted bounded analysis',
      visualReferenceSourceContext: {
        schema: 'openpencil.visual-reference-source.v1',
        references: [{ attachmentIndex: 0, source: 'file' }]
      }
    })
    expect(JSON.stringify(archived).match(/THUMB/g)).toHaveLength(1)
    expect(JSON.stringify(archived)).not.toContain('FULL')
    expect(message.parts[0]).toEqual(toFileUIPart(attachment))
    expect(message.metadata).toHaveProperty('visualAttachments')
  })

  test('formats bounded visual provenance without thumbnail or pixel payloads', () => {
    const message: UIMessage = {
      id: 'selection-context',
      role: 'user',
      metadata: {
        visualAttachments: [
          {
            source: 'selection',
            canvasNodeIds: ['0:42', 'bad\nnode', '0:42'],
            thumbnail: { url: 'data:image/png;base64,PRIVATE-THUMBNAIL' }
          }
        ]
      },
      parts: [{ type: 'text', text: 'Use the selected reference' }]
    }

    const context = formatVisualReferenceSourceContext(message)

    expect(context).toContain('[BEGIN_OPENPENCIL_VISUAL_REFERENCE_SOURCE_CONTEXT]')
    expect(context).toContain(
      '{"schema":"openpencil.visual-reference-source.v1","references":[{"attachmentIndex":0,"source":"selection","canvasNodeIds":["0:42"]}]}'
    )
    expect(context).not.toContain('PRIVATE-THUMBNAIL')
    expect(message.metadata).not.toHaveProperty('visualReferenceSourceContext')
  })
})
