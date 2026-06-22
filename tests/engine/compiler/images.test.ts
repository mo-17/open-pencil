import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { ImageScaleMode, SceneGraph } from '@open-pencil/core/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 4 §24.1/§24.3 — a node carrying `interactiveProps.image` renders as a
 * void `<img>` (src = a literal URL or a bound expression, e.g. a §18 upload
 * result doc-state; + alt + object-fit). `interactiveProps.aspectRatio` adds an
 * `aspect-[w/h]` utility to any node. Pure compiler-emit, zero scene-graph/codec.
 */
describe('compile — images & aspect-ratio (Phase 4 §24.1/§24.3)', () => {
  function compileNode(
    interactiveProps: Record<string, unknown>,
    opts: { type?: 'RECTANGLE' | 'FRAME'; docStates?: unknown[] } = {}
  ): { app: string; warnings: { code: string }[]; files: Map<string, string | Uint8Array> } {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    if (opts.docStates) graph.updateNode(graph.rootId, { lowcodeDocumentState: opts.docStates })
    graph.createNode(opts.type ?? 'RECTANGLE', pageId, {
      name: 'N',
      width: 320,
      height: 180,
      interactiveProps
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'img' }) })
    return { app: out.files.get('src/App.tsx') as string, warnings: out.warnings, files: out.files }
  }

  test('literal-URL image → void <img src alt> + object-fit', () => {
    const { app } = compileNode({
      image: { src: 'https://x.com/a.png', alt: 'Hero', objectFit: 'cover' }
    })
    expect(app).toContain('<img')
    expect(app).toContain('src="https://x.com/a.png"')
    expect(app).toContain('alt="Hero"')
    expect(app).toContain('object-cover')
    expect(app).toContain('/>') // void self-close
  })

  test('bound src (srcExpr) → src={expr} + useDocState (chains §18 upload result)', () => {
    const { app } = compileNode(
      { image: { srcExpr: 'avatarUrl', alt: '', objectFit: 'contain' } },
      { docStates: [{ id: 'd1', name: 'avatarUrl', type: 'string', defaultValue: '' }] }
    )
    expect(app).toContain('const avatarUrl = useDocState("avatarUrl")')
    expect(app).toContain('src={avatarUrl}')
    expect(app).toContain('alt=""')
    expect(app).toContain('object-contain')
  })

  test('aspectRatio adds aspect-[w/h] (on an image node)', () => {
    const { app } = compileNode({
      image: { src: 'https://x/a.png', alt: 'a' },
      aspectRatio: '16/9'
    })
    expect(app).toContain('aspect-[16/9]')
  })

  test('aspectRatio applies to a non-image node too', () => {
    const { app } = compileNode({ aspectRatio: '4/3' }, { type: 'FRAME' })
    expect(app).toContain('aspect-[4/3]')
    expect(app).not.toContain('<img')
  })

  test('object-fit variants map to their utility', () => {
    for (const [fit, cls] of [
      ['fill', 'object-fill'],
      ['none', 'object-none'],
      ['scale-down', 'object-scale-down']
    ] as const) {
      const { app } = compileNode({ image: { src: 'https://x/a.png', alt: '', objectFit: fit } })
      expect(app).toContain(cls)
    }
  })

  test('missing src → warn + plain node (not an <img>)', () => {
    const { app, warnings } = compileNode({ image: { alt: 'x' } })
    expect(warnings.map((w) => w.code)).toContain('image-missing-src')
    expect(app).not.toContain('<img')
  })

  test('bad srcExpr → skip (plain node)', () => {
    const { app, warnings } = compileNode({ image: { srcExpr: 'unknownVar', alt: '' } })
    expect(warnings.some((w) => w.code === 'image-src-unknown')).toBe(true)
    expect(app).not.toContain('<img')
  })

  test('invalid aspectRatio → warn + dropped', () => {
    const { app, warnings } = compileNode({ aspectRatio: 'wide' }, { type: 'FRAME' })
    expect(warnings.map((w) => w.code)).toContain('aspect-ratio-invalid')
    expect(app).not.toContain('aspect-[')
  })

  test('no image/aspect config → byte-identical (no <img>, no aspect)', () => {
    const { app } = compileNode({})
    expect(app).not.toContain('<img')
    expect(app).not.toContain('aspect-[')
  })

  test('image classes are seeded into the Tailwind safelist (index.css)', () => {
    const { files } = compileNode({
      image: { src: 'https://x/a.png', alt: 'a', objectFit: 'cover' },
      aspectRatio: '16/9'
    })
    const css = files.get('src/index.css') as string
    expect(css).toContain('object-cover')
    expect(css).toContain('aspect-[16/9]')
  })

  test('onClick on an image node emits on the <img>', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'open', type: 'string', defaultValue: '' }]
    })
    graph.createNode('RECTANGLE', pageId, {
      name: 'Clickable',
      width: 100,
      height: 100,
      interactiveProps: { image: { src: 'https://x/a.png', alt: 'a' } },
      events: {
        onClick: [{ id: 'a', kind: 'setVariable', targetName: 'open', valueExpr: '"yes"' }]
      }
    })
    const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'img' }) })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<img')
    expect(app).toContain('onClick={')
    expect(app).toContain('setDocState("open", "yes")')
  })
})

describe('compile — Figma image fills (Phase 4 §24 v2)', () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])

  function compileImageFill(
    opts: { imageHash?: string; bytes?: Uint8Array; scaleMode?: ImageScaleMode } = {}
  ): { app: string; warnings: { code: string }[]; files: Map<string, string | Uint8Array> } {
    const graph: SceneGraph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const imageHash = opts.imageHash ?? 'fig-image-1'
    if (opts.bytes) graph.images.set(imageHash, opts.bytes)
    graph.createNode('RECTANGLE', pageId, {
      name: 'PhotoFill',
      width: 160,
      height: 120,
      fills: [
        {
          type: 'IMAGE',
          imageHash,
          imageScaleMode: opts.scaleMode ?? 'FILL',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'image-fill' })
    })
    return { app: out.files.get('src/App.tsx') as string, warnings: out.warnings, files: out.files }
  }

  test('exports graph image bytes and references them from a background utility', () => {
    const { app, files } = compileImageFill({ bytes: PNG_BYTES })

    const path = 'src/assets/openpencil-image-fig-image-1.png'
    expect(files.get(path)).toEqual(PNG_BYTES)
    expect(app).toContain('bg-[url(./assets/openpencil-image-fig-image-1.png)]')
    expect(app).toContain('bg-cover')
    expect(app).toContain('bg-no-repeat')
  })

  test('FIT image fills use contain sizing', () => {
    const { app } = compileImageFill({ bytes: PNG_BYTES, scaleMode: 'FIT' })

    expect(app).toContain('bg-contain')
    expect(app).toContain('bg-no-repeat')
  })

  test('TILE image fills repeat', () => {
    const { app } = compileImageFill({ bytes: PNG_BYTES, scaleMode: 'TILE' })

    expect(app).toContain('bg-auto')
    expect(app).toContain('bg-repeat')
  })

  test('missing image bytes warn and skip background asset emit', () => {
    const { app, files, warnings } = compileImageFill()

    expect(warnings.map((w) => w.code)).toContain('image-fill-missing-asset')
    expect(files.has('src/assets/openpencil-image-fig-image-1.png')).toBe(false)
    expect(app).not.toContain('bg-[url(')
  })
})
