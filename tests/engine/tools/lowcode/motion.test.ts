import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { CORE_TOOLS } from '@open-pencil/core/tools'
import {
  createMotionPreset,
  type MotionPresetDefinition,
  type MotionRecipe,
  SceneGraph
} from '@open-pencil/scene-graph'

import type {
  LowcodeNodeRead,
  MotionBatchRead,
  MotionRead,
  MotionSceneRead
} from '#core/tools/read'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function setupEditorToolTest() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  return { graph, figma, editor }
}

function recipe(): MotionRecipe {
  return {
    format: 'openpencil-motion-recipe',
    version: 1,
    id: 'pairedEntrance',
    name: 'Paired entrance',
    parameters: [{ id: 'duration', defaultValue: 400, min: 100, max: 1_000 }],
    roles: [
      {
        id: 'hero',
        motion: {
          version: 1,
          tracks: [
            {
              id: 'heroEnter',
              trigger: 'pageEnter',
              keyframes: [
                { offset: 0, opacity: 0 },
                { offset: 1, opacity: 1 }
              ],
              timing: { durationMs: 400 }
            }
          ]
        },
        bindings: [
          {
            parameterId: 'duration',
            target: { kind: 'timing', trackId: 'heroEnter', field: 'durationMs' }
          }
        ]
      },
      {
        id: 'item',
        motion: {
          version: 1,
          tracks: [
            {
              id: 'itemEnter',
              trigger: 'pageEnter',
              keyframes: [
                { offset: 0, y: 20 },
                { offset: 1, y: 0 }
              ],
              timing: { durationMs: 400 }
            }
          ]
        },
        bindings: [
          {
            parameterId: 'duration',
            target: { kind: 'timing', trackId: 'itemEnter', field: 'durationMs' }
          }
        ]
      }
    ]
  }
}

