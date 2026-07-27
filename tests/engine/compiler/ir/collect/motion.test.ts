import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import type { MotionSpec } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function motion(...tracks: MotionSpec['tracks']): MotionSpec {
  return { version: 1, tracks }
}

describe('compiler IR — canonical motion', () => {
  test('lowers canonical MotionSpec, normalizes channels/timing, and multiplies node opacity', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      opacity: 0.5,
      motion: motion({
        id: 'enter',
        trigger: 'mount',
        keyframes: [{ offset: 0, opacity: 0.2, x: -12 }, { offset: 1 }],
        timing: { durationMs: 240 }
      })
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.motion).toEqual({
      version: 1,
      reducedMotion: 'reduce',
      tracks: [
        {
          id: 'enter',
          trigger: 'mount',
          exit: 'reset',
          keyframes: [
            { offset: 0, opacity: 0.1, x: -12, y: 0 },
            { offset: 1, opacity: 0.5, x: 0, y: 0 }
          ],
          timing: {
            durationMs: 240,
            delayMs: 0,
            easing: 'ease',
            iterations: 1,
            direction: 'normal',
            fill: 'both'
          }
        }
      ]
    })
    expect(ir.warnings).toEqual([])
  })

  test('future/invalid motion warns and degrades to a static node without throwing', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const node = graph.createNode('RECTANGLE', pageId)
    Reflect.set(node, 'motion', { version: 2, tracks: [] })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.motion).toBeUndefined()
    expect(ir.warnings.some((warning) => warning.code === 'motion-invalid')).toBe(true)
  })

  test('warns for channel conflicts and static opacity-token lowering', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      boundVariables: { opacity: 'opacity-token' },
      motion: motion(
        {
          id: 'fade-a',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 100 }
        },
        {
          id: 'fade-b',
          trigger: 'loop',
          keyframes: [
            { offset: 0, opacity: 1 },
            { offset: 1, opacity: 0.5 }
          ],
          timing: { durationMs: 200 }
        }
      )
    })

    const warnings = collectTree(graph, pageId).warnings
    const conflict = warnings.find((warning) => warning.code === 'motion-channel-conflict')
    expect(conflict?.message).toContain('fade-a, fade-b')
    expect(conflict?.message).toContain('later track wins')
    expect(warnings.some((warning) => warning.code === 'motion-opacity-binding-static')).toBe(true)
  })
})
