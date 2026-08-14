import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'

import {
  CodePenShowcaseError,
  createCodePenStaticShowcase
} from '@open-pencil/compiler/codepen/static'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const VALID_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
)

function pngWithAncillaryBytes(size: number): Uint8Array {
  const iendOffset = VALID_PNG.byteLength - 12
  const output = new Uint8Array(VALID_PNG.byteLength + 12 + size)
  output.set(VALID_PNG.subarray(0, iendOffset))
  new DataView(output.buffer).setUint32(iendOffset, size)
  output.set(new TextEncoder().encode('tEXt'), iendOffset + 4)
  output.set(VALID_PNG.subarray(iendOffset), iendOffset + 12 + size)
  return output
}

function addImageFill(
  graph: ReturnType<typeof makeSceneGraph>,
  pageId: string,
  hash: string,
  bytes: Uint8Array
): void {
  graph.images.set(hash, bytes)
  graph.createNode('RECTANGLE', pageId, {
    width: 100,
    height: 100,
    fills: [
      {
        type: 'IMAGE',
        imageHash: hash,
        imageScaleMode: 'FILL',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
}

describe('CodePen static visual adapter', () => {
  test('emits deterministic script-free HTML/CSS without a framework compiler', () => {
    const graph = makeSceneGraph('Static CodePen')
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      name: 'Card',
      x: 120,
      y: 80,
      width: 320,
      height: 180,
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Title',
      text: 'OpenPencil <CodePen>',
      x: 0,
      y: 0,
      width: 240,
      height: 40
    })

    const before = structuredClone([...graph.nodes])
    const first = createCodePenStaticShowcase(
      { graph, pageId },
      { title: 'Static visual', tags: ['openpencil'] }
    )
    const second = createCodePenStaticShowcase(
      { graph, pageId },
      { title: 'Static visual', tags: ['openpencil'] }
    )

    expect(first.payload).toBe(second.payload)
    expect(first.compatible).toBe(true)
    expect(first.js).toBe('')
    expect(first.html).toContain('data-open-pencil-codepen-static')
    expect(first.html).toContain('OpenPencil &lt;CodePen&gt;')
    expect(first.html).toContain('width: 320px; height: 180px')
    expect(first.css).toContain('.op-codepen-stage')
    expect(first.html).not.toContain('<script')
    expect(first.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'codepen-static-visual-only', severity: 'warning' })
    )
    expect([...graph.nodes]).toEqual(before)
  })

  test('reports machine-readable low-code, control, motion, and visual degradations', () => {
    const graph = makeSceneGraph('Static degradation')
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('Missing page')
    graph.updateNode(pageId, {
      state: [{ id: 'count', name: 'count', type: 'number', defaultValue: 0 }],
      lowcodeRoutePattern: '/items/:id'
    })
    graph.createNode('BUTTON', pageId, {
      name: 'Action',
      width: 120,
      height: 40,
      motion: { version: 1, tracks: [] }
    })
    graph.createNode('VECTOR', pageId, { name: 'Vector', width: 40, height: 40 })

    const result = createCodePenStaticShowcase({ graph, pageId })
    const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code))

    expect(codes).toContain('codepen-static-routing-omitted')
    expect(codes).toContain('codepen-static-runtime-omitted')
    expect(codes).toContain('codepen-static-controls-inert')
    expect(codes).toContain('codepen-static-motion-omitted')
    expect(codes).toContain('codepen-static-visual-degraded')
  })

  test('rejects active image schemes without echoing the source', () => {
    const graph = makeSceneGraph('Unsafe image')
    const pageId = firstPageId(graph)
    const source = ['java', 'script:alert(12345)'].join('')
    graph.createNode('RECTANGLE', pageId, {
      name: 'Remote image',
      width: 100,
      height: 100,
      pluginData: [{ pluginId: 'open-pencil-dom-css', key: 'image-source-url', value: source }]
    })

    try {
      createCodePenStaticShowcase({ graph, pageId })
      throw new Error('Expected unsafe image rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(CodePenShowcaseError)
      expect(error instanceof Error ? error.message : '').not.toContain(source)
      expect((error as CodePenShowcaseError).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'codepen-static-export-rejected', severity: 'error' })
      )
    }
  })

  test('applies the shared secret scan to visible static content', () => {
    const graph = makeSceneGraph('Secret text')
    const pageId = firstPageId(graph)
    const secret = ['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_')
    graph.createNode('TEXT', pageId, {
      name: 'Secret',
      text: secret,
      width: 320,
      height: 40
    })

    try {
      createCodePenStaticShowcase({ graph, pageId })
      throw new Error('Expected secret rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(CodePenShowcaseError)
      expect(error instanceof Error ? error.message : '').not.toContain(secret)
      expect((error as CodePenShowcaseError).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'codepen-secret-detected', severity: 'error' })
      )
    }
  })

  test('validates only referenced PNG bytes before creating image data URLs', () => {
    const graph = makeSceneGraph('Static image')
    const pageId = firstPageId(graph)
    addImageFill(graph, pageId, 'valid', VALID_PNG)
    graph.images.set(
      'unused-secret',
      new TextEncoder().encode(['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_'))
    )

    const result = createCodePenStaticShowcase({ graph, pageId })
    expect(result.html).toContain('data:image/png;base64,')
  })

  test('rejects image secrets, trailing polyglots, and non-PNG containers without echoing', () => {
    const secret = ['sk', 'live', 'abcdefghijklmnopqrstuv'].join('_')
    const cases = [
      {
        name: 'secret trailer',
        bytes: new Uint8Array([...VALID_PNG, ...new TextEncoder().encode(secret)]),
        code: 'codepen-secret-detected'
      },
      {
        name: 'non-secret trailer',
        bytes: new Uint8Array([...VALID_PNG, 0x3c, 0x73, 0x76, 0x67, 0x3e]),
        code: 'codepen-static-image-rejected'
      },
      {
        name: 'JPEG container',
        bytes: new Uint8Array([
          0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, 0, 1, 0, 1, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
          0xff, 0xd9
        ]),
        code: 'codepen-static-image-rejected'
      }
    ]

    for (const [index, fixture] of cases.entries()) {
      const graph = makeSceneGraph(fixture.name)
      const pageId = firstPageId(graph)
      addImageFill(graph, pageId, `asset-${index}`, fixture.bytes)
      try {
        createCodePenStaticShowcase({ graph, pageId })
        throw new Error('Expected image rejection')
      } catch (error) {
        expect(error, fixture.name).toBeInstanceOf(CodePenShowcaseError)
        expect((error as CodePenShowcaseError).diagnostics, fixture.name).toContainEqual(
          expect.objectContaining({ code: fixture.code, severity: 'error' })
        )
        expect(JSON.stringify((error as CodePenShowcaseError).diagnostics)).not.toContain(secret)
      }
    }
  })

  test('bounds single and repeated image expansion before static HTML allocation', () => {
    const cases = [
      { name: 'single', bytes: pngWithAncillaryBytes(700_000), references: 1 },
      { name: 'aggregate', bytes: pngWithAncillaryBytes(200_000), references: 4 }
    ]
    for (const fixture of cases) {
      const graph = makeSceneGraph(fixture.name)
      const pageId = firstPageId(graph)
      for (let index = 0; index < fixture.references; index++) {
        addImageFill(graph, pageId, fixture.name, fixture.bytes)
      }
      expect(() => createCodePenStaticShowcase({ graph, pageId })).toThrow('Prefill safety limit')
    }
  })

  test('diagnoses remote HTTPS images as external CodePen dependencies', () => {
    const graph = makeSceneGraph('Remote static image')
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      width: 100,
      height: 100,
      pluginData: [
        {
          pluginId: 'open-pencil-dom-css',
          key: 'image-source-url',
          value: 'https://images.example.invalid/preview.png'
        }
      ]
    })
    const result = createCodePenStaticShowcase({ graph, pageId })
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'codepen-static-network-image', severity: 'warning' })
    )
  })

  test('normalizes CJK Prefill metadata on UTF-8 byte boundaries', () => {
    const graph = makeSceneGraph('CJK metadata')
    const pageId = firstPageId(graph)
    const result = createCodePenStaticShowcase(
      { graph, pageId },
      {
        title: '界'.repeat(100),
        description: '描'.repeat(1_500),
        tags: ['标'.repeat(30)]
      }
    )

    const encoder = new TextEncoder()
    expect(encoder.encode(result.data.title).byteLength).toBeLessThanOrEqual(256)
    expect(encoder.encode(result.data.description).byteLength).toBeLessThanOrEqual(4_096)
    expect(encoder.encode(result.data.tags?.[0]).byteLength).toBeLessThanOrEqual(64)
    expect(result.data.title?.endsWith('\uFFFD')).toBe(false)
    expect(result.data.description?.endsWith('\uFFFD')).toBe(false)
    expect(result.data.tags?.[0]?.endsWith('\uFFFD')).toBe(false)
  })

  test('rejects secrets in Prefill metadata before returning a payload', () => {
    const graph = makeSceneGraph('Metadata secret')
    const pageId = firstPageId(graph)
    const secret = ['https://user', 'password@example.com/private'].join(':')

    try {
      createCodePenStaticShowcase({ graph, pageId }, { description: secret })
      throw new Error('Expected metadata secret rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(CodePenShowcaseError)
      expect(error instanceof Error ? error.message : '').not.toContain(secret)
      expect((error as CodePenShowcaseError).diagnostics).toContainEqual(
        expect.objectContaining({ code: 'codepen-secret-detected', severity: 'error' })
      )
    }
  })

  test('fails closed for missing or non-page roots', () => {
    const graph = makeSceneGraph('Invalid page')
    expect(() => createCodePenStaticShowcase({ graph, pageId: 'missing' })).toThrow(
      'requires one existing page ID'
    )
  })
})
