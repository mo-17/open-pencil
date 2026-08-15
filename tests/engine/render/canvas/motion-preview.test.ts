import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import type { MotionVisualState } from '@open-pencil/motion'
import { SceneGraph, type MotionSpec, type SceneNode } from '@open-pencil/scene-graph'

import { renderBooleanOperation } from '#core/canvas/boolean'
import { motionProjectionFlags, motionTrimProjection } from '#core/canvas/motion-projection'
import { drawSelection } from '#core/canvas/overlays/selection'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { hasVolatileOverlay, renderSceneToCanvas } from '#core/canvas/renderer/pipeline'
import { renderNode } from '#core/canvas/scene'
import { renderNodesToSVG } from '#core/io/formats/svg'
import { computeMotionLayoutPreview, setTextMeasurer } from '#core/layout'

import { fixed, gridFrame, rect } from '#tests/helpers/layout'

function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}

function authoredMotion(): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'enter',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 100 }
      }
    ]
  }
}

function createCanvas() {
  return {
    save: mock(() => undefined),
    restore: mock(() => undefined),
    translate: mock(() => undefined),
    rotate: mock(() => undefined),
    scale: mock(() => undefined),
    saveLayer: mock(() => undefined)
  }
}

function createRenderer() {
  return {
    _nodeCount: 0,
    _culledCount: 0,
    worldViewport: { x: -1_000, y: -1_000, w: 2_000, h: 2_000 },
    ck: {
      BlendMode: { SrcOver: 'SrcOver' },
      LTRBRect: mock((left: number, top: number, right: number, bottom: number) => [
        left,
        top,
        right,
        bottom
      ])
    },
    opacityPaint: {
      setAlphaf: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    },
    effectLayerPaint: {
      setImageFilter: mock(() => undefined),
      setColorFilter: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    },
    getCachedBlur: mock(() => null),
    renderShape: mock(() => undefined),
    renderSection: mock(() => undefined),
    renderComponentSet: mock(() => undefined),
    renderNode(
      canvas,
      graph,
      nodeId,
      overlays,
      parentAbsX,
      parentAbsY,
      hasTransformedAncestor,
      hasTransientTransformedAncestor
    ) {
      renderNode(
        this as SkiaRenderer,
        canvas,
        graph,
        nodeId,
        overlays,
        parentAbsX,
        parentAbsY,
        hasTransformedAncestor,
        hasTransientTransformedAncestor
      )
    }
  } as SkiaRenderer
}

function rendererFixture(value: object): SkiaRenderer {
  return value as SkiaRenderer
}

function isolatedRendererFixture(value: object): SkiaRenderer {
  return rendererFixture({
    imageCache: new Map(),
    imageCacheByteSize: 0,
    imageCacheByteBudget: 128 * 1024 * 1024,
    imageCacheFrameDepth: 0,
    imageCacheFrameUsed: new Set(),
    pendingFontNodes: new Map(),
    textPictureGenerations: new Map(),
    imageFilterCache: new Map(),
    maskFilterCache: new Map(),
    renderCacheGraph: new SceneGraph(),
    renderCachePageId: 'previous-page',
    vectorPathCache: new Map(),
    vectorStrokePathCache: new Map(),
    vectorStrokeOutlineCache: new Map(),
    fillGeometryCache: new Map(),
    strokeGeometryCache: new Map(),
    nodePictureCache: new Map(),
    nodePictureCacheGenerations: new Map(),
    effectLayerPaint: { setImageFilter: mock(() => undefined) },
    auxFill: {
      setImageFilter: mock(() => undefined),
      setMaskFilter: mock(() => undefined)
    },
    ...value
  })
}

function calls(fn: ReturnType<typeof mock>): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls
}

function visual(overrides: Partial<MotionVisualState>): MotionVisualState {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, ...overrides }
}

