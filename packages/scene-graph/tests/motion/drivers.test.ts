import { describe, expect, test } from 'bun:test'

import {
  cloneMotionDriverSpec,
  MOTION_DRIVER_LIMITS,
  parseMotionDriverSpec,
  remapMotionDriverNodeIds,
  SceneGraph,
  validateMotionDriverSpec,
  type MotionDriverSpecV1
} from '@open-pencil/scene-graph'

function driverSpec(): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'scrollHero',
        source: { kind: 'scroll', sourceNodeId: '0:1', axis: 'y', metric: 'progress' },
        target: { targetNodeId: '0:10', trackId: 'heroMove' },
        mapping: { inputMin: 0, inputMax: 1, clamp: true, reverse: true, deadZone: 0.05 }
      },
      {
        id: 'pointerGlow',
        source: { kind: 'pointer', sourceNodeId: '0:2', axis: 'x', space: 'local' },
        target: { targetNodeId: '0:11', trackId: 'glow' },
        mapping: { inputMin: 0, inputMax: 1 }
      },
      {
        id: 'dragCard',
        source: { kind: 'drag', handleNodeId: '0:3', axis: 'x', distance: 320 },
        target: { targetNodeId: '0:12', trackId: 'cardDrag' },
        mapping: { inputMin: -320, inputMax: 320, clamp: false }
      },
      {
        id: 'visibleCopy',
        source: { kind: 'visibility', sourceNodeId: '0:4' },
        target: { targetNodeId: '0:13', trackId: 'copyFade' },
        mapping: { inputMin: 0.2, inputMax: 0.8 }
      },
      {
        id: 'pageStateProgress',
        source: { kind: 'pageState', stateId: 'state:progress' },
        target: { targetNodeId: '0:14', trackId: 'progress' },
        mapping: { inputMin: 0, inputMax: 100 }
      },
      {
        id: 'documentStateOpen',
        source: { kind: 'documentState', stateId: 'state:open' },
        target: { targetNodeId: '0:15', trackId: 'panelOpen' },
        mapping: { inputMin: 0, inputMax: 1 }
      },
      {
        id: 'variableTheme',
        source: { kind: 'variable', variableId: 'variable:theme' },
        target: { targetNodeId: '0:16', trackId: 'themeShift' },
        mapping: { inputMin: 0, inputMax: 1 }
      }
    ]
  }
}

