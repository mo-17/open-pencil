import { describe, expect, test } from 'bun:test'

import {
  clonePrototypeSpec,
  parseMotionTransitionKey,
  parsePrototypeSpec,
  PROTOTYPE_LIMITS,
  remapPrototypeNodeIds,
  SceneGraph,
  validateMotionTransitionKey,
  validatePrototypeSpec,
  type PrototypeSpecV1
} from '@open-pencil/scene-graph'

function prototypeSpec(): PrototypeSpecV1 {
  return {
    version: 1,
    connections: [
      {
        id: 'openDetails',
        trigger: { kind: 'click' },
        action: { kind: 'navigate', targetNodeId: '0:20' },
        transition: { kind: 'dissolve', durationMs: 240, easing: 'ease-out' },
        interruption: 'replace',
        playback: 'forward'
      },
      {
        id: 'showOverlay',
        trigger: { kind: 'afterDelay', delayMs: 800 },
        action: {
          kind: 'openOverlay',
          targetNodeId: '0:21',
          placement: 'center',
          dismissOnOutside: true
        },
        transition: {
          kind: 'smartMatch',
          durationMs: 360,
          easing: { type: 'cubicBezier', x1: 0.2, y1: 0, x2: 0, y2: 1 },
          fallback: 'dissolve'
        },
        interruption: 'queue'
      },
      {
        id: 'goBack',
        trigger: { kind: 'click' },
        action: { kind: 'back' },
        transition: {
          kind: 'slide',
          durationMs: 200,
          easing: { type: 'steps', steps: 4, position: 'end' },
          direction: 'right'
        },
        playback: 'reverse'
      },
      {
        id: 'dismissOverlay',
        trigger: { kind: 'click' },
        action: { kind: 'closeOverlay' },
        transition: {
          kind: 'push',
          durationMs: 180,
          easing: { type: 'spring', mass: 1, stiffness: 180, damping: 24, velocity: 0 },
          direction: 'down'
        }
      }
    ]
  }
}

