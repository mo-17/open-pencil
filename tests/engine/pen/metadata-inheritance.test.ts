import { describe, expect, test } from 'bun:test'

import { parsePenFile, serializePenFile } from '@open-pencil/pen'
import type { MotionSpec, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

function motion(id: string, distance = 24): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id,
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0, x: distance },
          { offset: 1, opacity: 1, x: 0 }
        ],
        timing: { durationMs: 240, easing: 'ease-out' }
      }
    ]
  }
}

function motionMetadata(value: MotionSpec | null): Record<string, unknown> {
  return {
    type: 'open-pencil',
    openPencil: { schemaVersion: 1, motion: value }
  }
}

interface ComponentSourceOptions {
  refMetadata?: unknown
  descendantMetadata?: unknown
}

function componentSource(options: ComponentSourceOptions = {}): string {
  const ref = {
    id: 'card-instance',
    type: 'ref',
    ref: 'animated-card',
    ...(options.refMetadata === undefined ? {} : { metadata: options.refMetadata }),
    ...(options.descendantMetadata === undefined
      ? {}
      : {
          descendants: {
            'body/label': { metadata: options.descendantMetadata }
          }
        })
  }
  return `${JSON.stringify(
    {
      version: '2.14',
      children: [
        {
          id: 'animated-card',
          type: 'frame',
          reusable: true,
          width: 200,
          height: 120,
          metadata: motionMetadata(motion('component-root')),
          children: [
            {
              id: 'body',
              type: 'frame',
              children: [
                {
                  id: 'label',
                  type: 'text',
                  content: 'Label',
                  metadata: motionMetadata(motion('component-label'))
                }
              ]
            }
          ]
        },
        ref
      ]
    },
    null,
    2
  )}\n`
}

function requireNode(graph: SceneGraph, id: string): SceneNode {
  const node = graph.getNode(id)
  if (!node) throw new Error(`Expected node ${id}`)
  return node
}

function findInstanceDescendant(
  graph: SceneGraph,
  parentId: string,
  componentId: string
): SceneNode {
  for (const child of graph.getChildren(parentId)) {
    if (child.componentId === componentId) return child
    if (child.childIds.length > 0) {
      const match = findOptionalInstanceDescendant(graph, child.id, componentId)
      if (match) return match
    }
  }
  throw new Error(`Expected an instance descendant for ${componentId}`)
}

function findOptionalInstanceDescendant(
  graph: SceneGraph,
  parentId: string,
  componentId: string
): SceneNode | undefined {
  for (const child of graph.getChildren(parentId)) {
    if (child.componentId === componentId) return child
    const match = findOptionalInstanceDescendant(graph, child.id, componentId)
    if (match) return match
  }
  return undefined
}

