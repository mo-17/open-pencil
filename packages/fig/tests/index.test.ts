import { beforeAll, describe, expect, it } from 'bun:test'

import { deflateSync, unzipSync } from 'fflate'

import {
  createNodeChangesMessage,
  encodeMessage,
  getSchemaBytes,
  initCodec
} from '@open-pencil/kiwi/fig/codec'

import {
  FIG_PACKAGE_STATUS,
  assertFigPackageReady,
  parseFigBuffer,
  readFigContainer,
  writeFigArchive,
  writeFigContainer
} from '../src/index'

describe('@open-pencil/fig package API', () => {
  beforeAll(async () => {
    await initCodec()
  })

  it('exports archive API status', () => {
    expect(FIG_PACKAGE_STATUS).toBe('archive-api')
  })

  it('round-trips fig-kiwi container bytes', () => {
    const bytes = writeFigContainer({
      schemaDeflated: new Uint8Array([1, 2, 3]),
      dataRaw: new Uint8Array([4, 5, 6])
    })
    const document = readFigContainer(bytes, { fileName: 'fixture.fig' })

    expect(document.schemaDeflated).toEqual(new Uint8Array([1, 2, 3]))
    expect(document.dataRaw).toEqual(new Uint8Array([4, 5, 6]))
    expect(document.source?.bytes).toBe(bytes)
    expect(document.source?.fileName).toBe('fixture.fig')
  })

  it('parses complete .fig archives and image resources', () => {
    const thumbnailPNG = new Uint8Array([1])
    const metaJSON = '{}'
    const bytes = writeFigArchive({
      schemaDeflated: deflateSync(getSchemaBytes()),
      kiwiData: encodeMessage(
        createNodeChangesMessage(0, 0, [
          {
            guid: { sessionID: 0, localID: 0 },
            type: 'DOCUMENT',
            phase: 'CREATED',
            name: 'Document'
          }
        ])
      ),
      thumbnailPNG,
      metaJSON,
      images: [{ name: 'images/hash', data: new Uint8Array([9, 8, 7]) }]
    })
    const parsed = parseFigBuffer(bytes.buffer as ArrayBuffer)

    expect(parsed.nodeChanges).toHaveLength(1)
    expect(parsed.nodeChanges[0]?.type).toBe('DOCUMENT')
    expect(parsed.images).toEqual([['hash', new Uint8Array([9, 8, 7])]])
    expect(parsed.thumbnailPNG).toEqual(thumbnailPNG)
    expect(parsed.metaJSON).toBe(metaJSON)
  })

  it('enforces outer archive entry and uncompressed byte limits', () => {
    const bytes = writeFigArchive({
      schemaDeflated: deflateSync(getSchemaBytes()),
      kiwiData: encodeMessage(
        createNodeChangesMessage(0, 0, [
          {
            guid: { sessionID: 0, localID: 0 },
            type: 'DOCUMENT',
            phase: 'CREATED',
            name: 'Document'
          },
          {
            guid: { sessionID: 0, localID: 1 },
            parentIndex: { guid: { sessionID: 0, localID: 0 }, position: '!' },
            type: 'CANVAS',
            phase: 'CREATED',
            name: 'Page'
          }
        ])
      ),
      thumbnailPNG: new Uint8Array([1]),
      metaJSON: '{}',
      images: [{ name: 'images/hash', data: new Uint8Array(64) }]
    })
    const buffer = new Uint8Array(bytes).buffer

    expect(() => parseFigBuffer(buffer, { limits: { maxEntries: 3 } })).toThrow(
      '.fig archive exceeds the 3 entry limit'
    )
    expect(() => parseFigBuffer(buffer, { limits: { maxImageBytes: 63 } })).toThrow(
      '.fig image "images/hash" exceeds the 63 byte limit'
    )
    expect(() => parseFigBuffer(buffer, { limits: { maxTotalImageBytes: 63 } })).toThrow(
      '.fig images exceed the 63 total uncompressed byte limit'
    )

    const entries = unzipSync(bytes)
    const totalBytes = Object.values(entries).reduce((total, entry) => total + entry.byteLength, 0)
    expect(() =>
      parseFigBuffer(buffer, { limits: { maxTotalEntryBytes: totalBytes - 1 } })
    ).toThrow(`.fig archive exceeds the ${totalBytes - 1} total uncompressed byte limit`)
    expect(() => parseFigBuffer(buffer, { limits: { maxNodeChanges: 1 } })).toThrow(
      /(?:Kiwi array item limit exceeded \(1 per message\)|\.fig node changes exceed the 1 record limit)/
    )
  })

  it('enforces decompressed inner fig-kiwi data limits', () => {
    const bytes = writeFigArchive({
      schemaDeflated: deflateSync(getSchemaBytes()),
      kiwiData: encodeMessage(
        createNodeChangesMessage(0, 0, [
          {
            guid: { sessionID: 0, localID: 0 },
            type: 'DOCUMENT',
            phase: 'CREATED',
            name: 'Document'
          }
        ])
      ),
      thumbnailPNG: new Uint8Array(),
      metaJSON: '{}'
    })
    const archive = unzipSync(bytes)
    const canvasBytes = archive['canvas.fig']
    if (!canvasBytes) throw new Error('Expected canvas.fig')
    const buffer = new Uint8Array(bytes).buffer

    expect(() => parseFigBuffer(buffer, { limits: { maxDataBytes: 1 } })).toThrow(
      'Decompressed fig-kiwi data exceeds the 1 byte limit'
    )
  })

  it('rejects invalid fig-kiwi containers', () => {
    expect(() => readFigContainer(new Uint8Array([1, 2, 3]))).toThrow('Invalid fig-kiwi')
  })

  it('directs consumers to core for SceneGraph read/write', () => {
    expect(() => assertFigPackageReady()).toThrow('archive/container APIs')
  })
})