describe('CanvasKit motion preview', () => {
  test('applies translation, center transforms, and authored-opacity multiplication', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      opacity: 0.8,
      motion: authoredMotion()
    })
    const authored = structuredClone(graph.getNode(node.id))
    const visual: MotionVisualState = {
      x: 15,
      y: -5,
      scaleX: 2,
      scaleY: 0.5,
      rotate: 30,
      opacity: 0.5
    }
    const renderer = createRenderer()
    const canvas = createCanvas()

    renderNode(renderer, canvas as Canvas, graph, node.id, {
      motionVisualStates: new Map([[node.id, visual]])
    })

    expect(calls(canvas.translate)[0]).toEqual([25, 15])
    expect(canvas.rotate).toHaveBeenCalledWith(30, 50, 30)
    expect(calls(canvas.translate)).toContainEqual([50, 30])
    expect(calls(canvas.translate)).toContainEqual([-50, -30])
    expect(canvas.scale).toHaveBeenCalledWith(2, 0.5)
    expect(renderer.opacityPaint.setAlphaf).toHaveBeenCalledWith(0.4)
    expect(canvas.saveLayer).toHaveBeenCalledWith(renderer.opacityPaint, null)
    expect(graph.getNode(node.id)).toEqual(authored)
  })

  test('rotates line motion around its center while preserving authored line rotation behavior', () => {
    const graph = new SceneGraph()
    const line = graph.createNode('LINE', pageId(graph), {
      width: 100,
      height: 10,
      rotation: 10
    })
    const renderer = createRenderer()
    const canvas = createCanvas()

    renderNode(renderer, canvas as Canvas, graph, line.id, {
      motionVisualStates: new Map([
        [line.id, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 45, opacity: 1 }]
      ])
    })

    expect(calls(canvas.rotate)).toContainEqual([10, 0, 0])
    expect(calls(canvas.rotate)).toContainEqual([45, 50, 5])
  })

  test('scales intrinsic VECTOR and BOOLEAN geometry for animated dimensions', () => {
    for (const type of ['VECTOR', 'BOOLEAN_OPERATION'] as const) {
      const graph = new SceneGraph()
      const node = graph.createNode(type, pageId(graph), {
        width: 40,
        height: 20,
        ...(type === 'BOOLEAN_OPERATION' ? { booleanOperation: 'UNION' as const } : {})
      })
      const authored = structuredClone(graph.getNode(node.id))
      const renderer = createRenderer()
      const canvas = createCanvas()

      renderNode(renderer, canvas as Canvas, graph, node.id, {
        motionVisualStates: new Map([[node.id, visual({ width: 80, height: 10 })]])
      })

      expect(calls(canvas.scale)).toContainEqual([2, 0.5])
      expect(graph.getNode(node.id)).toEqual(authored)
    }
  })

  test('scales FILL vector geometry when an animated parent drives COW layout dimensions', () => {
    for (const type of ['VECTOR', 'BOOLEAN_OPERATION'] as const) {
      const graph = new SceneGraph()
      const parent = graph.createNode('FRAME', pageId(graph), {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED',
        width: 40,
        height: 20
      })
      const child = graph.createNode(type, parent.id, {
        width: 10,
        height: 20,
        layoutGrow: 1,
        ...(type === 'BOOLEAN_OPERATION' ? { booleanOperation: 'UNION' as const } : {})
      })
      const preview = computeMotionLayoutPreview(
        graph,
        new Map([[parent.id, visual({ width: 80 })]])
      )
      expect(preview.get(child.id)?.width).toBe(80)
      const renderer = createRenderer()
      const canvas = createCanvas()

      renderNode(renderer, canvas as Canvas, graph, child.id, { motionLayoutNodes: preview })

      expect(calls(canvas.scale)).toContainEqual([8, 1])
    }
  })

  test('keeps unrelated opacity and blur layers bounded during another node preview', () => {
    const graph = new SceneGraph()
    const bounded = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 60,
      opacity: 0.5,
      effects: [
        {
          type: 'LAYER_BLUR',
          visible: true,
          radius: 10,
          spread: 0,
          offset: { x: 0, y: 0 },
          color: { r: 0, g: 0, b: 0, a: 0 }
        }
      ]
    })
    const moving = graph.createNode('RECTANGLE', pageId(graph), { width: 20, height: 20 })
    const renderer = createRenderer()
    const canvas = createCanvas()

    renderNode(renderer, canvas as Canvas, graph, bounded.id, {
      motionVisualStates: new Map([
        [moving.id, { x: 50, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 }]
      ])
    })

    expect(calls(canvas.saveLayer)).toHaveLength(2)
    expect(calls(canvas.saveLayer).every(([, bounds]) => bounds !== null)).toBe(true)
  })

  test('does not cull descendants using authored bounds under ancestor motion transforms', () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      width: 100,
      height: 100,
      clipsContent: false
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      x: -200,
      width: 20,
      height: 20
    })
    const renderer = createRenderer()
    renderer.worldViewport = { x: 0, y: 0, w: 100, h: 100 }
    const canvas = createCanvas()

    renderNode(renderer, canvas as Canvas, graph, frame.id, {
      motionVisualStates: new Map([
        [frame.id, { x: 0, y: 0, scaleX: 0.1, scaleY: 1, rotate: 0, opacity: 1 }]
      ])
    })

    expect(calls(renderer.renderShape).some(([, node]) => node === child)).toBe(true)
    expect(renderer._culledCount).toBe(0)
  })

  test('marks motion overlays volatile but keeps empty maps cacheable', () => {
    expect(hasVolatileOverlay({ motionVisualStates: new Map() })).toBe(false)
    expect(
      hasVolatileOverlay({
        motionVisualStates: new Map([
          ['node', { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 }]
        ])
      })
    ).toBe(true)
  })

  test('keeps static raster and thumbnail scene rendering free of preview overlays', () => {
    const graph = new SceneGraph()
    graph.createNode('RECTANGLE', pageId(graph), {
      width: 10,
      height: 10,
      motion: authoredMotion()
    })
    const seen: unknown[] = []
    const renderer = isolatedRendererFixture({
      worldViewport: { x: 1, y: 2, w: 3, h: 4 },
      renderNode: mock((_canvas, _graph, _nodeId, overlays) => seen.push(overlays))
    })

    renderSceneToCanvas(renderer, {} as Canvas, graph, pageId(graph))

    expect(seen).toEqual([{}])
    expect(renderer.worldViewport).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  })

  test("keeps static SVG and PDF's SVG source on authored geometry", () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      motion: {
        version: 1,
        tracks: [
          {
            id: 'move-far',
            trigger: 'mount',
            keyframes: [
              { offset: 0, x: 500 },
              { offset: 1, x: 500 }
            ],
            timing: { durationMs: 100 }
          }
        ]
      }
    })
    const authored = structuredClone(graph.getNode(node.id))

    const svg = renderNodesToSVG(graph, pageId(graph), [node.id])

    expect(svg).toContain('width="100"')
    expect(svg).toContain('height="60"')
    expect(svg).not.toContain('500')
    expect(svg).not.toContain('data-op-motion')
    expect(graph.getNode(node.id)).toEqual(authored)
  })

  test('keeps selection chrome on authored bounds during scene-only motion preview', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      x: 10,
      y: 20,
      width: 100,
      height: 60,
      rotation: 12
    })
    const renderer = rendererFixture({
      zoom: 1,
      drawParentFrameOutlines: mock(() => undefined),
      isComponentType: mock(() => false),
      selectionPaint: {
        setColor: mock(() => undefined),
        setStrokeWidth: mock(() => undefined)
      },
      compColor: mock(() => 'component'),
      selColor: mock(() => 'selection'),
      drawNodeSelection: mock(() => undefined),
      drawSelectionLabels: mock(() => undefined)
    })

    drawSelection(renderer, {} as Canvas, graph, new Set([node.id]), {
      motionVisualStates: new Map([
        [node.id, { x: 500, y: 500, scaleX: 2, scaleY: 2, rotate: 45, opacity: 1 }]
      ])
    })

    expect(renderer.drawNodeSelection).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: node.id, x: 10, y: 20 }),
      12,
      graph
    )
  })

  test('reflows HORIZONTAL and GRID gaps in a copy-on-write preview', () => {
    const graph = new SceneGraph()
    const horizontal = graph.createNode('FRAME', pageId(graph), {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      width: 300,
      height: 80,
      itemSpacing: 10,
      paddingLeft: 10
    })
    const first = rect(graph, horizontal.id, 50, 20)
    const second = rect(graph, horizontal.id, 30, 20)
    const grid = gridFrame(graph, pageId(graph), [fixed(100), fixed(100)], [fixed(40)], {
      width: 230,
      height: 40,
      gridColumnGap: 5,
      gridRowGap: 5
    })
    const gridFirst = rect(graph, grid.id, 20, 20)
    const gridSecond = rect(graph, grid.id, 20, 20)
    const authored = [horizontal, first, second, grid, gridFirst, gridSecond].map((node) =>
      structuredClone(graph.getNode(node.id))
    )

    const preview = computeMotionLayoutPreview(
      graph,
      new Map([
        [horizontal.id, visual({ gap: 12, rowGap: 18, columnGap: 30, paddingLeft: 20 })],
        [first.id, visual({ width: 100 })],
        [grid.id, visual({ gap: 10, rowGap: 20, columnGap: 30 })]
      ])
    )

    expect(preview.get(first.id)).toMatchObject({ x: 20, width: 100 })
    expect(preview.get(second.id)?.x).toBe(150)
    // Unchanged preview geometry intentionally falls through to the authored
    // node instead of allocating a redundant copy-on-write entry.
    expect(preview.get(gridFirst.id)).toBeUndefined()
    expect(preview.get(gridSecond.id)?.x).toBe(130)
    for (const [index, node] of [
      horizontal,
      first,
      second,
      grid,
      gridFirst,
      gridSecond
    ].entries()) {
      expect(graph.getNode(node.id)).toEqual(authored[index])
    }
  })

  test('animated TEXT dimensions override auto-resize only in the COW preview', () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      width: 200,
      height: 80
    })
    const text = graph.createNode('TEXT', frame.id, {
      text: 'measured',
      width: 100,
      height: 12,
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
    const authored = structuredClone(graph.getNode(text.id))
    setTextMeasurer(() => ({ width: 160, height: 44 }))
    try {
      const preview = computeMotionLayoutPreview(
        graph,
        new Map([[text.id, visual({ width: 40, height: 20 })]])
      )
      expect(preview.get(text.id)).toMatchObject({ width: 40, height: 20 })
      expect(graph.getNode(text.id)).toEqual(authored)
      expect(graph.getNode(text.id).textAutoResize).toBe('WIDTH_AND_HEIGHT')
    } finally {
      setTextMeasurer(null)
    }
  })

  test('projects curved trim length, normalized phase, full visibility, and zero visibility', () => {
    const graph = new SceneGraph()
    const vector = graph.createNode('VECTOR', pageId(graph), {
      width: 100,
      height: 100,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 }
        ],
        segments: [
          {
            start: 0,
            end: 1,
            tangentStart: { x: 0, y: 100 },
            tangentEnd: { x: 0, y: 100 }
          }
        ],
        regions: []
      },
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER',
          dashPattern: [2, 3]
        }
      ]
    })
    const authored = structuredClone(graph.getNode(vector.id))
    const projected = (state: MotionVisualState): SceneNode => {
      const renderer = createRenderer()
      renderNode(renderer, createCanvas() as Canvas, graph, vector.id, {
        motionVisualStates: new Map([[vector.id, state]])
      })
      return calls(renderer.renderShape)[0]?.[1] as SceneNode
    }

    const partial = projected(visual({ trimStart: 0.75, trimEnd: 1, trimOffset: 0.5 }))
    const dash = partial.strokes[0]?.dashPattern ?? []
    expect(dash).toHaveLength(2)
    expect(dash[0] + dash[1]).toBeGreaterThan(150)
    expect(
      Object.getOwnPropertySymbols(partial)
        .map((symbol) => Reflect.get(partial, symbol))
        .some((value) => typeof value === 'number' && value < 0)
    ).toBe(true)

    const full = projected(visual({ trimStart: 0, trimEnd: 1, trimOffset: 0.75 }))
    expect(full.strokes[0]?.dashPattern).toEqual([])
    expect(motionTrimProjection(full)).toEqual({ visibleFraction: 1, phase: 0.75 })
    const hidden = projected(visual({ trimStart: 0.4, trimEnd: 0.4 }))
    expect(hidden.strokes[0]?.opacity).toBe(0)
    expect(graph.getNode(vector.id)).toEqual(authored)
  })

  test('full trim overrides authored dashes for LINE, STAR, and POLYGON', () => {
    for (const type of ['LINE', 'STAR', 'POLYGON'] as const) {
      const graph = new SceneGraph()
      const node = graph.createNode(type, pageId(graph), {
        width: 80,
        height: 40,
        strokes: [
          {
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true,
            weight: 2,
            align: 'CENTER',
            dashPattern: [2, 3]
          }
        ]
      })
      const renderer = createRenderer()

      renderNode(renderer, createCanvas() as Canvas, graph, node.id, {
        motionVisualStates: new Map([[node.id, visual({ trimStart: 0, trimEnd: 1 })]])
      })

      const projected = calls(renderer.renderShape)[0]?.[1] as SceneNode
      expect(projected.strokes[0]?.dashPattern).toEqual([])
    }
  })

  test('measures BOOLEAN trim against the final CanvasKit path', () => {
    class FakePath {
      addPath(): undefined {
        return undefined
      }
      delete(): undefined {
        return undefined
      }
    }
    class FakeContourMeasureIter {
      private consumed = false
      next() {
        if (this.consumed) return null
        this.consumed = true
        return { length: () => 200, delete: () => undefined }
      }
      delete(): undefined {
        return undefined
      }
    }
    const makeDash = mock(() => ({ delete: () => undefined }))
    const strokePaint = {
      setColor: mock(() => undefined),
      setStrokeWidth: mock(() => undefined),
      setAlphaf: mock(() => undefined),
      setPathEffect: mock(() => undefined)
    }
    const graph = new SceneGraph()
    const authored = graph.createNode('BOOLEAN_OPERATION', pageId(graph), {
      width: 100,
      height: 100,
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          weight: 2,
          align: 'CENTER'
        }
      ]
    })
    const projected = {
      ...authored,
      ...motionProjectionFlags(-1, true, { visibleFraction: 0.25, phase: 0.6 })
    }
    const renderer = rendererFixture({
      ck: {
        Path: FakePath,
        ContourMeasureIter: FakeContourMeasureIter,
        PathEffect: { MakeDash: makeDash },
        Color4f: (...values: number[]) => values
      },
      getFillGeometry: () => [new FakePath()],
      resolveStrokeColor: (stroke: SceneNode['strokes'][number]) => stroke.color,
      strokePaint
    })
    const canvas = { drawPath: mock(() => undefined) } as Canvas

    renderBooleanOperation(renderer, canvas, projected, graph)

    expect(makeDash).toHaveBeenCalledWith([50, 150], -120)
    expect(canvas.drawPath).toHaveBeenCalled()
    expect(strokePaint.setPathEffect).toHaveBeenLastCalledWith(null)
  })
})