describe('.pen component Motion metadata inheritance', () => {
  test('keeps root and nested descendant inheritance through unrelated own metadata', () => {
    const input = componentSource({
      refMetadata: { type: 'navigation', href: '/card' },
      descendantMetadata: { type: 'analytics', event: 'label-viewed' }
    })
    const graph = parsePenFile(input)
    const instance = requireNode(graph, 'card-instance')
    const label = findInstanceDescendant(graph, instance.id, 'label')

    expect(instance.motion).toEqual(motion('component-root'))
    expect(label.motion).toEqual(motion('component-label'))
    expect(Object.hasOwn(instance.overrides, 'motion')).toBe(false)
    expect(Object.hasOwn(instance.overrides, `${label.id}:motion`)).toBe(false)

    graph.syncInstances('animated-card')
    expect(requireNode(graph, 'card-instance').motion).toEqual(motion('component-root'))
    expect(findInstanceDescendant(graph, instance.id, 'label').motion).toEqual(
      motion('component-label')
    )
    expect(serializePenFile(graph)).toBe(input)
  })

  test.each([
    [
      'future',
      {
        type: 'open-pencil',
        openPencil: { schemaVersion: 2, motion: motion('future'), futureField: true }
      }
    ],
    [
      'malformed',
      {
        type: 'open-pencil',
        openPencil: { schemaVersion: 1, motion: { version: 1, tracks: [] } }
      }
    ],
    [
      'missing-type',
      {
        openPencil: { schemaVersion: 1, motion: motion('untrusted-without-type') }
      }
    ]
  ])('suppresses inheritance while preserving %s own metadata as inert', (_name, metadata) => {
    const input = componentSource({
      refMetadata: metadata,
      descendantMetadata: metadata
    })
    const graph = parsePenFile(input)
    const instance = requireNode(graph, 'card-instance')
    const label = findInstanceDescendant(graph, instance.id, 'label')

    expect(instance.motion).toBeUndefined()
    expect(instance.overrides.motion).toBeNull()
    expect(label.motion).toBeUndefined()
    expect(instance.overrides[`${label.id}:motion`]).toBeNull()
    graph.syncInstances('animated-card')
    expect(requireNode(graph, instance.id).motion).toBeUndefined()
    expect(findInstanceDescendant(graph, instance.id, 'label').motion).toBeUndefined()
    expect(serializePenFile(graph)).toBe(input)
  })

  test('applies explicit root and ID-path descendant overrides across instance sync', () => {
    const rootOverride = motion('instance-root', 40)
    const labelOverride = motion('instance-label', 56)
    const input = componentSource({
      refMetadata: motionMetadata(rootOverride),
      descendantMetadata: motionMetadata(labelOverride)
    })
    const graph = parsePenFile(input)
    const instance = requireNode(graph, 'card-instance')
    const label = findInstanceDescendant(graph, instance.id, 'label')

    expect(instance.motion).toEqual(rootOverride)
    expect(instance.overrides.motion).toEqual(rootOverride)
    expect(label.motion).toEqual(labelOverride)
    expect(instance.overrides[`${label.id}:motion`]).toEqual(labelOverride)

    graph.syncInstances('animated-card')
    expect(requireNode(graph, 'card-instance').motion).toEqual(rootOverride)
    expect(findInstanceDescendant(graph, instance.id, 'label').motion).toEqual(labelOverride)
    expect(serializePenFile(graph)).toBe(input)
  })

  test('round-trips explicit null tombstones for a ref and nested descendant', () => {
    const input = componentSource({
      refMetadata: motionMetadata(null),
      descendantMetadata: motionMetadata(null)
    })
    const graph = parsePenFile(input)
    const instance = requireNode(graph, 'card-instance')
    const label = findInstanceDescendant(graph, instance.id, 'label')

    expect(instance.motion).toBeUndefined()
    expect(instance.overrides.motion).toBeNull()
    expect(label.motion).toBeUndefined()
    expect(instance.overrides[`${label.id}:motion`]).toBeNull()

    graph.syncInstances('animated-card')
    expect(requireNode(graph, 'card-instance').motion).toBeUndefined()
    expect(findInstanceDescendant(graph, instance.id, 'label').motion).toBeUndefined()
    expect(serializePenFile(graph)).toBe(input)
  })

  test('writes an instance clear as a tombstone while preserving foreign metadata', () => {
    const foreignMetadata = { type: 'navigation', href: '/card', owner: 'product' }
    const graph = parsePenFile(componentSource({ refMetadata: foreignMetadata }))
    const instance = requireNode(graph, 'card-instance')
    expect(instance.motion).toEqual(motion('component-root'))

    graph.updateNode(instance.id, { overrides: { motion: null } })
    graph.clearNodeFields(instance.id, ['motion'])

    const serialized = serializePenFile(graph)
    const document = JSON.parse(serialized) as {
      children: Array<{ id: string; metadata?: unknown }>
    }
    const rawInstance = document.children.find((node) => node.id === instance.id)
    expect(rawInstance?.metadata).toEqual({
      ...foreignMetadata,
      openPencil: { schemaVersion: 1, motion: null }
    })

    const reopened = parsePenFile(serialized)
    const reopenedInstance = requireNode(reopened, instance.id)
    expect(reopenedInstance.motion).toBeUndefined()
    expect(reopenedInstance.overrides.motion).toBeNull()
    reopened.syncInstances('animated-card')
    expect(requireNode(reopened, instance.id).motion).toBeUndefined()
  })
})