describe('MotionSpec tools', () => {
  test('all node and scene motion tools are available to the built-in AI registry', () => {
    const names = new Set(CORE_TOOLS.map((tool) => tool.name))
    for (const name of [
      'read_motion',
      'list_motion_presets',
      'apply_motion_preset',
      'apply_motion_recipe',
      'apply_motion_spec',
      'update_motion',
      'clear_motion',
      'read_motion_scene',
      'update_motion_scene',
      'clear_motion_scene',
      'read_motion_drivers',
      'update_motion_drivers',
      'clear_motion_drivers',
      'read_prototype',
      'update_prototype',
      'clear_prototype',
      'read_motion_transition_key',
      'set_motion_transition_key',
      'clear_motion_transition_key'
    ]) {
      expect(names.has(name)).toBe(true)
      expect(getTool(name).name).toBe(name)
    }
  })

  test('expands a parameterized multi-node recipe as one undoable transaction', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const page = graph.getPages()[0]
    const hero = graph.createNode('RECTANGLE', page.id)
    const item = graph.createNode('RECTANGLE', page.id)
    const result = getTool('apply_motion_recipe').execute(
      figma,
      {
        recipeJson: JSON.stringify(recipe()),
        roleMappingJson: JSON.stringify({ hero: [hero.id], item: [item.id] }),
        parametersJson: JSON.stringify({ duration: 720 })
      },
      { editor }
    ) as Result<{ recipeId: string; nodeIds: string[]; assignmentCount: number }>

    expect(result).toEqual({
      ok: true,
      data: { recipeId: 'pairedEntrance', nodeIds: [hero.id, item.id], assignmentCount: 2 }
    })
    expect(graph.getNode(hero.id)?.motion?.tracks[0]?.timing.durationMs).toBe(720)
    expect(graph.getNode(item.id)?.motion?.tracks[0]?.timing.durationMs).toBe(720)
    expect(editor.undo.undoLabel).toBe('AI: apply_motion_recipe')
    expect(editor.undo.undo()).toBe('AI: apply_motion_recipe')
    expect(graph.getNode(hero.id)?.motion).toBeUndefined()
    expect(graph.getNode(item.id)?.motion).toBeUndefined()
  })

  test('rejects a recipe with a missing mapped target before changing any node', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const hero = figma.createRectangle()
    const existing = createMotionPreset('press')
    graph.updateNode(hero.id, { motion: existing })
    const result = getTool('apply_motion_recipe').execute(
      figma,
      {
        recipeJson: JSON.stringify(recipe()),
        roleMappingJson: JSON.stringify({ hero: [hero.id], item: ['missing'] })
      },
      { editor }
    ) as Result<unknown>

    expect(result.ok).toBe(false)
    expect(graph.getNode(hero.id)?.motion).toEqual(existing)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('bounds recipe role mappings and parameters before JSON parsing', () => {
    const { figma } = setupEditorToolTest()
    const tool = getTool('apply_motion_recipe')
    const oversized = ' '.repeat(1024 * 1024 + 1)
    const roleResult = tool.execute(figma, {
      recipeJson: JSON.stringify(recipe()),
      roleMappingJson: oversized
    }) as Result<unknown>
    const parameterResult = tool.execute(figma, {
      recipeJson: JSON.stringify(recipe()),
      roleMappingJson: '{}',
      parametersJson: oversized
    }) as Result<unknown>

    expect(roleResult).toMatchObject({
      ok: false,
      error: expect.stringContaining('roleMappingJson must not exceed')
    })
    expect(parameterResult).toMatchObject({
      ok: false,
      error: expect.stringContaining('parametersJson must not exceed')
    })
  })

  test('rejects a node-incompatible recipe before changing any assignment', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const page = graph.getPages()[0]
    const hero = graph.createNode('RECTANGLE', page.id)
    const item = graph.createNode('RECTANGLE', page.id)
    const incompatible = recipe()
    incompatible.roles[0].bindings = []
    incompatible.roles[0].motion = {
      version: 3,
      tracks: [
        {
          id: 'text-reveal',
          trigger: 'mount',
          keyframes: [
            { offset: 0, textReveal: 0 },
            { offset: 1, textReveal: 1 }
          ],
          timing: { durationMs: 300 }
        }
      ]
    }

    const result = getTool('apply_motion_recipe').execute(
      figma,
      {
        recipeJson: JSON.stringify(incompatible),
        roleMappingJson: JSON.stringify({ hero: [hero.id], item: [item.id] })
      },
      { editor }
    ) as Result<unknown>

    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('Expected an incompatible recipe failure')
    expect(result.error).toContain('Text reveal requires a TEXT node')
    expect(graph.getNode(hero.id)?.motion).toBeUndefined()
    expect(graph.getNode(item.id)?.motion).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)
  })

  test('authors, reads, clears, and undoes bounded scene choreography', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const page = graph.getPages()[0]
    const target = graph.createNode('RECTANGLE', page.id, {
      name: 'Scene target',
      motion: createMotionPreset('slide-up')
    })
    const scene = {
      version: 1,
      id: 'pageScene',
      sequences: [
        {
          id: 'intro',
          trigger: 'pageEnter',
          cues: [
            {
              id: 'targetCue',
              targetNodeId: target.id,
              trackId: 'slide-up',
              startMs: 120
            }
          ]
        }
      ]
    }

    const updated = getTool('update_motion_scene').execute(
      figma,
      { nodeId: page.id, specJson: JSON.stringify(scene) },
      { editor }
    ) as Result<{ nodeId: string; sequenceCount: number; cueCount: number }>
    expect(updated).toEqual({
      ok: true,
      data: { nodeId: page.id, sequenceCount: 1, cueCount: 1 }
    })
    expect(editor.undo.undoLabel).toBe('AI: update_motion_scene')

    const read = getTool('read_motion_scene').execute(figma, {
      nodeId: page.id
    }) as Result<MotionSceneRead>
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data).toMatchObject({
      id: page.id,
      scene,
      sequenceCount: 1,
      cueCount: 1
    })
    expect(read.data.scene).not.toBe(graph.getNode(page.id)?.motionScene)

    const cleared = getTool('clear_motion_scene').execute(
      figma,
      { nodeId: page.id },
      { editor }
    ) as Result<{ nodeId: string; cleared: boolean }>
    expect(cleared).toEqual({ ok: true, data: { nodeId: page.id, cleared: true } })
    expect(graph.getNode(page.id)?.motionScene).toBeUndefined()
    expect(editor.undo.undo()).toBe('AI: clear_motion_scene')
    expect(graph.getNode(page.id)?.motionScene).toEqual(scene)
  })

  test('rejects invalid scene owners and enabled references before mutation', () => {
    const { figma, graph } = setupToolTest()
    const page = graph.getPages()[0]
    const owner = graph.createNode('FRAME', page.id)
    const outside = graph.createNode('RECTANGLE', page.id, {
      motion: createMotionPreset('fade-in')
    })
    const scene = {
      version: 1,
      id: 'invalidScene',
      sequences: [
        {
          id: 'intro',
          trigger: 'manual',
          cues: [
            {
              id: 'outsideCue',
              targetNodeId: outside.id,
              trackId: 'fade-in',
              startMs: 0
            }
          ]
        }
      ]
    }
    const invalidReference = getTool('update_motion_scene').execute(figma, {
      nodeId: owner.id,
      specJson: JSON.stringify(scene)
    }) as Result<unknown>
    expect(invalidReference.ok).toBe(false)
    expect(graph.getNode(owner.id)?.motionScene).toBeUndefined()

    const invalidOwner = getTool('update_motion_scene').execute(figma, {
      nodeId: outside.id,
      specJson: JSON.stringify({
        ...scene,
        sequences: [
          {
            ...scene.sequences[0],
            cues: [{ ...scene.sequences[0].cues[0], enabled: false }]
          }
        ]
      })
    }) as Result<unknown>
    expect(invalidOwner.ok).toBe(false)
    expect(graph.getNode(outside.id)?.motionScene).toBeUndefined()
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
    expect(result.data.find((preset) => preset.id === 'slide-up')).toMatchObject({
      category: 'entrance',
      keywords: ['slide', 'up', 'entrance']
    })

    const returned = result.data.find((preset) => preset.id === 'slide-up')
    if (!returned) throw new Error('Expected slide-up preset')
    ;(returned.keywords as string[]).push('mutated')
    ;(returned.parameters.distance as { defaultValue: number }).defaultValue = -1

    const repeated = getTool('list_motion_presets').execute(figma, {}) as Result<
      MotionPresetDefinition[]
    >
    expect(repeated.ok).toBe(true)
    if (!repeated.ok) return
    expect(repeated.data.find((preset) => preset.id === 'slide-up')).toMatchObject({
      category: 'entrance',
      keywords: ['slide', 'up', 'entrance'],
      parameters: { distance: { defaultValue: 24 } }
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

  test('reads bounded motion summaries for multiple nodes in one call', () => {
    const { figma, graph } = setupToolTest()
    const animated = figma.createRectangle()
    const staticNode = figma.createRectangle()
    graph.updateNode(animated.id, { motion: createMotionPreset('fade-in') })

    const summary = getTool('read_motions').execute(figma, {
      nodeIds: [animated.id, staticNode.id, animated.id, 'missing'],
      mode: 'summary'
    }) as Result<MotionBatchRead>

    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.data.missing).toEqual(['missing'])
    expect(summary.data.results).toHaveLength(2)
    expect(summary.data.results[0]).toMatchObject({
      id: animated.id,
      summary: { trackCount: 1, keyframeCount: 2, triggers: ['mount'] }
    })
    expect(summary.data.results[0].spec).toBeUndefined()
    expect(summary.data.results[0].advanced).toBeUndefined()
    expect(summary.data.results[1]).toMatchObject({ id: staticNode.id, summary: null })

    const full = getTool('read_motions').execute(figma, {
      nodeIds: [animated.id],
      mode: 'full',
      includeAdvanced: true
    }) as Result<MotionBatchRead>
    expect(full.ok).toBe(true)
    if (!full.ok) return
    expect(full.data.results[0].spec).toEqual(graph.getNode(animated.id)?.motion)
    expect(full.data.results[0].advanced).toBeDefined()
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

  test('reads node-owned structured templates and rejects incompatible targets before mutation', () => {
    const { figma, graph } = setupToolTest()
    const node = figma.createRectangle()
    graph.updateNode(node.id, {
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const motion = createMotionPreset('fade-in')
    motion.version = 3
    for (const frame of motion.tracks[0].keyframes) {
      frame.paints = [
        {
          kind: 'fill',
          index: 0,
          color: { r: frame.offset, g: 0.5, b: 1 - frame.offset, a: 1 },
          opacity: 0.25 + frame.offset * 0.75
        }
      ]
    }

    const updated = getTool('update_motion').execute(figma, {
      nodeId: node.id,
      specJson: JSON.stringify(motion)
    }) as Result<{ nodeId: string; trackCount: number }>
    expect(updated).toEqual({ ok: true, data: { nodeId: node.id, trackCount: 1 } })

    const read = getTool('read_motion').execute(figma, { nodeId: node.id }) as Result<MotionRead>
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.data.advanced.diagnostics).toEqual([])
    expect(
      read.data.advanced.templates.find((template) => template.channel === 'paints')
    ).toMatchObject({
      channel: 'paints',
      supported: true,
      targets: [{ kind: 'fill', index: 0, opacity: 1 }]
    })

    const incompatible = structuredClone(motion)
    for (const frame of incompatible.tracks[0].keyframes) {
      if (!frame.paints?.[0]) throw new Error('Expected structured paint target')
      frame.paints[0].index = 99
    }
    const rejected = getTool('update_motion').execute(figma, {
      nodeId: node.id,
      specJson: JSON.stringify(incompatible)
    }) as Result<unknown>
    expect(rejected.ok).toBe(false)
    expect(graph.getNode(node.id)?.motion).toEqual(motion)
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

  test('rejects oversized spec JSON before parsing or mutating targets', () => {
    const { figma, graph } = setupToolTest()
    const first = figma.createRectangle()
    const second = figma.createRectangle()
    const original = createMotionPreset('fade-in')
    graph.updateNode(first.id, { motion: original })
    const oversized = ' '.repeat(1024 * 1024 + 1)

    const update = getTool('update_motion').execute(figma, {
      nodeId: first.id,
      specJson: oversized
    }) as Result<unknown>
    expect(update.ok).toBe(false)

    const apply = getTool('apply_motion_spec').execute(figma, {
      nodeIds: [first.id, second.id],
      specJson: oversized
    }) as Result<unknown>
    expect(apply.ok).toBe(false)
    expect(graph.getNode(first.id)?.motion).toEqual(original)
    expect(graph.getNode(second.id)?.motion).toBeUndefined()
  })

  test('applies preset stagger in deterministic spatial order', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const lower = graph.createNode('RECTANGLE', pageId, { x: 0, y: 100 })
    const upper = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0 })

    const result = getTool('apply_motion_preset').execute(figma, {
      nodeIds: [lower.id, upper.id],
      preset: 'fade-in',
      delayMs: 5,
      staggerMs: 15,
      direction: 'forward',
      rhythm: 'linear'
    }) as Result<{ nodeIds: string[]; preset: string }>

    expect(result).toEqual({
      ok: true,
      data: { nodeIds: [upper.id, lower.id], preset: 'fade-in' }
    })
    expect(graph.getNode(upper.id)?.motion?.tracks[0].timing.delayMs).toBe(5)
    expect(graph.getNode(lower.id)?.motion?.tracks[0].timing.delayMs).toBe(20)
    expect(graph.getNode(upper.id)?.motion?.preset?.parameters.delayMs).toBe(5)
    expect(graph.getNode(lower.id)?.motion?.preset?.parameters.delayMs).toBe(20)
  })

  test('applies a strict spec atomically with spatially ordered stagger and one undo step', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const pageId = graph.getPages()[0].id
    const bottom = graph.createNode('RECTANGLE', pageId, { x: 0, y: 100 })
    const topRight = graph.createNode('RECTANGLE', pageId, { x: 100, y: 0 })
    const topLeft = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0 })
    const base = createMotionPreset('slide-up', { delayMs: 10 })

    const result = getTool('apply_motion_spec').execute(
      figma,
      {
        nodeIds: [bottom.id, topRight.id, topLeft.id],
        specJson: JSON.stringify(base),
        staggerMs: 20,
        direction: 'forward',
        rhythm: 'linear'
      },
      { editor }
    ) as Result<{ nodeIds: string[]; trackCount: number }>

    expect(result).toEqual({
      ok: true,
      data: { nodeIds: [topLeft.id, topRight.id, bottom.id], trackCount: 1 }
    })
    expect(graph.getNode(topLeft.id)?.motion?.tracks[0].timing.delayMs).toBe(10)
    expect(graph.getNode(topRight.id)?.motion?.tracks[0].timing.delayMs).toBe(30)
    expect(graph.getNode(bottom.id)?.motion?.tracks[0].timing.delayMs).toBe(50)
    expect(base.tracks[0].timing.delayMs).toBe(10)
    expect(editor.undo.undoLabel).toBe('AI: apply_motion_spec')

    expect(editor.undo.undo()).toBe('AI: apply_motion_spec')
    expect(graph.getNode(topLeft.id)?.motion).toBeUndefined()
    expect(graph.getNode(topRight.id)?.motion).toBeUndefined()
    expect(graph.getNode(bottom.id)?.motion).toBeUndefined()
    expect(editor.undo.canUndo).toBe(false)

    expect(editor.undo.redo()).toBe('AI: apply_motion_spec')
    expect(graph.getNode(topRight.id)?.motion?.tracks[0].timing.delayMs).toBe(30)
  })

  test('later-target stagger overflow leaves every target and undo history unchanged', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const first = figma.createRectangle()
    const second = figma.createRectangle()
    const firstOriginal = createMotionPreset('hover-lift')
    const secondOriginal = createMotionPreset('press')
    graph.updateNode(first.id, { motion: firstOriginal })
    graph.updateNode(second.id, { motion: secondOriginal })
    const atDelayLimit = createMotionPreset('fade-in', { delayMs: 60_000 })

    const result = getTool('apply_motion_spec').execute(
      figma,
      {
        nodeIds: [first.id, second.id],
        specJson: JSON.stringify(atDelayLimit),
        staggerMs: 1,
        direction: 'forward',
        rhythm: 'linear'
      },
      { editor }
    ) as Result<unknown>

    expect(result.ok).toBe(false)
    expect(graph.getNode(first.id)?.motion).toEqual(firstOriginal)
    expect(graph.getNode(second.id)?.motion).toEqual(secondOriginal)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('motion tools author and clear explicit INSTANCE root overrides with undo', () => {
    const { figma, graph, editor } = setupEditorToolTest()
    const pageId = graph.getPages()[0].id
    const inherited = createMotionPreset('fade-in')
    const component = graph.createNode('COMPONENT', pageId, { motion: inherited })
    const instance = graph.createInstance(component.id, pageId)
    if (!instance) throw new Error('Expected instance')

    const applied = getTool('apply_motion_preset').execute(
      figma,
      { nodeId: instance.id, preset: 'hover-lift' },
      { editor }
    ) as Result<{ nodeIds: string[]; preset: string }>
    expect(applied.ok).toBe(true)
    const authored = graph.getNode(instance.id)
    expect(authored?.motion?.preset?.id).toBe('hover-lift')
    expect(authored?.overrides.motion).toEqual(authored?.motion)
    expect(authored?.overrides.motion).not.toBe(authored?.motion)
    expect(graph.getNode(component.id)?.motion).toEqual(inherited)

    const cleared = getTool('clear_motion').execute(
      figma,
      { nodeId: instance.id },
      { editor }
    ) as Result<{ nodeIds: string[]; cleared: number }>
    expect(cleared).toEqual({ ok: true, data: { nodeIds: [instance.id], cleared: 1 } })
    const clearedNode = graph.getNode(instance.id)
    expect(clearedNode?.motion).toBeUndefined()
    expect(Object.hasOwn(clearedNode ?? {}, 'motion')).toBe(false)
    expect(clearedNode?.overrides.motion).toBeNull()

    expect(editor.undo.undo()).toBe('AI: clear_motion')
    expect(graph.getNode(instance.id)?.motion?.preset?.id).toBe('hover-lift')
    expect(graph.getNode(instance.id)?.overrides.motion).toEqual(graph.getNode(instance.id)?.motion)
    expect(editor.undo.redo()).toBe('AI: clear_motion')
    expect(graph.getNode(instance.id)?.overrides.motion).toBeNull()
  })

  test('headless motion mutation keeps INSTANCE root overrides explicit', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    const component = graph.createNode('COMPONENT', pageId, {
      motion: createMotionPreset('fade-in')
    })
    const instance = graph.createInstance(component.id, pageId)
    if (!instance) throw new Error('Expected instance')
    const replacement = createMotionPreset('press')
    replacement.version = 3
    for (const frame of replacement.tracks[0].keyframes) {
      frame.cornerRadii = {
        topLeft: 2 + frame.offset * 10,
        topRight: 4 + frame.offset * 10,
        bottomRight: 6 + frame.offset * 10,
        bottomLeft: 8 + frame.offset * 10
      }
    }

    const updated = getTool('update_motion').execute(figma, {
      nodeId: instance.id,
      specJson: JSON.stringify(replacement)
    }) as Result<{ nodeId: string; trackCount: number }>
    expect(updated.ok).toBe(true)
    expect(graph.getNode(instance.id)?.motion).toEqual(replacement)
    expect(graph.getNode(instance.id)?.overrides.motion).toEqual(replacement)
    expect(graph.getNode(instance.id)?.overrides.motion).not.toBe(
      graph.getNode(instance.id)?.motion
    )
    expect(
      graph.getNode(instance.id)?.overrides.motion?.tracks[0].keyframes[1].cornerRadii
    ).toEqual({ topLeft: 12, topRight: 14, bottomRight: 16, bottomLeft: 18 })

    const cleared = getTool('clear_motion').execute(figma, {
      nodeId: instance.id
    }) as Result<{ nodeIds: string[]; cleared: number }>
    expect(cleared).toEqual({ ok: true, data: { nodeIds: [instance.id], cleared: 1 } })
    expect(graph.getNode(instance.id)?.motion).toBeUndefined()
    expect(graph.getNode(instance.id)?.overrides.motion).toBeNull()
    expect(graph.getNode(component.id)?.motion?.preset?.id).toBe('fade-in')
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
