import { describe, expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'

import { drawGeneratedEffect } from '#core/canvas/generated-effect'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { headlessRenderNodes } from '#core/io/formats/raster/headless'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

function mockCalls(fn: ReturnType<typeof mock>): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls
}

describe('CanvasKit generated-effect rendering', () => {
  test('clips, draws, and restores the allowlisted blend state', () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const node = graph.createNode('RECTANGLE', page.id, {
      width: 120,
      height: 80,
      generatedEffect: generatedEffect('particles')
    })
    const paint = {
      setColor: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    }
    // oxlint-disable-next-line open-pencil/no-broad-double-cast -- Focused protocol mock avoids initializing CanvasKit in this unit test.
    const renderer = {
      ck: {
        BlendMode: {
          SrcOver: 'src-over',
          Screen: 'screen',
          Multiply: 'multiply',
          Overlay: 'overlay'
        },
        ClipOp: { Intersect: 'intersect' },
        Color4f: mock((...values: number[]) => values),
        XYWHRect: mock((...values: number[]) => values)
      },
      generatedEffectPaint: paint
    } as unknown as SkiaRenderer
    // oxlint-disable-next-line open-pencil/no-broad-double-cast -- Focused protocol mock avoids initializing CanvasKit in this unit test.
    const canvas = {
      save: mock(() => undefined),
      restore: mock(() => undefined),
      clipRect: mock(() => undefined),
      drawCircle: mock(() => undefined),
      drawRect: mock(() => undefined),
      rotate: mock(() => undefined)
    } as unknown as Canvas

    drawGeneratedEffect(renderer, canvas, node, {
      generatedEffectTimeMs: 500,
      generatedEffectMode: 'allow'
    })

    expect(canvas.clipRect).toHaveBeenCalledWith([0, 0, 120, 80], 'intersect', true)
    expect(mockCalls(canvas.drawCircle)).toHaveLength(10)
    expect(mockCalls(paint.setBlendMode)).toEqual([['screen'], ['src-over']])
    expect(canvas.save).toHaveBeenCalledTimes(1)
    expect(canvas.restore).toHaveBeenCalledTimes(1)
  })

  test('draws nothing for disabled or malformed layers', () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const node = graph.createNode('RECTANGLE', page.id, {
      width: 100,
      height: 100,
      generatedEffect: generatedEffect('noise')
    })
    // oxlint-disable-next-line open-pencil/no-broad-double-cast -- Focused protocol mock avoids initializing CanvasKit in this unit test.
    const renderer = {
      ck: { BlendMode: { SrcOver: 0, Screen: 1, Multiply: 2, Overlay: 3 } },
      generatedEffectPaint: {
        setColor: mock(() => undefined),
        setBlendMode: mock(() => undefined)
      }
    } as unknown as SkiaRenderer
    // oxlint-disable-next-line open-pencil/no-broad-double-cast -- Focused protocol mock avoids initializing CanvasKit in this unit test.
    const canvas = {
      save: mock(() => undefined),
      restore: mock(() => undefined),
      clipRect: mock(() => undefined),
      drawCircle: mock(() => undefined),
      drawRect: mock(() => undefined)
    } as unknown as Canvas

    drawGeneratedEffect(renderer, canvas, node, { generatedEffectMode: 'disable' })
    expect(canvas.save).not.toHaveBeenCalled()
    Reflect.set(node, 'generatedEffect', {
      ...generatedEffect(),
      version: 99
    })
    drawGeneratedEffect(renderer, canvas, node, { generatedEffectTimeMs: 100 })
    expect(canvas.save).not.toHaveBeenCalled()
  })

  test('headless fixed-frame output is deterministic and reduced motion is static', async () => {
    const graph = new SceneGraph()
    const page = expectDefined(graph.getPages()[0], 'default page')
    const spec = generatedEffect('noise')
    spec.blendMode = 'normal'
    spec.opacity = 1
    spec.params.tint = { r: 1, g: 0, b: 0, a: 1 }
    const node = graph.createNode('RECTANGLE', page.id, {
      width: 64,
      height: 64,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.05, g: 0.05, b: 0.05, a: 1 },
          opacity: 1,
          visible: true,
          blendMode: 'NORMAL'
        }
      ],
      generatedEffect: spec
    })
    const renderAt = (timeMs: number, mode: 'allow' | 'reduce') =>
      headlessRenderNodes(graph, page.id, [node.id], {
        generatedEffectTimeMs: timeMs,
        generatedEffectMode: mode
      })

    const first = await renderAt(200, 'allow')
    const repeated = await renderAt(200, 'allow')
    const next = await renderAt(500, 'allow')
    const reducedA = await renderAt(0, 'reduce')
    const reducedB = await renderAt(8_000, 'reduce')
    expect(first).not.toBeNull()
    expect(first).toEqual(repeated)
    expect(next).not.toEqual(first)
    expect(reducedA).toEqual(reducedB)
  })
})
