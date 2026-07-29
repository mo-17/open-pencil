import { describe, expect, test } from 'bun:test'

import { motionVectorTopologyId } from '@open-pencil/core/motion'
import {
  SceneGraph,
  type MotionPaintTarget,
  type MotionSpec,
  validateMotionSpec
} from '@open-pencil/scene-graph'

import {
  addMotionStructuredTarget,
  motionStructuredCapability,
  removeMotionStructuredTarget,
  setMotionStructuredChannelEnabled,
  updateMotionStructuredChannel,
  updateMotionStructuredScalar,
  upgradeMotionSpecToV3
} from '@/app/properties/motion/v3-structured'

function baseSpec(): MotionSpec {
  return {
    version: 2,
    tracks: [
      {
        id: 'author',
        trigger: 'mount',
        keyframes: [{ offset: 0 }, { offset: 1 }],
        timing: { durationMs: 400, easing: 'linear' }
      }
    ]
  }
}

describe('MotionSpec v3 structured authoring', () => {
  test('requires an explicit v3 upgrade and edits indexed topology immutably', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
        { type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 0.5, visible: true }
      ]
    })
    const v2 = baseSpec()
    expect(() => setMotionStructuredChannelEnabled(v2, node, 'author', 'paints', true)).toThrow(
      /explicit MotionSpec v3 upgrade/
    )

    const v3 = upgradeMotionSpecToV3(v2)
    const enabled = setMotionStructuredChannelEnabled(v3, node, 'author', 'paints', true)
    const edited = updateMotionStructuredChannel(enabled, node, 'author', 1, 'paints', (value) => {
      const paint = (value as MotionPaintTarget[])[0]
      if (!paint.color) throw new Error('expected color target')
      paint.color.g = 0.75
    })
    const added = addMotionStructuredTarget(edited, node, 'author', 'paints')
    const removed = removeMotionStructuredTarget(added, node, 'author', 'paints', 0)

    expect(v2.version).toBe(2)
    expect(v3.version).toBe(3)
    expect(enabled.tracks[0].keyframes[1].paints?.[0]?.color?.g).toBe(0)
    expect(edited.tracks[0].keyframes[1].paints?.[0]?.color?.g).toBe(0.75)
    expect(added.tracks[0].keyframes.every((frame) => frame.paints?.length === 2)).toBe(true)
    expect(removed.tracks[0].keyframes.every((frame) => frame.paints?.length === 1)).toBe(true)
    expect(validateMotionSpec(removed).success).toBe(true)
  })

  test('reports node capability reasons and authors scalar/text/vector targets', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const text = graph.createNode('TEXT', pageId, {
      text: 'A😀BC',
      fontVariations: [{ axis: 'wght', value: 400 }]
    })
    let textSpec = upgradeMotionSpecToV3(baseSpec())
    textSpec = setMotionStructuredChannelEnabled(textSpec, text, 'author', 'textReveal', true)
    textSpec = updateMotionStructuredScalar(textSpec, text, 'author', 0, 'textReveal', 0.25)
    textSpec = setMotionStructuredChannelEnabled(textSpec, text, 'author', 'fontAxes', true)
    expect(textSpec.tracks[0].keyframes[0]).toMatchObject({
      textReveal: 0.25,
      fontAxes: [{ tag: 'wght', value: 400 }]
    })
    expect(motionStructuredCapability(text, 'vectorMorph')).toMatchObject({ supported: false })

    const vector = graph.createNode('VECTOR', pageId, {
      vectorNetwork: {
        vertices: [
          { x: 0, y: 0 },
          { x: 20, y: 0 }
        ],
        segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }],
        regions: []
      }
    })
    let vectorSpec = upgradeMotionSpecToV3(baseSpec())
    vectorSpec = setMotionStructuredChannelEnabled(
      vectorSpec,
      vector,
      'author',
      'vectorMorph',
      true
    )
    expect(vectorSpec.tracks[0].keyframes[0].vectorMorph?.topologyId).toBe(
      motionVectorTopologyId(vector)
    )
  })
})
