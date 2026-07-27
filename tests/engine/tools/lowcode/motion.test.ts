import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { CORE_TOOLS } from '@open-pencil/core/tools'
import {
  createMotionPreset,
  type MotionPresetDefinition,
  SceneGraph
} from '@open-pencil/scene-graph'

import type { LowcodeNodeRead, MotionRead } from '#core/tools/read'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function setupEditorToolTest() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  return { graph, figma, editor }
}

describe('MotionSpec tools', () => {
  test('all five motion tools are available to the built-in AI registry', () => {
    const names = new Set(CORE_TOOLS.map((tool) => tool.name))
    for (const name of [
      'read_motion',
      'list_motion_presets',
      'apply_motion_preset',
      'update_motion',
      'clear_motion'
    ]) {
      expect(names.has(name)).toBe(true)
      expect(getTool(name).name).toBe(name)
    }
  })

  test('lists bounded preset definitions', () => {
    const { figma } = setupToolTest()
    const result = getTool('list_motion_presets').execute(figma, {}) as Result<
      MotionPresetDefinition[]
    >
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.map((preset) => preset.id)).toEqual([
      'fade-in',
      'slide-up',
      'scale-in',
      'bounce-in',
      'hover-lift',
      'press',
      'pulse',
      'float'
    ])
    expect(result.data.find((preset) => preset.id === 'slide-up')?.parameters.distance).toEqual({
      defaultValue: 24,
      min: 0,
      max: 100_000
    })
  })

  test('applies and reads a preset without editor context', () => {
    const { figma, graph } = setupToolTest()
    const node = figma.createRectangle()
    const apply = getTool('apply_motion_preset').execute(figma, {
      nodeId: node.id,
      preset: 'slide-up',
      durationMs: 520,
      delayMs: 30,
      distance: 36
    }) as Result<{ nodeIds: string[]; preset: string }>
    expect(apply).toEqual({
      ok: true,
      data: { nodeIds: [node.id], preset: 'slide-up' }
    })
    expect(graph.getNode(node.id)?.motion?.tracks[0].timing.durationMs).toBe(520)
    expect(graph.getNode(node.id)?.motion?.tracks[0].keyframes[0].y).toBe(36)

    const read = getTool('read_motion').execute(figma, { nodeId: node.id }) as Result<MotionRead>
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.summary).toMatchObject({
      trackCount: 1,
      keyframeCount: 2,
      triggers: ['mount'],
      preset: 'slide-up'
    })
    expect(read.data.spec).toEqual(graph.getNode(node.id)?.motion)
    expect(read.data.spec).not.toBe(graph.getNode(node.id)?.motion)
  })

  test('update_motion strictly parses JSON and read_lowcode_node includes spec plus summary', () => {
    const { figma, graph } = setupToolTest()
    const node = figma.createRectangle()
    const motion = createMotionPreset('hover-lift', { durationMs: 210, distance: 10 })
    const update = getTool('update_motion').execute(figma, {
      nodeId: node.id,
      specJson: JSON.stringify(motion)
    }) as Result<{ nodeId: string; trackCount: number }>
    expect(update).toEqual({ ok: true, data: { nodeId: node.id, trackCount: 1 } })

    const lowcode = getTool('read_lowcode_node').execute(figma, {
      id: node.id
    }) as Result<LowcodeNodeRead>
    expect(lowcode.ok).toBe(true)
    if (!lowcode.ok) return
    expect(lowcode.data.motion).toEqual(motion)
    expect(lowcode.data.motionSummary).toMatchObject({
      trackCount: 1,
      triggers: ['hover'],
      preset: 'hover-lift'
    })
    expect(lowcode.data.motion).not.toBe(graph.getNode(node.id)?.motion)
  })

  test('invalid preset, target, or spec leaves every target unchanged', () => {
    const { figma, graph } = setupToolTest()
    const first = figma.createRectangle()
    const second = figma.createRectangle()
    const original = createMotionPreset('fade-in')
    graph.updateNode(first.id, { motion: original })

    const invalidPreset = getTool('apply_motion_preset').execute(figma, {
      nodeIds: [first.id, second.id],
      preset: 'does-not-exist'
    }) as Result<unknown>
    expect(invalidPreset.ok).toBe(false)
    expect(graph.getNode(first.id)?.motion).toEqual(original)
    expect(graph.getNode(second.id)?.motion).toBeUndefined()

    const missingTarget = getTool('apply_motion_preset').execute(figma, {
      nodeIds: [first.id, 'missing-node'],
      preset: 'slide-up'
    }) as Result<unknown>
    expect(missingTarget.ok).toBe(false)
    expect(graph.getNode(first.id)?.motion).toEqual(original)

    const invalidSpec = getTool('update_motion').execute(figma, {
      nodeId: first.id,
      specJson: JSON.stringify({
        version: 1,
        tracks: [],
        arbitraryJs: 'alert(1)'
      })
    }) as Result<unknown>
    expect(invalidSpec.ok).toBe(false)
    expect(graph.getNode(first.id)?.motion).toEqual(original)

    const noTargets = getTool('clear_motion').execute(figma, {}) as Result<unknown>
    expect(noTargets.ok).toBe(false)
    expect(graph.getNode(first.id)?.motion).toEqual(original)
  })

  test('multi-node apply is one undo batch with deep copies and working redo', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const first = figma.createRectangle()
    const second = figma.createRectangle()

    const result = getTool('apply_motion_preset').execute(
      figma,
      {
        nodeId: first.id,
        nodeIds: [second.id, first.id],
        preset: 'pulse',
        durationMs: 1_800,
        intensity: 1.2
      },
      { editor }
    ) as Result<{ nodeIds: string[]; preset: string }>
    expect(result.ok).toBe(true)
    expect(editor.undo.undoLabel).toBe('AI: apply_motion_preset')
    expect(graph.getNode(first.id)?.motion).toEqual(graph.getNode(second.id)?.motion)
    expect(graph.getNode(first.id)?.motion).not.toBe(graph.getNode(second.id)?.motion)
    expect(graph.getNode(first.id)?.motion?.tracks).not.toBe(
      graph.getNode(second.id)?.motion?.tracks
    )

    expect(editor.undo.undo()).toBe('AI: apply_motion_preset')
    expect(graph.getNode(first.id)?.motion).toBeUndefined()
    expect(graph.getNode(second.id)?.motion).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)

    expect(editor.undo.redo()).toBe('AI: apply_motion_preset')
    expect(graph.getNode(first.id)?.motion?.preset?.id).toBe('pulse')
    expect(graph.getNode(second.id)?.motion?.preset?.id).toBe('pulse')
  })

  test('multi-node clear uses one undo batch and restores both specs', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const first = figma.createRectangle()
    const second = figma.createRectangle()
    graph.updateNode(first.id, { motion: createMotionPreset('fade-in') })
    graph.updateNode(second.id, { motion: createMotionPreset('hover-lift') })

    const result = getTool('clear_motion').execute(
      figma,
      { nodeIds: [first.id, second.id] },
      { editor }
    ) as Result<{ nodeIds: string[]; cleared: number }>
    expect(result.ok).toBe(true)
    expect(editor.undo.undoLabel).toBe('AI: clear_motion')
    expect(graph.getNode(first.id)?.motion).toBeUndefined()
    expect(graph.getNode(second.id)?.motion).toBeUndefined()

    expect(editor.undo.undo()).toBe('AI: clear_motion')
    expect(graph.getNode(first.id)?.motion?.preset?.id).toBe('fade-in')
    expect(graph.getNode(second.id)?.motion?.preset?.id).toBe('hover-lift')
    expect(editor.undo.redo()).toBe('AI: clear_motion')
    expect(graph.getNode(first.id)?.motion).toBeUndefined()
    expect(graph.getNode(second.id)?.motion).toBeUndefined()
  })

  test('clear_motion skips targets without motion and reports the actual change count', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const configured = figma.createRectangle()
    const empty = figma.createRectangle()
    graph.updateNode(configured.id, { motion: createMotionPreset('fade-in') })

    const result = getTool('clear_motion').execute(
      figma,
      { nodeIds: [configured.id, empty.id] },
      { editor }
    ) as Result<{ nodeIds: string[]; cleared: number }>

    expect(result).toEqual({
      ok: true,
      data: { nodeIds: [configured.id, empty.id], cleared: 1 }
    })
    expect(editor.undo.undoLabel).toBe('AI: clear_motion')
    expect(Object.hasOwn(graph.getNode(empty.id) ?? {}, 'motion')).toBe(false)
    editor.undo.undo()
    expect(graph.getNode(configured.id)?.motion?.preset?.id).toBe('fade-in')
    expect(Object.hasOwn(graph.getNode(empty.id) ?? {}, 'motion')).toBe(false)
  })
})
