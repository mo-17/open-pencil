import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { drawSelection } from '#core/canvas/overlays/selection'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { hasVolatileOverlay, renderSceneToCanvas } from '#core/canvas/renderer/pipeline'
import { renderNode } from '#core/canvas/scene'
import { renderNodesToSVG } from '#core/io/formats/svg'
import type { MotionVisualState } from '#core/motion'

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
      ancestorHasMotionTransform
    ) {
      renderNode(
        this as SkiaRenderer,
        canvas,
        graph,
        nodeId,
        overlays,
        parentAbsX,
        parentAbsY,
        ancestorHasMotionTransform
      )
    }
  } as SkiaRenderer
}

function rendererFixture(value: object): SkiaRenderer {
  return value as SkiaRenderer
}

function calls(fn: ReturnType<typeof mock>): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls
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
    const renderer = rendererFixture({
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
})