describe('MotionDriverSpecV1', () => {
  test('strictly parses every bounded source without copying Motion keyframes', () => {
    const source = driverSpec()
    const parsed = parseMotionDriverSpec(source)
    expect(parsed).toEqual(source)
    expect(JSON.stringify(parsed)).not.toContain('keyframes')
  })

  test('deep clones sources, targets, and mappings', () => {
    const source = driverSpec()
    const copy = cloneMotionDriverSpec(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.drivers).not.toBe(source.drivers)
    expect(copy.drivers[0]?.source).not.toBe(source.drivers[0]?.source)
    expect(copy.drivers[0]?.target).not.toBe(source.drivers[0]?.target)
    expect(copy.drivers[0]?.mapping).not.toBe(source.drivers[0]?.mapping)
  })

  test('remaps only node references and preserves state, variable, driver, and track ids', () => {
    const source = driverSpec()
    const remapped = remapMotionDriverNodeIds(
      source,
      new Map([
        ['0:1', '9:1'],
        ['0:3', '9:3'],
        ['0:4', '9:4'],
        ['0:10', '9:10'],
        ['0:12', '9:12']
      ])
    )

    expect(remapped.drivers[0]?.source).toMatchObject({ sourceNodeId: '9:1' })
    expect(remapped.drivers[0]?.target).toEqual({ targetNodeId: '9:10', trackId: 'heroMove' })
    expect(remapped.drivers[2]?.source).toMatchObject({ handleNodeId: '9:3' })
    expect(remapped.drivers[2]?.target.targetNodeId).toBe('9:12')
    expect(remapped.drivers[3]?.source).toEqual({ kind: 'visibility', sourceNodeId: '9:4' })
    expect(remapped.drivers[4]?.source).toEqual({
      kind: 'pageState',
      stateId: 'state:progress'
    })
    expect(remapped.drivers[6]?.source).toEqual({
      kind: 'variable',
      variableId: 'variable:theme'
    })
    expect(remapped.drivers.map(({ id }) => id)).toEqual(source.drivers.map(({ id }) => id))
  })

  test('cloneTree deep-copies specs and remaps included source, handle, and target nodes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const frame = graph.createNode('FRAME', page.id, { name: 'Driven scene' })
    const source = graph.createNode('FRAME', frame.id, { name: 'Scroll source' })
    const handle = graph.createNode('RECTANGLE', frame.id, { name: 'Drag handle' })
    const target = graph.createNode('RECTANGLE', frame.id, { name: 'Target' })
    graph.updateNode(frame.id, {
      motionDrivers: {
        version: 1,
        drivers: [
          {
            id: 'scrollTarget',
            source: { kind: 'scroll', sourceNodeId: source.id, axis: 'y', metric: 'progress' },
            target: { targetNodeId: target.id, trackId: 'move' },
            mapping: { inputMin: 0, inputMax: 1 }
          },
          {
            id: 'dragTarget',
            source: { kind: 'drag', handleNodeId: handle.id, axis: 'x', distance: 100 },
            target: { targetNodeId: frame.id, trackId: 'drag' },
            mapping: { inputMin: 0, inputMax: 100 }
          }
        ]
      }
    })

    const clone = graph.cloneTree(frame.id, page.id)
    if (!clone) throw new Error('Expected cloned frame')
    const clonedChildren = graph.getChildren(clone.id)
    const clonedSource = clonedChildren.find((node) => node.name === source.name)
    const clonedHandle = clonedChildren.find((node) => node.name === handle.name)
    const clonedTarget = clonedChildren.find((node) => node.name === target.name)

    expect(clone.motionDrivers).not.toBe(frame.motionDrivers)
    expect(clone.motionDrivers?.drivers[0]?.source).toMatchObject({
      sourceNodeId: clonedSource?.id
    })
    expect(clone.motionDrivers?.drivers[0]?.target.targetNodeId).toBe(clonedTarget?.id)
    expect(clone.motionDrivers?.drivers[1]?.source).toMatchObject({
      handleNodeId: clonedHandle?.id
    })
    expect(clone.motionDrivers?.drivers[1]?.target.targetNodeId).toBe(clone.id)
    expect(frame.motionDrivers?.drivers[0]?.target.targetNodeId).toBe(target.id)
  })

  test('fails closed for future, malformed, ambiguous, and non-portable payloads', () => {
    const source = driverSpec()
    const first = source.drivers[0]
    if (!first) throw new Error('Expected driver')
    const cyclic: Record<string, unknown> = { ...source }
    cyclic.self = cyclic
    const customPrototype = Object.assign(Object.create({ inherited: true }), source)
    const candidates: unknown[] = [
      { ...source, version: 2 },
      { ...source, script: 'alert(1)' },
      { ...source, drivers: [{ ...first, id: '__proto__' }] },
      { ...source, drivers: [first, { ...first }] },
      {
        ...source,
        drivers: [first, { ...source.drivers[1], target: { ...first.target } }]
      },
      {
        ...source,
        drivers: [{ ...first, mapping: { inputMin: 1, inputMax: 1 } }]
      },
      {
        ...source,
        drivers: [{ ...first, mapping: { inputMin: 0, inputMax: 1, deadZone: 0.5 } }]
      },
      {
        ...source,
        drivers: [
          {
            ...first,
            source: { kind: 'scroll', axis: 'y', metric: 'progress', onChange: 'script' }
          }
        ]
      },
      cyclic,
      customPrototype
    ]
    for (const candidate of candidates) {
      expect(validateMotionDriverSpec(candidate).success).toBe(false)
    }
  })

  test('enforces the global driver resource limit', () => {
    const first = driverSpec().drivers[0]
    if (!first) throw new Error('Expected driver')
    expect(
      validateMotionDriverSpec({
        version: 1,
        drivers: Array.from({ length: MOTION_DRIVER_LIMITS.maxDrivers + 1 }, (_, index) => ({
          ...first,
          id: `driver${index}`,
          target: { targetNodeId: `target:${index}`, trackId: `track${index}` }
        }))
      }).success
    ).toBe(false)
  })
})
