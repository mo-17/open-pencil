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
})
