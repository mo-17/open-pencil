import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import type { GradientTransform, ImageScaleMode, SceneGraph } from '@open-pencil/core/scene-graph'

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

  test('image loading accepts lazy/eager and drops invalid values', () => {
    const lazy = compileNode({ image: { src: 'https://x/a.png', alt: '', loading: 'lazy' } })
    expect(lazy.app).toContain('loading="lazy"')

    const eager = compileNode({ image: { src: 'https://x/a.png', alt: '', loading: 'eager' } })
    expect(eager.app).toContain('loading="eager"')

    const invalid = compileNode({ image: { src: 'https://x/a.png', alt: '', loading: 'soon' } })
    expect(invalid.app).not.toContain('loading=')
  })

  test('responsive image sources emit a picture wrapper with literal srcSet values', () => {
    const { app } = compileNode({
      image: {
        src: 'https://x/desktop.jpg',
        alt: 'Hero',
        objectFit: 'cover',
        sources: [
          {
            srcSet: 'https://x/mobile.jpg 640w, https://x/mobile@2x.jpg 1280w',
            media: '(max-width: 640px)',
            type: 'image/jpeg',
            sizes: '100vw'
          }
        ]
      }
    })

    expect(app).toContain('<picture>')
    expect(app).toContain(
      '<source srcSet="https://x/mobile.jpg 640w, https://x/mobile@2x.jpg 1280w" media="(max-width: 640px)" type="image/jpeg" sizes="100vw" />'
    )
    expect(app).toContain('src="https://x/desktop.jpg"')
    expect(app).toContain('alt="Hero"')
    expect(app).toContain('object-cover')
    expect(app).toContain('</picture>')
  })

  test('responsive image source attributes escape quotes and ampersands', () => {
    const { app } = compileNode({
      image: {
        src: 'https://x/fallback.jpg',
        alt: '',
        sources: [
          {
            srcSet: 'https://x/mobile.jpg?name="hero"&w=640 640w',
            media: '(max-width: 640px) and (min-resolution: "2dppx")',
            type: 'image/svg+xml; charset="utf-8"',
            sizes: 'calc(100vw - "gap") & 100vw'
          }
        ]
      }
    })

    expect(app).toContain(
      '<source srcSet="https://x/mobile.jpg?name=&quot;hero&quot;&amp;w=640 640w" media="(max-width: 640px) and (min-resolution: &quot;2dppx&quot;)" type="image/svg+xml; charset=&quot;utf-8&quot;" sizes="calc(100vw - &quot;gap&quot;) &amp; 100vw" />'
    )
  })

  test('responsive image sources support bound srcSet expressions', () => {
    const { app } = compileNode(
      {
        image: {
          src: 'https://x/fallback.jpg',
          alt: '',
          sources: [{ srcSetExpr: 'heroSrcSet', media: '(min-width: 768px)' }]
        }
      },
      { docStates: [{ id: 'd1', name: 'heroSrcSet', type: 'string', defaultValue: '' }] }
    )

    expect(app).toContain('const heroSrcSet = useDocState("heroSrcSet")')
    expect(app).toContain('<source srcSet={heroSrcSet} media="(min-width: 768px)" />')
    expect(app).toContain('src="https://x/fallback.jpg"')
  })

  test('responsive image sources accept src and srcExpr aliases', () => {
    const { app } = compileNode(
      {
        image: {
          src: 'https://x/fallback.jpg',
          alt: '',
          sources: [
            { src: 'https://x/static-mobile.jpg', media: '(max-width: 640px)' },
            { srcExpr: 'mobileHeroSrc', type: 'image/webp' }
          ]
        }
      },
      { docStates: [{ id: 'd1', name: 'mobileHeroSrc', type: 'string', defaultValue: '' }] }
    )

    expect(app).toContain('const mobileHeroSrc = useDocState("mobileHeroSrc")')
    expect(app).toContain(
      '<source srcSet="https://x/static-mobile.jpg" media="(max-width: 640px)" />'
    )
    expect(app).toContain('<source srcSet={mobileHeroSrc} type="image/webp" />')
    expect(app).toContain('src="https://x/fallback.jpg"')
  })

  test('invalid responsive image sources are dropped without changing fallback image emit', () => {
    const { app, warnings } = compileNode({
      image: {
        src: 'https://x/fallback.jpg',
        alt: '',
        sources: [{ srcSetExpr: 'missingSrcSet' }, { media: '(max-width: 640px)' }]
      }
    })

    expect(warnings.some((w) => w.code === 'image-source-unknown')).toBe(true)
    expect(app).not.toContain('<picture>')
    expect(app).not.toContain('<source')
    expect(app).toContain('<img')
    expect(app).toContain('src="https://x/fallback.jpg"')
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
    opts: {
      imageHash?: string
      bytes?: Uint8Array
      scaleMode?: ImageScaleMode
      imageTransform?: GradientTransform
    } = {}
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
          imageTransform: opts.imageTransform,
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

  test('image fill assets infer SVG, WebP, and fallback binary extensions', () => {
    const svgBytes = new TextEncoder().encode('<?xml version="1.0"?><svg></svg>')
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2
    ])
    const binBytes = new Uint8Array([1, 2, 3, 4])

    const svg = compileImageFill({ imageHash: 'icon.svg?raw', bytes: svgBytes })
    expect(svg.files.get('src/assets/openpencil-image-iconsvgraw.svg')).toEqual(svgBytes)
    expect(svg.app).toContain('bg-[url(./assets/openpencil-image-iconsvgraw.svg)]')

    const webp = compileImageFill({ imageHash: 'hero-webp', bytes: webpBytes })
    expect(webp.files.get('src/assets/openpencil-image-hero-webp.webp')).toEqual(webpBytes)
    expect(webp.app).toContain('bg-[url(./assets/openpencil-image-hero-webp.webp)]')

    const bin = compileImageFill({ imageHash: 'opaque', bytes: binBytes })
    expect(bin.files.get('src/assets/openpencil-image-opaque.bin')).toEqual(binBytes)
    expect(bin.app).toContain('bg-[url(./assets/openpencil-image-opaque.bin)]')
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

  test('CROP image fills preserve axis-aligned image transforms as background geometry', () => {
    const { app } = compileImageFill({
      bytes: PNG_BYTES,
      scaleMode: 'CROP',
      imageTransform: { m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.75, m12: 0.125 }
    })

    expect(app).toContain('[background-size:50%_75%]')
    expect(app).toContain('[background-position:left_25%_top_12.5%]')
    expect(app).toContain('bg-no-repeat')
    expect(app).not.toContain('bg-cover')
  })

  test('CROP image fills with rotated transforms fall back to cover sizing', () => {
    const { app } = compileImageFill({
      bytes: PNG_BYTES,
      scaleMode: 'CROP',
      imageTransform: { m00: 0.5, m01: 0.1, m02: 0.25, m10: -0.2, m11: 0.75, m12: 0.125 }
    })

    expect(app).toContain('bg-cover')
    expect(app).toContain('bg-no-repeat')
    expect(app).not.toContain('[background-size:')
  })

  test('multiple visual fills emit one stacked background instead of competing bg utilities', () => {
    const graph: SceneGraph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.images.set('fig-image-1', PNG_BYTES)
    graph.createNode('RECTANGLE', pageId, {
      name: 'LayeredFill',
      width: 200,
      height: 100,
      fills: [
        { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true },
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ],
          gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }
        },
        {
          type: 'IMAGE',
          imageHash: 'fig-image-1',
          imageScaleMode: 'FIT',
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
    const app = out.files.get('src/App.tsx') as string
    const css = out.files.get('src/index.css') as string

    expect(app).toContain(
      '[background-image:url(./assets/openpencil-image-fig-image-1.png),linear-gradient(180deg,_#FF0000_0%,_#0000FF_100%),linear-gradient(#FFFFFF,_#FFFFFF)]'
    )
    expect(app).toContain('[background-size:contain,auto,auto]')
    expect(app).toContain('[background-position:center,0%_0%,0%_0%]')
    expect(app).toContain('[background-repeat:no-repeat,no-repeat,no-repeat]')
    expect(app).not.toContain('bg-white')
    expect(app).not.toContain('bg-[linear-gradient(')
    expect(app).not.toContain('bg-[url(')
    expect(css).toContain('background-image:url(./assets/openpencil-image-fig-image-1.png)')
  })

  test('multiple visual fills can stack a diamond gradient fallback layer', () => {
    const graph: SceneGraph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      name: 'DiamondLayer',
      width: 200,
      height: 100,
      fills: [
        { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true },
        {
          type: 'GRADIENT_DIAMOND',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
            { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }
          ],
          gradientTransform: { m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.5, m12: 0.25 }
        }
      ]
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'image-fill' })
    })
    const app = out.files.get('src/App.tsx') as string

    expect(app).toContain(
      '[background-image:radial-gradient(circle_at_50%_50%,_#FF0000_0%,_#0000FF_100%),linear-gradient(#FFFFFF,_#FFFFFF)]'
    )
    expect(app).toContain('[background-size:auto,auto]')
    expect(app).toContain('[background-repeat:no-repeat,no-repeat]')
  })

  test('missing image bytes warn and skip background asset emit', () => {
    const { app, files, warnings } = compileImageFill()

    expect(warnings.map((w) => w.code)).toContain('image-fill-missing-asset')
    expect(files.has('src/assets/openpencil-image-fig-image-1.png')).toBe(false)
    expect(app).not.toContain('bg-[url(')
  })

  test('unsupported visual fills warn and are skipped while supported layers still emit', () => {
    const graph: SceneGraph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      name: 'UnsupportedVisuals',
      width: 160,
      height: 120,
      fills: [
        { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true },
        {
          type: 'PATTERN',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          sourceNodeId: 'pattern-source'
        },
        { type: 'NOISE', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
        { type: 'VIDEO', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
        { type: 'CUSTOM', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
      ]
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'image-fill' })
    })
    const app = out.files.get('src/App.tsx') as string
    const codes = out.warnings.map((w) => w.code)

    expect(codes.filter((code) => code === 'visual-fill-type-unsupported')).toHaveLength(4)
    expect(app).toContain('bg-white')
    expect(app).not.toContain('PATTERN')
    expect(app).not.toContain('NOISE')
  })

  test('node blend emits mix-blend while unsupported mask and fill blend still warn', () => {
    const graph: SceneGraph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      name: 'BlendAndMask',
      width: 120,
      height: 80,
      isMask: true,
      maskType: 'LUMINANCE',
      blendMode: 'MULTIPLY',
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'SCREEN'
        }
      ]
    })
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'image-fill' })
    })
    const app = out.files.get('src/App.tsx') as string
    const css = out.files.get('src/index.css') as string
    const codes = out.warnings.map((w) => w.code)

    expect(codes).toContain('visual-mask-unsupported')
    expect(codes).not.toContain('visual-blend-mode-unsupported')
    expect(codes).toContain('visual-fill-blend-mode-unsupported')
    expect(app).toContain('mix-blend-multiply')
    expect(css).toContain('mix-blend-multiply')
    expect(app).toContain('bg-[#FF0000]')
  })
})
