import { describe, expect, test } from 'bun:test'

import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import {
  createUserMotionPreset,
  createUserMotionPresetLibrary,
  instantiateUserMotionPreset,
  type MotionSpec
} from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function motion(...tracks: MotionSpec['tracks']): MotionSpec {
  return { version: 1, tracks }
}

describe('compiler IR — canonical motion', () => {
  test('personal preset snapshots lower to the same provenance-free canonical IR', () => {
    const direct = {
      version: 1,
      reducedMotion: 'allow',
      tracks: [
        {
          id: 'enter',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0, y: 12 },
            { offset: 1, opacity: 1, y: 0 }
          ],
          timing: { durationMs: 320, delayMs: 40, easing: 'ease-out' },
          exit: 'none'
        },
        {
          id: 'hover',
          trigger: 'hover',
          keyframes: [
            { offset: 0, scaleX: 1, scaleY: 1 },
            { offset: 1, scaleX: 1.04, scaleY: 1.04 }
          ],
          timing: { durationMs: 160, easing: 'ease-in-out' },
          exit: 'reverse'
        }
      ]
    } satisfies MotionSpec
    let library = createUserMotionPresetLibrary()
    library = createUserMotionPreset(library, {
      id: 'user-ir-parity',
      name: '编译 IR 等价',
      category: 'custom',
      motion: direct
    })
    const saved = library.presets[0]
    if (!saved) throw new Error('Expected personal motion preset')
    const appliedSnapshot = instantiateUserMotionPreset(saved)
    expect(appliedSnapshot.preset).toEqual({
      id: saved.id,
      version: saved.revision,
      parameters: {}
    })

    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { name: 'Direct', motion: direct })
    graph.createNode('BUTTON', pageId, { name: 'Personal preset', motion: appliedSnapshot })

    const ir = collectTree(graph, pageId)
    const directMotion = (ir.children[0] as IRElement).motion
    const snapshotMotion = (ir.children[1] as IRElement).motion
    expect(snapshotMotion).toEqual(directMotion)
    expect(snapshotMotion).not.toHaveProperty('preset')
    expect(ir.warnings).toEqual([])
  })

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

  test('lowers v3 structured resources into framework-neutral IR without dropping targets', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      fills: [
        { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
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
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.4 },
          offset: { x: 1, y: 2 },
          radius: 3,
          spread: 0,
          visible: true
        }
      ],
      motion: {
        version: 3,
        tracks: [
          {
            id: 'structured',
            trigger: 'mount',
            keyframes: [0, 1].map((offset) => ({
              offset,
              paints: [
                {
                  kind: 'fill' as const,
                  index: 0,
                  color: { r: 1 - offset, g: 0, b: offset, a: 1 },
                  opacity: 1 - offset * 0.25
                },
                {
                  kind: 'stroke' as const,
                  index: 0,
                  color: { r: 0, g: offset, b: 0, a: 1 },
                  opacity: 1
                }
              ],
              gradientStops: [
                {
                  kind: 'fill' as const,
                  paintIndex: 1,
                  stopIndex: 0,
                  position: offset * 0.25,
                  color: { r: offset, g: 1, b: 0, a: 1 }
                }
              ],
              effects: [
                {
                  kind: 'shadow' as const,
                  index: 0,
                  x: 1 + offset * 9,
                  y: 2 + offset * 10,
                  blur: 3 + offset * 11,
                  spread: offset * 4,
                  color: { r: offset, g: 0, b: 1, a: 0.5 }
                }
              ],
              cornerRadii: {
                topLeft: 1 + offset,
                topRight: 2 + offset,
                bottomRight: 3 + offset,
                bottomLeft: 4 + offset
              }
            })),
            timing: { durationMs: 1_000, easing: 'linear' }
          }
        ]
      }
    })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(ir.warnings).toEqual([])
    expect(element.motion?.version).toBe(3)
    expect(element.motion?.target).toMatchObject({
      kind: 'box',
      fills: [{ type: 'SOLID' }, { type: 'GRADIENT_LINEAR' }],
      strokes: [{ weight: 2 }],
      effects: [{ type: 'DROP_SHADOW' }],
      cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 }
    })
    expect(element.motion?.tracks[0].keyframes[1]).toMatchObject({
      paints: [
        { kind: 'fill', index: 0, color: { r: 0, g: 0, b: 1, a: 1 }, opacity: 0.75 },
        { kind: 'stroke', index: 0, color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1 }
      ],
      gradientStops: [{ paintIndex: 1, stopIndex: 0, position: 0.25 }],
      effects: [{ kind: 'shadow', index: 0, x: 10, y: 12, blur: 14, spread: 4 }],
      cornerRadii: { topLeft: 2, topRight: 3, bottomRight: 4, bottomLeft: 5 }
    })
  })
})
