import { describe, expect, test } from 'bun:test'

import { SceneGraph, TransformMatrix, type MotionCubicPath } from '@open-pencil/scene-graph'

import {
  motionPathCoordinateTransform,
  motionPathMarkerPoint,
  pathPointToScreen,
  screenPointToPath
} from '@/app/motion-path/geometry'

describe('Motion path canvas coordinates', () => {
  test('round-trips nested rotation, reflected scale, and viewport scale', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const outer = graph.createNode('FRAME', page.id, {
      x: 80,
      y: 50,
      width: 500,
      height: 320,
      rotation: 24,
      flipX: true
    })
    const inner = graph.createNode('FRAME', outer.id, {
      x: 45,
      y: 35,
      width: 260,
      height: 180,
      rotation: -13
    })
    const node = graph.createNode('RECTANGLE', inner.id, {
      x: 30,
      y: 22,
      width: 80,
      height: 60,
      rotation: 37
    })
    const transform = motionPathCoordinateTransform(graph, node, {
      panX: 91,
      panY: -17,
      zoom: 2.5
    })
    if (!transform) throw new Error('Expected invertible path transform')

    const point = { x: 123.5, y: -47.25 }
    const screen = pathPointToScreen(transform, point)
    const roundTrip = screenPointToPath(transform, screen)
    expect(roundTrip.x).toBeCloseTo(point.x, 10)
    expect(roundTrip.y).toBeCloseTo(point.y, 10)

    const viewScale = TransformMatrix.scaled(0.5, 3)
    const scaled = TransformMatrix.mapPoint(viewScale, screen)
    expect(scaled).toEqual({ x: screen.x * 0.5, y: screen.y * 3 })
  })

  test('places the selected-keyframe marker with the canonical constant-speed sampler', () => {
    const path: MotionCubicPath = {
      version: 2,
      start: { x: 0, y: 0 },
      segments: [
        {
          control1: { x: 100, y: 0 },
          control2: { x: 0, y: 100 },
          end: { x: 100, y: 100 }
        },
        {
          control1: { x: 200, y: 100 },
          control2: { x: 100, y: 200 },
          end: { x: 200, y: 200 }
        }
      ]
    }
    const marker = motionPathMarkerPoint(path, { offset: 0.9, pathProgress: 0.5 })
    expect(marker.x).toBeCloseTo(100, 8)
    expect(marker.y).toBeCloseTo(100, 8)
  })
})
