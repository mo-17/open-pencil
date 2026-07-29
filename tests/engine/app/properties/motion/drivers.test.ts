import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { MotionDriverSpecV1, MotionSpec } from '@open-pencil/scene-graph'

import {
  collectMotionDriverTracks,
  createMotionDriver,
  nextMotionDriverId,
  removeMotionDriver,
  replaceMotionDriver,
  updateMotionDriversWithUndo,
  validateMotionDriverReferences
} from '@/app/properties/motion/drivers'

function motion(delayMs = 0): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'progress',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 100 }
        ],
        timing: { durationMs: 400, delayMs, fill: 'both' }
      }
    ]
  }
}

function setup() {
  const editor = createEditor()
  const page = editor.graph.getPages()[0]
  const frame = editor.graph.createNode('FRAME', page.id, { name: 'Owner' })
  const source = editor.graph.createNode('FRAME', frame.id, { name: 'Scroll source' })
  const target = editor.graph.createNode('RECTANGLE', frame.id, {
    name: 'Target',
    motion: motion()
  })
  const spec: MotionDriverSpecV1 = {
    version: 1,
    drivers: [
      createMotionDriver(
        'driver-1',
        { kind: 'scroll', sourceNodeId: source.id, axis: 'y', metric: 'progress' },
        { targetNodeId: target.id, trackId: 'progress' }
      )
    ]
  }
  return { editor, page, frame, source, target, spec }
}

describe('continuous Motion driver authoring', () => {
  test('lists only direct-progress-safe tracks in stable tree order', () => {
    const { editor, frame, target } = setup()
    editor.graph.createNode('RECTANGLE', frame.id, { name: 'Delayed', motion: motion(10) })

    expect(collectMotionDriverTracks(editor.graph, frame.id)).toEqual([
      {
        key: JSON.stringify([target.id, 'progress']),
        nodeId: target.id,
        nodeName: 'Target',
        trackId: 'progress',
        trackName: 'progress',
        durationMs: 400
      }
    ])
  })

  test('validates owner-scoped references and rejects unsafe targets', () => {
    const { editor, page, frame, spec } = setup()
    expect(validateMotionDriverReferences(editor.graph, frame.id, spec)).toEqual(spec)
    editor.graph.updateNode(page.id, {
      state: [{ id: 'progress', name: 'progress', type: 'number', defaultValue: 0 }]
    })
    const outside = editor.graph.createNode('RECTANGLE', page.id, { motion: motion() })
    const invalid: MotionDriverSpecV1 = {
      version: 1,
      drivers: [
        createMotionDriver(
          'outside',
          { kind: 'pageState', stateId: 'progress' },
          { targetNodeId: outside.id, trackId: 'progress' }
        )
      ]
    }
    expect(() => validateMotionDriverReferences(editor.graph, frame.id, invalid)).toThrow(
      'owner subtree'
    )
  })

  test('rejects missing and non-scalar state sources before mutation', () => {
    const { editor, page, frame, target } = setup()
    const pageStateDriver = (stateId: string): MotionDriverSpecV1 => ({
      version: 1,
      drivers: [
        createMotionDriver(
          'state-driver',
          { kind: 'pageState', stateId },
          { targetNodeId: target.id, trackId: 'progress' }
        )
      ]
    })

    expect(() =>
      validateMotionDriverReferences(editor.graph, frame.id, pageStateDriver('missing'))
    ).toThrow('missing page state')
    editor.graph.updateNode(page.id, {
      state: [{ id: 'label', name: 'label', type: 'string', defaultValue: '' }]
    })
    expect(() =>
      validateMotionDriverReferences(editor.graph, frame.id, pageStateDriver('label'))
    ).toThrow('must be number or boolean')
    expect(editor.graph.getNode(frame.id)?.motionDrivers).toBeUndefined()
  })

  test('commits and clears one validated snapshot with undo', () => {
    const { editor, frame, spec } = setup()
    expect(updateMotionDriversWithUndo(editor, frame.id, spec, 'Update drivers')).toBe(true)
    expect(editor.graph.getNode(frame.id)?.motionDrivers).toEqual(spec)
    expect(editor.undo.undoLabel).toBe('Update drivers')
    expect(editor.undo.undo()).toBe('Update drivers')
    expect(editor.graph.getNode(frame.id)?.motionDrivers).toBeUndefined()

    updateMotionDriversWithUndo(editor, frame.id, spec, 'Update drivers')
    expect(updateMotionDriversWithUndo(editor, frame.id, undefined, 'Clear drivers')).toBe(true)
    expect(editor.graph.getNode(frame.id)?.motionDrivers).toBeUndefined()
  })

  test('allocates, replaces, and removes immutable driver definitions', () => {
    const { spec } = setup()
    expect(nextMotionDriverId(spec)).toBe('driver-2')
    const replacement = {
      ...spec.drivers[0],
      source: { kind: 'pageState', stateId: 'progress' } as const
    }
    const replaced = replaceMotionDriver(spec, 'driver-1', replacement)
    expect(replaced.drivers[0]?.source).toEqual({ kind: 'pageState', stateId: 'progress' })
    expect(spec.drivers[0]?.source.kind).toBe('scroll')
    expect(removeMotionDriver(replaced, 'driver-1')).toBeUndefined()
  })
})
