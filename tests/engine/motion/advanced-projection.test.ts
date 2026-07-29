import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  inspectMotionAdvancedChannels,
  motionVectorTopologyId,
  projectMotionAdvancedChannels,
  type MotionVisualState
} from '#core/motion'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

function visual(overrides: Partial<MotionVisualState>): MotionVisualState {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, ...overrides }
}

describe('MotionSpec v3 advanced node projection', () => {
  test('projects indexed paints, gradient stops, effects, and corners without mutation', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        },
        {
          type: 'GRADIENT_LINEAR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          opacity: 1,
          visible: true,
          gradientStops: [
            { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
            { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
          ],
          gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
        }
      ],
      strokes: [
        {
          color: { r: 0, g: 0, b: 0, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'CENTER'
        }
      ],
      effects: [
        {
          type: 'LAYER_BLUR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          radius: 2,
          spread: 0,
          visible: true
        },
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 1, y: 2 },
          radius: 3,
          spread: 0,
          visible: true
        }
      ]
    })
    const result = projectMotionAdvancedChannels(
      node,
      visual({
        paints: [
          { kind: 'fill', index: 0, color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 0.5 },
          { kind: 'stroke', index: 0, color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 0.75 }
        ],
        gradientStops: [
          {
            kind: 'fill',
            paintIndex: 1,
            stopIndex: 0,
            position: 0.25,
            color: { r: 1, g: 1, b: 0, a: 0.8 }
          }
        ],
        effects: [
          { kind: 'blur', index: 0, radius: 8 },
          {
            kind: 'shadow',
            index: 1,
            x: 10,
            y: 12,
            blur: 14,
            spread: 4,
            color: { r: 1, g: 0, b: 1, a: 0.6 }
          }
        ],
        cornerRadii: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 }
      })
    )

    expect(result.issues).toEqual([])
    expect(result.applied).toBe(true)
    expect(result.node.fills[0]).toMatchObject({
      color: { r: 0, g: 0, b: 1, a: 1 },
      opacity: 0.5
    })
    expect(result.node.fills[1].gradientStops?.[0]).toEqual({
      position: 0.25,
      color: { r: 1, g: 1, b: 0, a: 0.8 }
    })
    expect(result.node.strokes[0]).toMatchObject({
      color: { r: 0, g: 1, b: 0, a: 1 },
      opacity: 0.75
    })
    expect(result.node.effects[0].radius).toBe(8)
    expect(result.node.effects[1]).toMatchObject({
      offset: { x: 10, y: 12 },
      radius: 14,
      spread: 4,
      color: { r: 1, g: 0, b: 1, a: 0.6 }
    })
    expect(result.node).toMatchObject({
      independentCorners: true,
      cornerRadius: 0,
      topLeftRadius: 1,
      topRightRadius: 2,
      bottomRightRadius: 3,
      bottomLeftRadius: 4
    })
    expect(node.fills[0].color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(node.effects[0].radius).toBe(2)
  })

  test('projects text reveal and variable font axes', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      text: 'A😀BC',
      fontVariations: [
        { axis: 'wght', value: 400 },
        { axis: 'opsz', value: 14 }
      ],
      styleRuns: [{ start: 1, length: 3, style: { fontWeight: 700 } }],
      textPicture: new Uint8Array([1]),
      figmaDerivedTextGlyphs: [{ commandsBlob: new Uint8Array([1]), x: 0, y: 0, fontSize: 12 }]
    })
    const result = projectMotionAdvancedChannels(
      node,
      visual({
        textReveal: 0.5,
        fontAxes: [
          { tag: 'wght', value: 650 },
          { tag: 'wdth', value: 90 }
        ]
      })
    )

    expect(result.node.text).toBe('A😀')
    expect(result.node.styleRuns).toEqual([{ start: 1, length: 2, style: { fontWeight: 700 } }])
    expect(result.node.fontVariations).toEqual([
      { axis: 'wght', value: 650 },
      { axis: 'opsz', value: 14 },
      { axis: 'wdth', value: 90 }
    ])
    expect(result.node.textPicture).toBeNull()
    expect(result.node.figmaDerivedTextGlyphs).toBeNull()
  })

  test('gates vector morph by the source topology and preserves mask identity', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('VECTOR', pageId(graph), {
      isMask: true,
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 }
        ],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
          { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }
        ],
        regions: []
      }
    })
    const topologyId = motionVectorTopologyId(node)
    expect(topologyId).toMatch(/^vn1-3-2-0-/)
    const result = projectMotionAdvancedChannels(
      node,
      visual({
        vectorMorph: {
          topologyId: topologyId ?? '',
          points: [
            { x: 1, y: 2 },
            { x: 11, y: 3 },
            { x: 12, y: 14 }
          ]
        }
      })
    )

    expect(result.node.isMask).toBe(true)
    expect(result.node.vectorNetwork?.vertices.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 1, y: 2 },
      { x: 11, y: 3 },
      { x: 12, y: 14 }
    ])
    expect(node.vectorNetwork?.vertices[0]).toMatchObject({ x: 0, y: 0 })

    const invalid = visual({
      vectorMorph: { topologyId: 'vn1-wrong', points: [{ x: 1, y: 2 }] }
    })
    expect(inspectMotionAdvancedChannels(node, invalid).map((entry) => entry.code)).toEqual([
      'vector-topology-mismatch'
    ])
    expect(projectMotionAdvancedChannels(node, invalid)).toMatchObject({
      node,
      applied: false
    })
  })
})
