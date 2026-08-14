import { describe, expect, test } from 'bun:test'

import { IMAGE_INSPECTION_LIMITS, inspectImageBytes, type Fill } from '@open-pencil/scene-graph'

import { getTool, setupToolTest } from '#tests/helpers/tools'

const PNG_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64'
  )
)

interface ImageAsset {
  hash: string
  hashExists: boolean
  byteLength: number | null
  signature: string | null
  mimeType: string | null
  headerValidation: string
  dimensionStatus: string
  dimensions?: { width: number; height: number }
  inspectionReason?: string
  status: string
  statuses: string[]
  issues: Array<{ code: string; message: string }>
  referenceCount: number
  references: Array<{ nodeId: string; path: string; nodeVisible: boolean; fillVisible: boolean }>
  omittedReferenceCount: number
}

interface ImageAssetAuditResult {
  summary: {
    imageFillReferences: number
    referencedHashes: number
    storedImages: number
    assets: number
    matchedAssets: number
    returnedAssets: number
    omittedAssets: number
    filteredHealthy: number
    returnedReferences: number
    omittedReferences: number
    returnedMissingHashReferences: number
    omittedMissingHashReferences: number
    healthy: number
    missing: number
    missingHashFills: number
    invalid: number
    oversize: number
    orphan: number
  }
  assets: ImageAsset[]
  missingHashReferences: Array<{ nodeId: string; path: string }>
}

function imageFill(imageHash?: string): Fill {
  return {
    type: 'IMAGE',
    imageHash,
    imageScaleMode: 'FILL',
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: 1,
    visible: true
  }
}

function audit(args: Record<string, number | boolean> = {}): ImageAssetAuditResult {
  const { figma } = setupToolTest()
  return getTool('audit_image_assets').execute(figma, args) as ImageAssetAuditResult
}