describe('PrototypeSpecV1', () => {
  test('strictly parses navigation, overlay, interruption, reverse, and Smart Match data', () => {
    const source = prototypeSpec()
    expect(parsePrototypeSpec(source)).toEqual(source)
  })

  test('deep clones connections and nested transition/easing objects', () => {
    const source = prototypeSpec()
    const copy = clonePrototypeSpec(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.connections).not.toBe(source.connections)
    expect(copy.connections[0]?.action).not.toBe(source.connections[0]?.action)
    expect(copy.connections[1]?.transition).not.toBe(source.connections[1]?.transition)
    const easing = copy.connections[1]?.transition
    const sourceEasing = source.connections[1]?.transition
    if (easing?.kind !== 'smartMatch' || sourceEasing?.kind !== 'smartMatch') {
      throw new Error('Expected Smart Match transitions')
    }
    expect(easing.easing).not.toBe(sourceEasing.easing)
  })

  test('remaps only navigate and overlay destinations', () => {
    const source = prototypeSpec()
    const remapped = remapPrototypeNodeIds(
      source,
      new Map([
        ['0:20', '9:20'],
        ['0:21', '9:21']
      ])
    )
    expect(remapped.connections[0]?.action).toEqual({
      kind: 'navigate',
      targetNodeId: '9:20'
    })
    expect(remapped.connections[1]?.action).toMatchObject({
      kind: 'openOverlay',
      targetNodeId: '9:21'
    })
    expect(remapped.connections[2]?.action).toEqual({ kind: 'back' })
    expect(remapped.connections.map(({ id }) => id)).toEqual(source.connections.map(({ id }) => id))
  })

  test('cloneTree deep-copies prototype data, remaps destinations, and preserves transition keys', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const frame = graph.createNode('FRAME', page.id, { name: 'Prototype screen' })
    const destination = graph.createNode('FRAME', frame.id, {
      name: 'Destination',
      transitionKey: 'heroDestination'
    })
    const overlay = graph.createNode('FRAME', frame.id, { name: 'Overlay' })
    const source = graph.createNode('RECTANGLE', frame.id, {
      name: 'Source',
      transitionKey: 'heroSource',
      prototype: {
        version: 1,
        connections: [
          {
            id: 'navigate',
            trigger: { kind: 'click' },
            action: { kind: 'navigate', targetNodeId: destination.id },
            transition: { kind: 'instant' }
          },
          {
            id: 'overlay',
            trigger: { kind: 'afterDelay', delayMs: 100 },
            action: {
              kind: 'openOverlay',
              targetNodeId: overlay.id,
              placement: 'bottom'
            },
            transition: { kind: 'dissolve', durationMs: 100, easing: 'linear' }
          }
        ]
      }
    })

    const clone = graph.cloneTree(frame.id, page.id)
    if (!clone) throw new Error('Expected cloned frame')
    const clonedChildren = graph.getChildren(clone.id)
    const clonedDestination = clonedChildren.find((node) => node.name === destination.name)
    const clonedOverlay = clonedChildren.find((node) => node.name === overlay.name)
    const clonedSource = clonedChildren.find((node) => node.name === source.name)

    expect(clonedSource?.prototype).not.toBe(source.prototype)
    expect(clonedSource?.prototype?.connections[0]?.action).toEqual({
      kind: 'navigate',
      targetNodeId: clonedDestination?.id
    })
    expect(clonedSource?.prototype?.connections[1]?.action).toMatchObject({
      kind: 'openOverlay',
      targetNodeId: clonedOverlay?.id
    })
    expect(clonedSource?.transitionKey).toBe('heroSource')
    expect(clonedDestination?.transitionKey).toBe('heroDestination')
    expect(source.prototype?.connections[0]?.action).toEqual({
      kind: 'navigate',
      targetNodeId: destination.id
    })
  })

  test('fails closed for future, unknown, unsafe, duplicate, and unbounded payloads', () => {
    const source = prototypeSpec()
    const first = source.connections[0]
    if (!first) throw new Error('Expected connection')
    const cyclic: Record<string, unknown> = { ...source }
    cyclic.self = cyclic
    const candidates: unknown[] = [
      { ...source, version: 2 },
      { ...source, onNavigate: 'script' },
      { ...source, connections: [{ ...first, id: '__proto__' }] },
      { ...source, connections: [first, { ...first }] },
      {
        ...source,
        connections: [
          {
            ...first,
            trigger: { kind: 'afterDelay', delayMs: PROTOTYPE_LIMITS.afterDelayMs.max + 1 }
          }
        ]
      },
      {
        ...source,
        connections: [
          {
            ...first,
            transition: { kind: 'dissolve', durationMs: 0, easing: 'linear' }
          }
        ]
      },
      {
        ...source,
        connections: [
          {
            ...first,
            transition: {
              kind: 'smartMatch',
              durationMs: 100,
              easing: { type: 'cubicBezier', x1: 2, y1: 0, x2: 1, y2: 1 },
              fallback: 'dissolve'
            }
          }
        ]
      },
      {
        ...source,
        connections: [
          {
            ...first,
            action: { kind: 'navigate', targetNodeId: 'javascript' }
          }
        ]
      },
      cyclic,
      Object.assign(Object.create({ inherited: true }), source)
    ]
    for (const candidate of candidates) {
      expect(validatePrototypeSpec(candidate).success).toBe(false)
    }
  })

  test('enforces the global connection resource limit', () => {
    const first = prototypeSpec().connections[0]
    if (!first) throw new Error('Expected connection')
    expect(
      validatePrototypeSpec({
        version: 1,
        connections: Array.from({ length: PROTOTYPE_LIMITS.maxConnections + 1 }, (_, index) => ({
          ...first,
          id: `connection${index}`
        }))
      }).success
    ).toBe(false)
  })
})

describe('Motion transition keys', () => {
  test('canonicalizes and validates an explicit safe key', () => {
    expect(parseMotionTransitionKey('  heroImage  ')).toBe('heroImage')
    expect(validateMotionTransitionKey('heroImage')).toEqual({
      success: true,
      value: 'heroImage'
    })
  })

  test('rejects empty, unsafe, executable-looking, and oversized keys', () => {
    for (const value of ['', '1hero', '__proto__', 'javascript', 'hero image', 'x'.repeat(65), 1]) {
      expect(validateMotionTransitionKey(value).success).toBe(false)
    }
  })

  test('cloneTree fails closed instead of propagating a malformed key', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected page')
    const node = graph.createNode('RECTANGLE', page.id, { transitionKey: 'hero image' })
    expect(() => graph.cloneTree(node.id, page.id)).toThrow()
  })
})
