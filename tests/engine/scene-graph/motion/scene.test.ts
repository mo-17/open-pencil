import { describe, expect, test } from 'bun:test'

import {
  cloneMotionSceneSpec,
  parseMotionSceneSpec,
  remapMotionSceneNodeIds,
  SceneGraph,
  validateMotionSceneSpec,
  type MotionSceneSpec
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

function scene(): MotionSceneSpec {
  return {
    version: 1,
    id: 'landingScene',
    sequences: [
      {
        id: 'intro',
        name: '页面入场',
        trigger: 'pageEnter',
        cues: [
          {
            id: 'heroCue',
            targetNodeId: '0:10',
            trackId: 'entrance',
            startMs: 0
          },
          {
            id: 'copyCue',
            targetNodeId: '0:11',
            trackId: 'fade',
            startMs: 160,
            timeScale: 0.8,
            enabled: true
          }
        ],
        markers: [
          { id: 'start', timeMs: 0, label: '开始' },
          { id: 'content', timeMs: 160, label: '正文' }
        ]
      },
      {
        id: 'outro',
        trigger: 'pageExit',
        cues: [{ id: 'exitCue', targetNodeId: '0:10', trackId: 'exit', startMs: 0 }]
      }
    ]
  }
}

describe('MotionSceneSpec', () => {
  test('parses a bounded multi-node choreography without duplicating node keyframes', () => {
    const source = scene()
    expect(parseMotionSceneSpec(source)).toEqual(source)
  })

  test('deep clones mutable sequences, cues, and markers', () => {
    const source = scene()
    const copy = cloneMotionSceneSpec(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.sequences).not.toBe(source.sequences)
    expect(copy.sequences[0]?.cues).not.toBe(source.sequences[0]?.cues)
    expect(copy.sequences[0]?.markers).not.toBe(source.sequences[0]?.markers)
  })

  test('remaps only node references and preserves stable scene identities', () => {
    const source = scene()
    const remapped = remapMotionSceneNodeIds(source, new Map([['0:10', '9:100']]))
    expect(remapped.sequences[0]?.cues[0]?.targetNodeId).toBe('9:100')
    expect(remapped.sequences[0]?.cues[1]?.targetNodeId).toBe('0:11')
    expect(remapped.id).toBe(source.id)
    expect(remapped.sequences.map(({ id }) => id)).toEqual(['intro', 'outro'])
  })

  test('deep-clone remaps choreography targets included in the cloned subtree', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const frame = graph.createNode('FRAME', page.id, { name: 'Scene' })
    const child = graph.createNode('RECTANGLE', frame.id, { name: 'Hero' })
    const motionScene = scene()
    const intro = expectDefined(motionScene.sequences[0], 'intro sequence')
    expectDefined(intro.cues[0], 'intro cue').targetNodeId = child.id
    graph.updateNode(frame.id, { motionScene })

    const clone = graph.cloneTree(frame.id, page.id)
    if (!clone) throw new Error('Expected cloned scene')
    const clonedChild = graph.getNode(clone.childIds[0] ?? '')
    expect(clonedChild).toBeDefined()
    expect(clone.motionScene).not.toBe(frame.motionScene)
    expect(clone.motionScene?.sequences[0]?.cues[0]?.targetNodeId).toBe(clonedChild?.id)
    expect(frame.motionScene?.sequences[0]?.cues[0]?.targetNodeId).toBe(child.id)
  })

  test('rejects future versions, unsafe fields, duplicate ids, and unordered markers', () => {
    const source = scene()
    const intro = source.sequences[0]
    if (!intro) throw new Error('Expected intro sequence')
    const candidates: unknown[] = [
      { ...source, version: 2 },
      { ...source, script: 'alert(1)' },
      { ...source, id: '__proto__' },
      { ...source, sequences: [intro, { ...intro }] },
      {
        ...source,
        sequences: [
          {
            ...intro,
            cues: [intro.cues[0], { ...intro.cues[0] }]
          }
        ]
      },
      {
        ...source,
        sequences: [
          {
            ...intro,
            markers: [
              { id: 'later', timeMs: 100, label: 'Later' },
              { id: 'earlier', timeMs: 10, label: 'Earlier' }
            ]
          }
        ]
      }
    ]
    for (const candidate of candidates) {
      expect(validateMotionSceneSpec(candidate).success).toBe(false)
    }
  })

  test('enforces scene resource limits', () => {
    const source = scene()
    expect(
      validateMotionSceneSpec({
        ...source,
        sequences: Array.from({ length: 17 }, (_, index) => ({
          id: `sequence${index}`,
          trigger: 'manual',
          cues: []
        }))
      }).success
    ).toBe(false)
  })
})
