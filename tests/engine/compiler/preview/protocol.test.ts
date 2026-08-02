import { describe, expect, test } from 'bun:test'

import {
  createPreviewFileDecodeCache,
  createPreviewFileEncodeCache,
  deserializePreviewFiles,
  resetPreviewFileEncodeCache,
  serializePreviewFiles
} from '@open-pencil/compiler'

describe('preview file protocol', () => {
  test('round-trips text and binary compiler files', () => {
    const bytes = new Uint8Array([0, 255, 17, 42])
    const files = new Map<string, string | Uint8Array>([
      ['src/index.css', '@font-face{}'],
      ['src/assets/fonts/test.woff2', bytes]
    ])
    const encoded = serializePreviewFiles(files)
    expect(encoded[0]).toEqual(['src/index.css', '@font-face{}'])
    expect(encoded[1]?.[1]).toEqual({ type: 'binary', base64: 'AP8RKg==' })

    const decoded = deserializePreviewFiles(encoded)
    expect(decoded.get('src/index.css')).toBe('@font-face{}')
    expect(decoded.get('src/assets/fonts/test.woff2')).toEqual(bytes)
  })

  test('decodes repeated binary payloads as equal bytes despite fresh references', () => {
    const encoded = serializePreviewFiles(
      new Map([['src/assets/fonts/test.woff2', new Uint8Array([9, 8, 7, 6])]])
    )

    const first = deserializePreviewFiles(encoded).get('src/assets/fonts/test.woff2')
    const second = deserializePreviewFiles(encoded).get('src/assets/fonts/test.woff2')

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })

  test('uses a lightweight binary-ref for unchanged bytes at the same path', () => {
    const encodeCache = createPreviewFileEncodeCache()
    const decodeCache = createPreviewFileDecodeCache()
    const path = 'src/assets/fonts/test.woff2'
    const firstPayload = serializePreviewFiles(
      new Map([[path, new Uint8Array([9, 8, 7, 6])]]),
      encodeCache
    )
    const secondPayload = serializePreviewFiles(
      new Map([[path, new Uint8Array([9, 8, 7, 6])]]),
      encodeCache
    )

    expect(firstPayload[0]?.[1]).toEqual({ type: 'binary', base64: 'CQgHBg==' })
    expect(secondPayload[0]?.[1]).toEqual({ type: 'binary-ref' })

    const first = deserializePreviewFiles(firstPayload, decodeCache).get(path)
    const second = deserializePreviewFiles(secondPayload, decodeCache).get(path)
    expect(second).toBe(first)
  })

  test('rejects a binary-ref when the sidecar has no matching path cache', () => {
    expect(() =>
      deserializePreviewFiles(
        [['src/assets/fonts/missing.woff2', { type: 'binary-ref' }]],
        createPreviewFileDecodeCache()
      )
    ).toThrow('Invalid preview binary-ref for "src/assets/fonts/missing.woff2"')
  })

  test('resets references after deletion or an explicit client reset', () => {
    const encodeCache = createPreviewFileEncodeCache()
    const decodeCache = createPreviewFileDecodeCache()
    const path = 'src/assets/fonts/test.woff2'
    const files = new Map([[path, new Uint8Array([9, 8, 7, 6])]])
    const firstPayload = serializePreviewFiles(files, encodeCache)
    deserializePreviewFiles(firstPayload, decodeCache)

    const withoutFont = deserializePreviewFiles(
      serializePreviewFiles(new Map(), encodeCache),
      decodeCache
    )
    expect(withoutFont.has(path)).toBe(false)
    expect(encodeCache.binariesByPath.size).toBe(0)
    expect(decodeCache.binariesByPath.size).toBe(0)

    const restoredPayload = serializePreviewFiles(files, encodeCache)
    expect(restoredPayload[0]?.[1]).toEqual({ type: 'binary', base64: 'CQgHBg==' })
    deserializePreviewFiles(restoredPayload, decodeCache)

    expect(serializePreviewFiles(files, encodeCache)[0]?.[1]).toEqual({ type: 'binary-ref' })
    resetPreviewFileEncodeCache(encodeCache)
    expect(serializePreviewFiles(files, encodeCache)[0]?.[1]).toEqual({
      type: 'binary',
      base64: 'CQgHBg=='
    })
  })

  test('sends a full binary envelope when bytes change at the same path', () => {
    const cache = createPreviewFileEncodeCache()
    const path = 'src/assets/fonts/test.woff2'
    serializePreviewFiles(new Map([[path, new Uint8Array([1, 2, 3])]]), cache)

    expect(
      serializePreviewFiles(new Map([[path, new Uint8Array([1, 9, 3])]]), cache)[0]?.[1]
    ).toEqual({ type: 'binary', base64: 'AQkD' })
  })

  test('detects in-place mutation because the encode cache owns a byte snapshot', () => {
    const cache = createPreviewFileEncodeCache()
    const path = 'src/assets/fonts/test.woff2'
    const bytes = new Uint8Array([1, 2, 3])
    serializePreviewFiles(new Map([[path, bytes]]), cache)

    bytes[1] = 9
    expect(serializePreviewFiles(new Map([[path, bytes]]), cache)[0]?.[1]).toEqual({
      type: 'binary',
      base64: 'AQkD'
    })
  })
})
