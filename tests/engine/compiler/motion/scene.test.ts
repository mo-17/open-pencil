import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { MotionSceneSpec, MotionSpec, MotionTrack } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function motion(track: MotionTrack): MotionSpec {
  return { version: 1, reducedMotion: 'reduce', tracks: [track] }
}

function opacityTrack(id = 'fade'): MotionTrack {
  return {
    id,
    trigger: 'click',
    keyframes: [
      { offset: 0, opacity: 0 },
      { offset: 1, opacity: 1 }
    ],
    timing: { durationMs: 400, delayMs: 40, easing: 'linear', fill: 'both' },
    exit: 'reset'
  }
}

function scene(
  cues: MotionSceneSpec['sequences'][number]['cues'],
  trigger: MotionSceneSpec['sequences'][number]['trigger'] = 'manual'
): MotionSceneSpec {
  return {
    version: 1,
    id: 'page-scene',
    sequences: [{ id: 'sequence', trigger, cues }]
  }
}

describe('compiler — Motion scene IR and emission', () => {
  test('uses the core planner for timing and emits a page-scoped runtime registry', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: motion(opacityTrack()) })
    graph.updateNode(pageId, {
      motionScene: scene([
        {
          id: 'cue',
          targetNodeId: target.id,
          trackId: 'fade',
          startMs: 100,
          timeScale: 2
        }
      ])
    })

    const ir = collectTree(graph, pageId)
    expect(ir.motionScene).toEqual({
      id: 'page-scene',
      sequences: [
        {
          id: 'sequence',
          trigger: 'manual',
          cues: [
            {
              id: 'cue',
              targetNodeId: target.id,
              trackId: 'fade',
              startMs: 100,
              timeScale: 2
            }
          ],
          durationMs: 320
        }
      ]
    })
    expect(ir.warnings).toEqual([])

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'motion-scene', devMode: false })
    })
    const app = output.files.get('src/App.tsx') as string
    const runtime = output.files.get('src/__motion-runtime.ts') as string
    expect(app).toContain(`data-op-motion-scene-owner="${pageId}"`)
    expect(runtime).toContain('__OPENPENCIL_MOTION_SCENE_RUNTIME__')
    expect(runtime).toContain(`"targetNodeId":"${target.id}"`)
    expect(runtime).toContain('duration: sourceTrack.timing.duration / timeScale')
  })

  test('collects FRAME-owned choreography and keeps its descendant DOM boundary addressable', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const owner = graph.createNode('FRAME', pageId, { name: 'Scene owner' })
    const target = graph.createNode('RECTANGLE', owner.id, { motion: motion(opacityTrack()) })
    const sibling = graph.createNode('RECTANGLE', pageId, { motion: motion(opacityTrack()) })
    graph.updateNode(owner.id, {
      motionScene: scene([
        {
          id: 'frame-cue',
          targetNodeId: target.id,
          trackId: 'fade',
          startMs: 25
        },
        {
          id: 'sibling-cue',
          targetNodeId: sibling.id,
          trackId: 'fade',
          startMs: 0
        }
      ])
    })

    const ir = collectTree(graph, pageId)
    const frame = ir.children.find((node) => node.kind === 'element' && node.sourceId === owner.id)
    expect(frame?.kind === 'element' ? frame.motionScene : undefined).toMatchObject({
      id: 'page-scene',
      sequences: [{ id: 'sequence', cues: [{ id: 'frame-cue' }] }]
    })
    expect(ir.warnings.some((warning) => warning.code === 'motion-scene-target-missing')).toBe(true)

    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'frame-motion-scene', devMode: false })
    })
    const app = output.files.get('src/App.tsx') as string
    const runtime = output.files.get('src/__motion-runtime.ts') as string
    expect(app).toContain(`data-op-motion-scene-owner="${owner.id}"`)
    expect(app).toContain(`data-node-id="${target.id}"`)
    expect(runtime).toContain(`"${owner.id}":{"id":"page-scene"`)
  })

  test('omits invalid references cue-by-cue and keeps valid siblings executable', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const target = graph.createNode('RECTANGLE', pageId, { motion: motion(opacityTrack()) })
    const otherPage = graph.addPage('Other')
    const outside = graph.createNode('RECTANGLE', otherPage.id, { motion: motion(opacityTrack()) })
    graph.updateNode(pageId, {
      motionScene: scene([
        {
          id: 'valid',
          targetNodeId: target.id,
          trackId: 'fade',
          startMs: 0
        },
        {
          id: 'duplicate',
          targetNodeId: target.id,
          trackId: 'fade',
          startMs: 20
        },
        {
          id: 'missing-track',
          targetNodeId: target.id,
          trackId: 'stale',
          startMs: 40
        },
        {
          id: 'outside',
          targetNodeId: outside.id,
          trackId: 'fade',
          startMs: 60
        }
      ])
    })

    const ir = collectTree(graph, pageId)
    expect(ir.motionScene?.sequences[0]?.cues.map((cue) => cue.id)).toEqual(['valid'])
    expect(ir.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'motion-scene-duplicate-cue-target',
        'motion-scene-track-missing',
        'motion-scene-target-missing'
      ])
    )
  })

  test('invalid scene envelopes degrade to static output without emitting a controller', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const page = graph.getNode(pageId)
    if (!page) throw new Error('missing page')
    Reflect.set(page, 'motionScene', { version: 2, id: 'future', sequences: [] })

    const ir = collectTree(graph, pageId)
    expect(ir.motionScene).toBeUndefined()
    expect(ir.warnings.some((warning) => warning.code === 'motion-scene-invalid')).toBe(true)
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ devMode: false })
    })
    expect(output.files.has('src/__motion-runtime.ts')).toBe(false)
  })
})
