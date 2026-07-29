import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  createMotionPreset,
  SceneGraph,
  type MotionDriverSpecV1,
  type PrototypeSpecV1
} from '@open-pencil/scene-graph'

import type { MotionDriversRead, MotionTransitionKeyRead, PrototypeRead } from '#core/tools/read'

import { getTool } from '#tests/helpers/tools'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected page')
  return { graph, figma, editor, page }
}

describe('Motion interaction tools', () => {
  test('authors, reads, clears, and undoes continuous drivers', () => {
    const { graph, figma, editor, page } = setup()
    const target = graph.createNode('RECTANGLE', page.id, {
      motion: createMotionPreset('slide-up')
    })
    const spec: MotionDriverSpecV1 = {
      version: 1,
      drivers: [
        {
          id: 'scrollTarget',
          source: { kind: 'scroll', sourceNodeId: target.id, axis: 'y', metric: 'progress' },
          target: { targetNodeId: target.id, trackId: 'slide-up' },
          mapping: { inputMin: 0, inputMax: 1, clamp: true, deadZone: 0.05 }
        }
      ]
    }

    const updated = getTool('update_motion_drivers').execute(
      figma,
      { nodeId: page.id, specJson: JSON.stringify(spec) },
      { editor }
    ) as Result<{ nodeId: string; driverCount: number }>
    expect(updated).toEqual({ ok: true, data: { nodeId: page.id, driverCount: 1 } })
    expect(editor.undo.undoLabel).toBe('AI: update_motion_drivers')

    const read = getTool('read_motion_drivers').execute(figma, {
      nodeId: page.id
    }) as Result<MotionDriversRead>
    expect(read).toMatchObject({ ok: true, data: { id: page.id, spec, driverCount: 1 } })
    if (read.ok) expect(read.data.spec).not.toBe(graph.getNode(page.id)?.motionDrivers)

    const cleared = getTool('clear_motion_drivers').execute(
      figma,
      { nodeId: page.id },
      { editor }
    ) as Result<{ nodeId: string; cleared: boolean }>
    expect(cleared).toEqual({ ok: true, data: { nodeId: page.id, cleared: true } })
    expect(graph.getNode(page.id)?.motionDrivers).toBeUndefined()
    expect(editor.undo.undo()).toBe('AI: clear_motion_drivers')
    expect(graph.getNode(page.id)?.motionDrivers).toEqual(spec)
  })

  test('rejects driver sources, targets, tracks, and variables before mutation', () => {
    const { graph, figma, page } = setup()
    const target = graph.createNode('RECTANGLE', page.id, {
      motion: createMotionPreset('fade-in')
    })
    const candidate = (
      source: MotionDriverSpecV1['drivers'][number]['source'],
      trackId = 'fade-in'
    ) =>
      ({
        version: 1,
        drivers: [
          {
            id: 'invalidDriver',
            source,
            target: { targetNodeId: target.id, trackId },
            mapping: { inputMin: 0, inputMax: 1 }
          }
        ]
      }) satisfies MotionDriverSpecV1

    for (const spec of [
      candidate({ kind: 'visibility', sourceNodeId: 'missing' }),
      candidate({ kind: 'scroll', axis: 'y', metric: 'progress' }, 'missingTrack'),
      candidate({ kind: 'variable', variableId: 'missingVariable' })
    ]) {
      const result = getTool('update_motion_drivers').execute(figma, {
        nodeId: page.id,
        specJson: JSON.stringify(spec)
      }) as Result<unknown>
      expect(result.ok).toBe(false)
      expect(graph.getNode(page.id)?.motionDrivers).toBeUndefined()
    }
  })

  test('authors prototype transitions and explicit Smart Match keys with atomic undo', () => {
    const { graph, figma, editor, page } = setup()
    const source = graph.createNode('RECTANGLE', page.id)
    const destination = graph.createNode('FRAME', page.id)
    const spec: PrototypeSpecV1 = {
      version: 1,
      connections: [
        {
          id: 'openDetails',
          trigger: { kind: 'click' },
          action: { kind: 'navigate', targetNodeId: destination.id },
          transition: {
            kind: 'smartMatch',
            durationMs: 320,
            easing: 'ease-out',
            fallback: 'dissolve'
          },
          interruption: 'replace',
          playback: 'forward'
        }
      ]
    }

    const updated = getTool('update_prototype').execute(
      figma,
      { nodeId: source.id, specJson: JSON.stringify(spec) },
      { editor }
    ) as Result<{ nodeId: string; connectionCount: number }>
    expect(updated).toEqual({ ok: true, data: { nodeId: source.id, connectionCount: 1 } })
    const read = getTool('read_prototype').execute(figma, {
      nodeId: source.id
    }) as Result<PrototypeRead>
    expect(read).toMatchObject({ ok: true, data: { id: source.id, spec, connectionCount: 1 } })

    const keyed = getTool('set_motion_transition_key').execute(
      figma,
      { nodeId: source.id, transitionKey: 'heroCard' },
      { editor }
    ) as Result<{ nodeId: string; transitionKey: string }>
    expect(keyed).toEqual({ ok: true, data: { nodeId: source.id, transitionKey: 'heroCard' } })
    const keyRead = getTool('read_motion_transition_key').execute(figma, {
      nodeId: source.id
    }) as Result<MotionTransitionKeyRead>
    expect(keyRead).toMatchObject({
      ok: true,
      data: { id: source.id, transitionKey: 'heroCard' }
    })
    expect(editor.undo.undo()).toBe('AI: set_motion_transition_key')
    expect(graph.getNode(source.id)?.transitionKey).toBeUndefined()
  })

  test('diagnoses lowcode click conflicts and invalid destinations without implicit priority', () => {
    const { graph, figma, page } = setup()
    const source = graph.createNode('RECTANGLE', page.id, {
      events: { onClick: [{ id: 'existing', kind: 'navigate', to: '/existing' }] }
    })
    const destination = graph.createNode('RECTANGLE', page.id)
    const prototype = (targetNodeId: string): PrototypeSpecV1 => ({
      version: 1,
      connections: [
        {
          id: 'navigate',
          trigger: { kind: 'click' },
          action: { kind: 'navigate', targetNodeId },
          transition: { kind: 'instant' }
        }
      ]
    })

    const conflict = getTool('update_prototype').execute(figma, {
      nodeId: source.id,
      specJson: JSON.stringify(prototype(destination.id))
    }) as Result<unknown>
    expect(conflict).toMatchObject({ ok: false })
    if (!conflict.ok) expect(conflict.error).toContain('lowcode onClick')

    graph.clearNodeFields(source.id, ['events'])
    const invalidTarget = getTool('update_prototype').execute(figma, {
      nodeId: source.id,
      specJson: JSON.stringify(prototype(destination.id))
    }) as Result<unknown>
    expect(invalidTarget).toMatchObject({ ok: false })
    if (!invalidTarget.ok) expect(invalidTarget.error).toContain('page or frame')
    expect(graph.getNode(source.id)?.prototype).toBeUndefined()
  })

  test('fails closed for unsafe Smart Match identities and supports explicit clearing', () => {
    const { graph, figma, editor, page } = setup()
    const node = graph.createNode('RECTANGLE', page.id, { transitionKey: 'heroCard' })
    const invalid = getTool('set_motion_transition_key').execute(figma, {
      nodeId: node.id,
      transitionKey: '__proto__'
    }) as Result<unknown>
    expect(invalid.ok).toBe(false)
    expect(graph.getNode(node.id)?.transitionKey).toBe('heroCard')

    const cleared = getTool('clear_motion_transition_key').execute(
      figma,
      { nodeId: node.id },
      { editor }
    ) as Result<{ nodeId: string; cleared: boolean }>
    expect(cleared).toEqual({ ok: true, data: { nodeId: node.id, cleared: true } })
    expect(graph.getNode(node.id)?.transitionKey).toBeUndefined()
  })
})