describe('audit_image_assets', () => {
  test('reports valid PNG metadata and every supported IMAGE fill reference path', () => {
    const { graph, figma } = setupToolTest()
    const hash = 'stored-png'
    graph.images.set(hash, PNG_BYTES)
    const rect = graph.createNode('RECTANGLE', figma.currentPageId, {
      name: 'Base and state image',
      fills: [imageFill(hash)],
      stateOverrides: { hover: { fills: [imageFill(hash)] } }
    })
    const text = graph.createNode('TEXT', figma.currentPageId, {
      name: 'Style image',
      text: 'A',
      styleRuns: [{ start: 0, length: 1, style: { fills: [imageFill(hash)] } }]
    })
    const vector = graph.createNode('VECTOR', figma.currentPageId, {
      name: 'Geometry image',
      fillGeometry: [
        { windingRule: 'NONZERO', commandsBlob: new Uint8Array(), fills: [imageFill(hash)] }
      ],
      strokeGeometry: [
        { windingRule: 'NONZERO', commandsBlob: new Uint8Array(), fills: [imageFill(hash)] }
      ]
    })

    const result = getTool('audit_image_assets').execute(figma, {}) as ImageAssetAuditResult
    const asset = result.assets[0]

    expect(result.summary).toMatchObject({
      imageFillReferences: 5,
      referencedHashes: 1,
      storedImages: 1,
      healthy: 1,
      missing: 0,
      invalid: 0,
      orphan: 0
    })
    expect(asset).toMatchObject({
      hash,
      hashExists: true,
      byteLength: PNG_BYTES.byteLength,
      signature: 'png',
      mimeType: 'image/png',
      headerValidation: 'valid',
      dimensionStatus: 'parsed',
      dimensions: { width: 1, height: 1 },
      status: 'ok',
      statuses: ['ok'],
      referenceCount: 5
    })
    expect(asset.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: rect.id, path: 'fills[0]' }),
        expect.objectContaining({ nodeId: rect.id, path: 'stateOverrides.hover.fills[0]' }),
        expect.objectContaining({ nodeId: text.id, path: 'styleRuns[0].fills[0]' }),
        expect.objectContaining({ nodeId: vector.id, path: 'fillGeometry[0].fills[0]' }),
        expect.objectContaining({ nodeId: vector.id, path: 'strokeGeometry[0].fills[0]' })
      ])
    )
  })

  test('separates missing bytes, missing hashes, invalid headers, and orphan assets', () => {
    const { graph, figma } = setupToolTest()
    graph.createNode('RECTANGLE', figma.currentPageId, {
      name: 'Missing bytes',
      fills: [imageFill('missing-bytes')]
    })
    const missingHashNode = graph.createNode('RECTANGLE', figma.currentPageId, {
      name: 'Missing hash',
      fills: [imageFill()]
    })
    graph.images.set('invalid-image', PNG_BYTES.slice(0, 24))
    graph.images.set(
      'orphan-avif',
      new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0])
    )

    const result = getTool('audit_image_assets').execute(figma, {}) as ImageAssetAuditResult
    const missing = result.assets.find((asset) => asset.hash === 'missing-bytes')
    const invalid = result.assets.find((asset) => asset.hash === 'invalid-image')
    const avif = result.assets.find((asset) => asset.hash === 'orphan-avif')

    expect(result.summary).toMatchObject({
      imageFillReferences: 2,
      missing: 1,
      missingHashFills: 1,
      invalid: 1,
      orphan: 2
    })
    expect(missing).toMatchObject({
      hashExists: false,
      byteLength: null,
      headerValidation: 'missing',
      dimensionStatus: 'missing',
      status: 'missing',
      statuses: ['missing']
    })
    expect(missing?.inspectionReason).toContain('No stored bytes')
    expect(invalid).toMatchObject({
      signature: 'png',
      headerValidation: 'invalid',
      dimensionStatus: 'invalid',
      status: 'invalid',
      statuses: ['invalid', 'orphan']
    })
    expect(invalid?.issues[0]?.message).toBeTruthy()
    expect(avif).toMatchObject({
      signature: 'avif',
      mimeType: 'image/avif',
      headerValidation: 'valid',
      dimensionStatus: 'unavailable',
      status: 'orphan',
      statuses: ['orphan']
    })
    expect(avif?.inspectionReason).toContain('not guessed')
    expect(result.missingHashReferences).toEqual([
      expect.objectContaining({ nodeId: missingHashNode.id, path: 'fills[0]' })
    ])
  })

  test('reports byte and pixel limits and truncates reference records without losing counts', () => {
    const { graph, figma } = setupToolTest()
    const hash = 'shared-large'
    const largeDimensions = PNG_BYTES.slice()
    largeDimensions.set([0, 0, 0, 100, 0, 0, 0, 100], 16)
    graph.images.set(hash, largeDimensions)
    for (let index = 0; index < 2; index++) {
      graph.createNode('RECTANGLE', figma.currentPageId, {
        name: `Reference ${index}`,
        fills: [imageFill(hash)]
      })
    }

    const result = getTool('audit_image_assets').execute(figma, {
      max_asset_bytes: 1,
      max_pixels: 5_000,
      max_references_per_asset: 1
    }) as ImageAssetAuditResult
    const asset = result.assets[0]

    expect(result.summary).toMatchObject({ oversize: 1, invalid: 0 })
    expect(asset).toMatchObject({
      dimensions: { width: 100, height: 100 },
      status: 'oversize',
      statuses: ['oversize'],
      referenceCount: 2,
      omittedReferenceCount: 1
    })
    expect(asset.references).toHaveLength(1)
    expect(asset.issues.map((issue) => issue.code)).toEqual([
      'image-bytes-oversize',
      'image-pixels-oversize'
    ])
  })

  test('clamps direct-call limits to their declared safe ranges', () => {
    const result = audit({
      max_asset_bytes: 0,
      max_pixels: Number.POSITIVE_INFINITY,
      max_references_per_asset: -20
    })
    expect(result.summary.assets).toBe(0)
  })

  test('bounds document output globally and prioritizes problems over healthy assets', () => {
    const { graph, figma } = setupToolTest()
    graph.images.set('a-healthy', PNG_BYTES)
    graph.images.set('b-invalid', new Uint8Array([1, 2, 3]))
    graph.images.set('c-healthy', PNG_BYTES)
    graph.createNode('RECTANGLE', figma.currentPageId, {
      fills: [imageFill('a-healthy')]
    })
    graph.createNode('RECTANGLE', figma.currentPageId, {
      fills: [imageFill('b-invalid')]
    })
    graph.createNode('RECTANGLE', figma.currentPageId, {
      fills: [imageFill('c-healthy')]
    })

    const limited = getTool('audit_image_assets').execute(figma, {
      max_assets: 1,
      max_total_references: 1
    }) as ImageAssetAuditResult
    const problemsOnly = getTool('audit_image_assets').execute(figma, {
      include_healthy: false
    }) as ImageAssetAuditResult

    expect(limited.summary).toMatchObject({
      assets: 3,
      matchedAssets: 3,
      returnedAssets: 1,
      omittedAssets: 2
    })
    expect(limited.assets.map((asset) => asset.hash)).toEqual(['b-invalid'])
    expect(problemsOnly.summary).toMatchObject({
      assets: 3,
      matchedAssets: 1,
      returnedAssets: 1,
      filteredHealthy: 2
    })
    expect(problemsOnly.assets.map((asset) => asset.hash)).toEqual(['b-invalid'])
  })

  test('applies the global reference cap to missing-hash records too', () => {
    const { graph, figma } = setupToolTest()
    for (let index = 0; index < 3; index++) {
      graph.createNode('RECTANGLE', figma.currentPageId, {
        name: `Missing hash ${index}`,
        fills: [imageFill()]
      })
    }

    const result = getTool('audit_image_assets').execute(figma, {
      max_total_references: 1
    }) as ImageAssetAuditResult

    expect(result.missingHashReferences).toHaveLength(1)
    expect(result.summary).toMatchObject({
      imageFillReferences: 3,
      returnedReferences: 1,
      omittedReferences: 2,
      returnedMissingHashReferences: 1,
      omittedMissingHashReferences: 2
    })
  })

  test('rejects truncated BMP/TIFF headers and bounds JPEG tail scanning', () => {
    const { graph, figma } = setupToolTest()
    const truncatedBmp = new Uint8Array(26)
    truncatedBmp.set([0x42, 0x4d, 26, 0, 0, 0], 0)
    truncatedBmp.set([40, 0, 0, 0], 14)
    graph.images.set('truncated-bmp', truncatedBmp)
    graph.images.set('truncated-tiff', new Uint8Array([0x49, 0x49, 0x2a, 0x00]))
    const jpegWithUnboundedTail = new Uint8Array(70 * 1024)
    jpegWithUnboundedTail.set([0xff, 0xd8, 0xff, 0xd9], 0)
    graph.images.set('jpeg-unbounded-tail', jpegWithUnboundedTail)

    const result = getTool('audit_image_assets').execute(figma, {}) as ImageAssetAuditResult
    const byHash = new Map(result.assets.map((asset) => [asset.hash, asset]))

    expect(byHash.get('truncated-bmp')).toMatchObject({
      signature: 'bmp',
      headerValidation: 'invalid',
      dimensionStatus: 'invalid'
    })
    expect(byHash.get('truncated-tiff')).toMatchObject({
      signature: 'tiff',
      headerValidation: 'invalid',
      dimensionStatus: 'invalid'
    })
    expect(byHash.get('jpeg-unbounded-tail')).toMatchObject({
      signature: 'jpeg',
      headerValidation: 'invalid',
      dimensionStatus: 'invalid'
    })
    expect(byHash.get('jpeg-unbounded-tail')?.inspectionReason).toContain('bounded tail scan')
  })

  test('does not accept a JPEG with only SOI and EOI markers as a valid header', () => {
    const inspection = inspectImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))

    expect(inspection).toMatchObject({
      signature: 'jpeg',
      mimeType: 'image/jpeg',
      headerValidation: 'invalid',
      dimensionStatus: 'invalid'
    })
    expect(inspection.reason).toContain('before a start-of-frame')
  })

  test('bounds ISO BMFF compatible-brand inspection by the segment budget', () => {
    const firstExcludedOffset = 16 + IMAGE_INSPECTION_LIMITS.maxHeaderSegments * 4
    const bytes = new Uint8Array(firstExcludedOffset + 4)
    new DataView(bytes.buffer).setUint32(0, bytes.byteLength)
    bytes.set(Buffer.from('ftyp'), 4)
    bytes.set(Buffer.from('mif1'), 8)
    bytes.set(Buffer.from('avif'), firstExcludedOffset)

    const inspection = inspectImageBytes(bytes)
    expect(inspection).toMatchObject({
      signature: null,
      mimeType: null,
      headerValidation: 'invalid',
      dimensionStatus: 'invalid'
    })
  })
})
