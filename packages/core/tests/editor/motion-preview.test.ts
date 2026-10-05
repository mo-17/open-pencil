import { describe, expect, test } from 'bun:test'

import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'

function motion(overrides: Partial<MotionSpec> = {}): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'enter',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0, opacity: 0 },
          { offset: 1, x: 100, opacity: 1 }
        ],
        timing: { durationMs: 100, easing: 'linear' }
      }
    ],
    ...overrides
  }
}

function createMotionNode(editor: ReturnType<typeof createEditor>, spec = motion()) {
  return editor.graph.createNode('RECTANGLE', editor.graph.getPages()[0].id, {
    name: 'Animated card',
    x: 10,
    y: 20,
    width: 100,
    height: 60,
    opacity: 0.8,
    motion: spec
  })
}

describe('editor motion preview', () => {
  test('samples ephemeral visual state without mutating the graph or scene version', () => {
    const editor = createEditor()
    const node = createMotionNode(editor)
    const authored = structuredClone(editor.graph.getNode(node.id))
    const initialSceneVersion = editor.state.sceneVersion
    let committedUpdates = 0
    editor.onEditorEvent('node:updated', () => committedUpdates++)

    expect(editor.previewMotion([node.id])).toBe(true)
    expect(editor.isMotionPreviewActive()).toBe(true)
    expect(editor.state.motionPreview?.visuals.get(node.id)?.opacity).toBe(0)

    expect(editor.updateMotionPreviewFrame(1_000)).toBe(true)
    expect(editor.updateMotionPreviewFrame(1_050)).toBe(true)
    expect(editor.state.motionPreview?.visuals.get(node.id)).toMatchObject({
      x: 50,
      opacity: 0.5
    })

    expect(editor.graph.getNode(node.id)).toEqual(authored)
    expect(editor.state.sceneVersion).toBe(initialSceneVersion)
    expect(committedUpdates).toBe(0)
  })

  test('reports a finite final frame and clears only when explicitly stopped', () => {
    const editor = createEditor()
    const node = createMotionNode(editor)

    editor.previewMotion([node.id])
    editor.updateMotionPreviewFrame(500)
    expect(editor.updateMotionPreviewFrame(600)).toBe(false)
    expect(editor.state.motionPreview?.finished).toBe(true)
    expect(editor.state.motionPreview?.visuals.get(node.id)?.x).toBe(100)
    expect(editor.isMotionPreviewActive()).toBe(true)

    editor.stopMotionPreview()
    expect(editor.isMotionPreviewActive()).toBe(false)
    expect(editor.state.motionPreview).toBeNull()
  })

  test('does not let a replaced preview owner stop the active preview', () => {
    const editor = createEditor()
    const first = createMotionNode(editor)
    const second = createMotionNode(editor)

    expect(editor.previewMotion([first.id])).toBe(true)
    const firstPreviewId = editor.state.motionPreview?.id
    expect(firstPreviewId).toBeNumber()

    expect(editor.seekMotionPreview([second.id], 'mount', 40)).toBe(true)
    const secondPreviewId = editor.state.motionPreview?.id
    expect(secondPreviewId).toBeNumber()
    expect(secondPreviewId).not.toBe(firstPreviewId)

    expect(editor.stopMotionPreview(firstPreviewId)).toBe(false)
    expect(editor.state.motionPreview?.id).toBe(secondPreviewId)
    expect(editor.state.motionPreview?.targets.map(({ nodeId }) => nodeId)).toEqual([second.id])

    expect(editor.stopMotionPreview(secondPreviewId)).toBe(true)
    expect(editor.state.motionPreview).toBeNull()
  })

  test('seeks to a static timeline position without advancing the playback clock', () => {
    const editor = createEditor()
    const node = createMotionNode(editor, {
      version: 1,
      tracks: [
        {
          id: 'move',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: {
            durationMs: 100,
            delayMs: 50,
            easing: 'linear',
            iterations: 2,
            direction: 'alternate',
            fill: 'both'
          }
        },
        {
          id: 'fade',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 200, easing: 'linear', direction: 'reverse' }
        },
        {
          id: 'ignored-hover',
          trigger: 'hover',
          keyframes: [
            { offset: 0, y: 0 },
            { offset: 1, y: -20 }
          ],
          timing: { durationMs: 100, easing: 'linear' }
        }
      ]
    })

    expect(editor.seekMotionPreview([node.id], 'mount', 125)).toBe(true)
    expect(editor.state.motionPreview).toMatchObject({
      playing: false,
      startedAtMs: null,
      elapsedMs: 125,
      finished: false
    })
    expect(editor.state.motionPreview?.visuals.get(node.id)).toEqual({
      x: 75,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotate: 0,
      opacity: 0.375
    })
    expect(editor.isMotionPreviewActive()).toBe(false)

    const visual = editor.state.motionPreview?.visuals.get(node.id)
    expect(editor.updateMotionPreviewFrame(10_000)).toBe(false)
    expect(editor.state.motionPreview?.visuals.get(node.id)).toEqual(visual)
    expect(editor.hasMotionPreview()).toBe(true)
    expect(editor.hasMotionPreview(node.id, 'move')).toBe(true)
    expect(editor.hasMotionPreview(node.id, 'ignored-hover')).toBe(false)
  })

  test('static authoring seeks can hold the final keyframe without changing default fill behavior', () => {
    const editor = createEditor()
    for (const fill of ['none', 'backwards'] as const) {
      const node = createMotionNode(editor, {
        version: 1,
        tracks: [
          {
            id: `move-${fill}`,
            trigger: 'mount',
            keyframes: [
              { offset: 0, x: 10 },
              { offset: 1, x: 90 }
            ],
            timing: { durationMs: 100, easing: 'linear', fill }
          }
        ]
      })

      expect(editor.seekMotionPreview([node.id], 'mount', 100)).toBe(true)
      expect(editor.state.motionPreview?.visuals.get(node.id)?.x).toBe(0)

      expect(
        editor.seekMotionPreview([node.id], 'mount', 100, {
          trackId: `move-${fill}`,
          holdFinalFrame: true
        })
      ).toBe(true)
      expect(editor.state.motionPreview?.visuals.get(node.id)?.x).toBe(90)
      expect(editor.state.motionPreview?.finished).toBe(true)
    }
  })

  test('previews one selected infinite track as one authoring cycle', () => {
    const editor = createEditor()
    const node = createMotionNode(editor, {
      version: 1,
      tracks: [
        {
          id: 'looping',
          trigger: 'loop',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 100, easing: 'linear', iterations: 'infinite' }
        },
        {
          id: 'other',
          trigger: 'loop',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 200, easing: 'linear', iterations: 'infinite' }
        }
      ]
    })

    expect(
      editor.seekMotionPreview([node.id], 'loop', 100, {
        trackId: 'looping',
        infiniteAsSingleCycle: true
      })
    ).toBe(true)
    expect(editor.state.motionPreview?.targets[0]?.spec.tracks.map((track) => track.id)).toEqual([
      'looping'
    ])
    expect(editor.state.motionPreview?.visuals.get(node.id)?.x).toBe(100)
    expect(editor.state.motionPreview?.finished).toBe(true)
  })

  test('clears stale static previews when their target changes, is deleted, or selection changes', () => {
    const editor = createEditor()
    const target = createMotionNode(editor)
    const unrelated = createMotionNode(editor)

    expect(editor.seekMotionPreview([target.id], 'mount', 50)).toBe(true)
    editor.graph.updateNode(unrelated.id, { opacity: 0.5 })
    expect(editor.hasMotionPreview()).toBe(true)

    editor.graph.updateNode(target.id, { opacity: 0.6 })
    expect(editor.hasMotionPreview()).toBe(false)

    editor.seekMotionPreview([target.id], 'mount', 50)
    editor.select([unrelated.id])
    expect(editor.hasMotionPreview()).toBe(false)

    editor.seekMotionPreview([target.id], 'mount', 50)
    editor.graph.deleteNode(target.id)
    expect(editor.hasMotionPreview()).toBe(false)
  })

  test('clears a static preview when switching pages', async () => {
    const editor = createEditor()
    const target = createMotionNode(editor)
    const otherPage = editor.graph.addPage('Other page')

    editor.seekMotionPreview([target.id], 'mount', 50)
    expect(editor.hasMotionPreview()).toBe(true)
    await editor.switchPage(otherPage.id)
    expect(editor.hasMotionPreview()).toBe(false)
  })

  test('seeks multiple targets with reduced-motion policy and normalizes unsafe elapsed time', () => {
    const editor = createEditor({ prefersReducedMotion: () => true })
    const first = createMotionNode(editor, {
      version: 1,
      reducedMotion: 'reduce',
      tracks: [
        {
          id: 'move',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 1_000, delayMs: 500, easing: 'linear' }
        },
        {
          id: 'fade',
          trigger: 'mount',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 1_000, delayMs: 500, easing: 'linear' }
        }
      ]
    })
    const second = createMotionNode(editor, { ...motion(), reducedMotion: 'allow' })

    expect(editor.seekMotionPreview([first.id, second.id, first.id], 'mount', 60)).toBe(true)
    expect(editor.state.motionPreview?.targets.map((target) => target.nodeId)).toEqual([
      first.id,
      second.id
    ])
    expect(editor.state.motionPreview?.visuals.get(first.id)).toMatchObject({ x: 0, opacity: 0.5 })
    expect(editor.state.motionPreview?.visuals.get(second.id)?.x).toBe(60)

    expect(editor.seekMotionPreview([second.id], 'mount', Number.NaN)).toBe(true)
    expect(editor.state.motionPreview?.elapsedMs).toBe(0)
    expect(editor.state.motionPreview?.visuals.get(second.id)?.x).toBe(0)
  })

  test('filters requested triggers and applies injected reduced-motion preference', () => {
    const editor = createEditor({ prefersReducedMotion: () => true })
    const transformOnly = createMotionNode(editor, {
      version: 1,
      tracks: [
        {
          id: 'hover',
          trigger: 'hover',
          keyframes: [
            { offset: 0, y: 0 },
            { offset: 1, y: -10 }
          ],
          timing: { durationMs: 500 }
        }
      ],
      reducedMotion: 'reduce'
    })

    expect(editor.previewMotion([transformOnly.id], 'mount')).toBe(false)
    expect(editor.previewMotion([transformOnly.id], 'hover')).toBe(false)

    const allowed = createMotionNode(editor, {
      ...motion(),
      reducedMotion: 'allow'
    })
    expect(editor.previewMotion([allowed.id])).toBe(true)
  })

  test('deduplicates targets, skips invalid nodes, and resets on graph replacement', () => {
    const editor = createEditor()
    const node = createMotionNode(editor)

    expect(editor.previewMotion(['missing', node.id, node.id])).toBe(true)
    expect(editor.state.motionPreview?.targets.map((target) => target.nodeId)).toEqual([node.id])

    editor.replaceGraph(new SceneGraph())
    expect(editor.isMotionPreviewActive()).toBe(false)
  })

  test('previews strictly validated caller specs without authoring them on the graph', () => {
    const editor = createEditor()
    const node = editor.graph.createNode('RECTANGLE', editor.graph.getPages()[0].id, {
      name: 'Static target'
    })
    const spec: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'enter',
          trigger: 'mount',
          keyframes: [
            { offset: 0, x: 0 },
            { offset: 1, x: 100 }
          ],
          timing: { durationMs: 100, easing: 'linear' }
        },
        {
          id: 'hover',
          trigger: 'hover',
          keyframes: [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 100, easing: 'linear' }
        }
      ]
    }
    const inputSnapshot = structuredClone(spec)
    const sceneVersion = editor.state.sceneVersion

    expect(editor.previewMotionSpecs([{ nodeId: node.id, spec }])).toBe(true)
    expect(editor.state.motionPreview?.trigger).toBe('all')
    expect(editor.state.motionPreview?.targets[0]?.spec).not.toBe(spec)
    editor.updateMotionPreviewFrame(1_000)
    editor.updateMotionPreviewFrame(1_050)
    expect(editor.state.motionPreview?.visuals.get(node.id)).toMatchObject({ x: 50, opacity: 0.5 })
    expect(editor.graph.getNode(node.id)?.motion).toBeUndefined()
    expect(editor.state.sceneVersion).toBe(sceneVersion)
    expect(spec).toEqual(inputSnapshot)

    expect(
      editor.previewMotionSpecs([{ nodeId: node.id, spec }], {
        selection: { mode: 'trigger', trigger: 'hover' }
      })
    ).toBe(true)
    expect(editor.state.motionPreview?.trigger).toBe('hover')
    expect(editor.state.motionPreview?.targets[0]?.spec.tracks.map((track) => track.id)).toEqual([
      'hover'
    ])
  })

  test('caller-spec preview skips invalid input and can hold one finite view of infinite tracks', () => {
    const editor = createEditor()
    const valid = editor.graph.createNode('RECTANGLE', editor.graph.getPages()[0].id)
    const invalid = editor.graph.createNode('RECTANGLE', editor.graph.getPages()[0].id)
    const loop: MotionSpec = {
      version: 1,
      tracks: [
        {
          id: 'looping',
          trigger: 'loop',
          keyframes: [
            { offset: 0, x: 10 },
            { offset: 1, x: 90 }
          ],
          timing: { durationMs: 100, easing: 'linear', iterations: 'infinite', fill: 'none' }
        }
      ]
    }

    expect(
      editor.previewMotionSpecs(
        [
          { nodeId: invalid.id, spec: { version: 99, tracks: [] } },
          { nodeId: valid.id, spec: { version: 99, tracks: [] } },
          { nodeId: valid.id, spec: loop },
          { nodeId: 'missing', spec: loop }
        ],
        { infiniteAsSingleCycle: true, holdFinalFrame: true }
      )
    ).toBe(true)
    expect(editor.state.motionPreview?.targets.map((target) => target.nodeId)).toEqual([valid.id])
    editor.updateMotionPreviewFrame(1_000)
    expect(editor.updateMotionPreviewFrame(1_100)).toBe(false)
    expect(editor.state.motionPreview?.visuals.get(valid.id)?.x).toBe(90)
    expect(editor.state.motionPreview?.finished).toBe(true)

    expect(editor.previewMotionSpecs([{ nodeId: invalid.id, spec: null }])).toBe(false)
    expect(editor.state.motionPreview).toBeNull()
  })

  test('previews and seeks a multi-node scene timeline without mutating authored nodes', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const owner = editor.graph.createNode('FRAME', page.id, { name: 'Scene owner' })
    const first = editor.graph.createNode('RECTANGLE', owner.id, {
      name: 'First target',
      motion: motion({
        tracks: [
          {
            id: 'enter',
            trigger: 'pageEnter',
            keyframes: [
              { offset: 0, x: 0 },
              { offset: 1, x: 100 }
            ],
            timing: { durationMs: 100, easing: 'linear', fill: 'both' }
          }
        ]
      })
    })
    const second = editor.graph.createNode('RECTANGLE', owner.id, {
      name: 'Second target',
      motion: motion({
        tracks: [
          {
            id: 'fade',
            trigger: 'pageEnter',
            keyframes: [
              { offset: 0, opacity: 0 },
              { offset: 1, opacity: 1 }
            ],
            timing: { durationMs: 200, easing: 'linear', fill: 'both' }
          }
        ]
      })
    })
    const outside = editor.graph.createNode('RECTANGLE', page.id, { name: 'Outside target' })
    editor.graph.updateNode(owner.id, {
      motionScene: {
        version: 1,
        id: 'scene',
        sequences: [
          {
            id: 'intro',
            trigger: 'pageEnter',
            cues: [
              { id: 'first', targetNodeId: first.id, trackId: 'enter', startMs: 100 },
              { id: 'second', targetNodeId: second.id, trackId: 'fade', startMs: 0 },
              { id: 'outside', targetNodeId: outside.id, trackId: 'missing', startMs: 0 }
            ]
          }
        ]
      }
    })
    const sceneVersion = editor.state.sceneVersion

    const seek = editor.seekMotionScenePreview(owner.id, 'intro', 150, {
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
    expect(seek).toMatchObject({ started: true, durationMs: 200 })
    expect(seek.issues.map(({ code }) => code)).toEqual(['target-missing'])
    expect(editor.state.motionPreview?.visuals.get(first.id)?.x).toBe(50)
    expect(editor.state.motionPreview?.visuals.get(second.id)?.opacity).toBeCloseTo(0.75)
    expect(editor.state.motionPreview?.playing).toBe(false)

    const preview = editor.previewMotionScene(owner.id, 'intro', {
      infiniteAsSingleCycle: true,
      holdFinalFrame: true
    })
    expect(preview.started).toBe(true)
    expect(editor.state.motionPreview?.targets.map(({ nodeId }) => nodeId)).toEqual([
      first.id,
      second.id
    ])
    expect(editor.graph.getNode(first.id)?.x).toBe(first.x)
    expect(editor.state.sceneVersion).toBe(sceneVersion)
  })

  test('fails closed when a scene owner or its resolved targets are unavailable', () => {
    const editor = createEditor()
    const owner = editor.graph.createNode('FRAME', editor.graph.getPages()[0].id, {
      motionScene: {
        version: 1,
        id: 'emptyScene',
        sequences: [
          {
            id: 'intro',
            trigger: 'manual',
            cues: [{ id: 'missing', targetNodeId: '404:1', trackId: 'enter', startMs: 0 }]
          }
        ]
      }
    })

    expect(editor.previewMotionScene('missing-owner', 'intro')).toEqual({
      started: false,
      durationMs: 0,
      issues: []
    })
    expect(editor.previewMotionScene(owner.id, 'intro')).toMatchObject({
      started: false,
      issues: [{ code: 'target-missing' }]
    })
    expect(editor.state.motionPreview).toBeNull()
  })
})
