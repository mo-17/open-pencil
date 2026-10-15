import { describe, expect, mock, test } from 'bun:test'

import { SceneGraph, createDefaultNode } from '@open-pencil/scene-graph'
import type { Fill } from '@open-pencil/scene-graph'

import { applyFill } from '#core/canvas/fills'

import { canvasMock } from '#tests/engine/render/canvas/effects/helpers'

import { asRenderer } from './helpers'

function createRenderer() {
  // A real CanvasKit shader is a WASM handle the caller deletes once the paint holds it.
  const patternShader = { id: 'pattern-shader', delete: mock(() => undefined) }
  const picture = {
    makeShader: mock(() => patternShader),
    delete: mock(() => undefined)
  }
  const recorder = {
    beginRecording: mock(() => ({
      drawRect: canvasMock('drawRect'),
      drawRRect: canvasMock('drawRRect'),
      restore: canvasMock('restore'),
      save: canvasMock('save'),
      scale: canvasMock('scale'),
      translate: canvasMock('translate')
    })),
    finishRecordingAsPicture: mock(() => picture),
    delete: mock(() => undefined)
  }

  return asRenderer({
    fillPaint: {
      setShader: mock(() => undefined),
      setColor: mock(() => undefined),
      setAlphaf: mock(() => undefined),
      setBlendMode: mock(() => undefined)
    },
    ck: {
      BlendMode: { SrcOver: 'source-over' },
      Color4f: mock((r, g, b, a) => ['color', r, g, b, a]),
      FilterMode: { Linear: 'linear' },
      LTRBRect: mock((left, top, right, bottom) => [left, top, right, bottom]),
      PictureRecorder: mock(() => recorder),
      TileMode: { Repeat: 'repeat' }
    },
    resolveFillColor: mock((fill: Fill) => fill.color),
    makeRRect: mock(() => 'rrect'),
    testShader: patternShader
  })
}

const node = createDefaultNode(() => '1:2', 'RECTANGLE', { width: 100, height: 100 })

describe('schema fill fallback rendering', () => {
  test('renders pattern fills from referenced source nodes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const source = graph.createNode('RECTANGLE', page.id, {
      width: 10,
      height: 10,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    source.source.id = '12:34'
    const renderer = createRenderer()
    const fill: Fill = {
      type: 'PATTERN',
      sourceNodeId: '12:34',
      patternSpacing: { x: 0.25, y: 0.4 },
      color: { r: 0.2, g: 0.3, b: 0.4, a: 0.8 },
      opacity: 1,
      visible: true
    }

    expect(applyFill(renderer, fill, node, graph)).toBe(true)
    expect(renderer.fillPaint.setShader).toHaveBeenLastCalledWith(renderer.testShader)
    expect(renderer.testShader.delete).toHaveBeenCalledTimes(1)
    expect(renderer.fillPaint.setColor).not.toHaveBeenCalledWith(['color', 0.2, 0.3, 0.4, 0.8])
  })

  test.each(['PATTERN', 'NOISE', 'CUSTOM'] as const)(
    'renders %s fills as solid fallback',
    (type) => {
      const renderer = createRenderer()
      const fill: Fill = {
        type,
        color: { r: 0.2, g: 0.3, b: 0.4, a: 0.8 },
        opacity: 1,
        visible: true
      }

      expect(applyFill(renderer, fill, node, new SceneGraph())).toBe(true)
      expect(renderer.fillPaint.setColor).toHaveBeenCalledWith(['color', 0.2, 0.3, 0.4, 0.8])
    }
  )
})
