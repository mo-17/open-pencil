import { describe, expect, test } from 'bun:test'

import { parsePenFile, serializePenFile } from '@open-pencil/pen'
import type {
  MotionDriverSpecV1,
  MotionSceneSpec,
  MotionSpec,
  PrototypeSpecV1
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

function motion(): MotionSpec {
  return {
    version: 3,
    tracks: [
      {
        id: 'heroMove',
        name: 'Hero move',
        trigger: 'pageEnter',
        keyframes: [
          { id: 'kf_start', offset: 0, x: 0 },
          { id: 'kf_end', offset: 1, x: 120 }
        ],
        timing: { durationMs: 400, fill: 'both' },
        composition: { mode: 'replace', weight: 1, priority: 0 }
      }
    ]
  }
}

function scene(): MotionSceneSpec {
  return {
    version: 1,
    id: 'sceneTimeline',
    sequences: [
      {
        id: 'intro',
        trigger: 'pageEnter',
        cues: [
          {
            id: 'heroCue',
            targetNodeId: 'hero',
            trackId: 'heroMove',
            startMs: 120
          }
        ],
        markers: [{ id: 'settled', timeMs: 520, label: 'Settled' }]
      }
    ]
  }
}

function drivers(): MotionDriverSpecV1 {
  return {
    version: 1,
    drivers: [
      {
        id: 'scrollHero',
        source: { kind: 'scroll', sourceNodeId: 'scene', axis: 'y', metric: 'progress' },
        target: { targetNodeId: 'hero', trackId: 'heroMove' },
        mapping: { inputMin: 0, inputMax: 1, clamp: true }
      }
    ]
  }
}

function prototype(): PrototypeSpecV1 {
  return {
    version: 1,
    connections: [
      {
        id: 'openNext',
        trigger: { kind: 'click' },
        action: { kind: 'navigate', targetNodeId: 'next' },
        transition: {
          kind: 'smartMatch',
          durationMs: 320,
          easing: 'ease-out',
          fallback: 'dissolve'
        }
      }
    ]
  }
}

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'navigation',
    href: '/scene',
    openPencil: {
      schemaVersion: 2,
      motionScene: scene(),
      motionDrivers: drivers(),
      prototype: prototype(),
      transitionKey: 'sceneHero',
      ...overrides
    }
  }
}

function source(sceneMetadata: unknown = metadata()): string {
  return `${JSON.stringify(
    {
      version: '2.14',
      children: [
        {
          id: 'scene',
          type: 'frame',
          width: 390,
          height: 844,
          metadata: sceneMetadata,
          children: [
            {
              id: 'hero',
              type: 'rectangle',
              width: 100,
              height: 100,
              metadata: {
                type: 'open-pencil',
                openPencil: { schemaVersion: 1, motion: motion() }
              }
            }
          ]
        },
        { id: 'next', type: 'frame', width: 390, height: 844 }
      ]
    },
    null,
    2
  )}\n`
}

interface SerializedPenDocument {
  children: unknown[]
}

interface SerializedPenNode {
  id?: unknown
  metadata?: unknown
}

interface SerializedSceneMetadata {
  type?: unknown
  href?: unknown
  openPencil?: unknown
}

function serializedScene(serialized: string): SerializedPenNode {
  const parsed: unknown = JSON.parse(serialized)
  if (!isSerializedPenDocument(parsed)) throw new Error('Expected serialized document')
  const node = parsed.children.find((candidate): candidate is SerializedPenNode =>
    isSerializedPenNode(candidate, 'scene')
  )
  if (!node) throw new Error('Expected scene')
  return node
}

function serializedSceneMetadata(serialized: string): SerializedSceneMetadata {
  const metadata = serializedScene(serialized).metadata
  if (!isSerializedSceneMetadata(metadata)) throw new Error('Expected scene metadata')
  return metadata
}

function isSerializedPenDocument(value: unknown): value is SerializedPenDocument {
  return isObject(value) && 'children' in value && Array.isArray(value.children)
}

function isSerializedPenNode(value: unknown, id: string): value is SerializedPenNode {
  return isObject(value) && 'id' in value && value.id === id
}

function isSerializedSceneMetadata(value: unknown): value is SerializedSceneMetadata {
  return isObject(value) && 'type' in value && 'openPencil' in value
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('.pen Motion contract schema v2', () => {
  test('reads and source-preserves scene, drivers, prototype, and Smart Match identity', () => {
    const input = source()
    const graph = parsePenFile(input)
    const node = graph.getNode('scene')

    expect(node?.motionScene).toEqual(scene())
    expect(node?.motionDrivers).toEqual(drivers())
    expect(node?.prototype).toEqual(prototype())
    expect(node?.transitionKey).toBe('sceneHero')
    expect(graph.getNode('hero')?.motion).toEqual(motion())
    expect(serializePenFile(graph)).toBe(input)
  })

  test('writes v2 edits without discarding foreign metadata or untouched contracts', () => {
    const graph = parsePenFile(source())
    const nextScene = scene()
    const intro = expectDefined(nextScene.sequences[0], 'intro sequence')
    const marker = expectDefined(expectDefined(intro.markers, 'intro markers')[0], 'intro marker')
    marker.label = 'Ready'
    const nextDrivers = drivers()
    expectDefined(nextDrivers.drivers[0], 'scroll driver').mapping.deadZone = 0.1
    graph.updateNode('scene', {
      motionScene: nextScene,
      motionDrivers: nextDrivers,
      transitionKey: 'sceneReady'
    })
    graph.clearNodeFields('scene', ['prototype'])

    const serialized = serializePenFile(graph)
    const rawMetadata = serializedSceneMetadata(serialized)
    expect(rawMetadata.type).toBe('navigation')
    expect(rawMetadata.href).toBe('/scene')
    expect(rawMetadata.openPencil).toEqual({
      schemaVersion: 2,
      motionScene: nextScene,
      motionDrivers: nextDrivers,
      transitionKey: 'sceneReady'
    })

    const reopened = parsePenFile(serialized).getNode('scene')
    expect(reopened?.motionScene).toEqual(nextScene)
    expect(reopened?.motionDrivers).toEqual(nextDrivers)
    expect(reopened?.prototype).toBeUndefined()
    expect(reopened?.transitionKey).toBe('sceneReady')
  })

  test('upgrades a legacy carrier only when a v2 contract field is authored', () => {
    const input = source({
      type: 'open-pencil',
      openPencil: { schemaVersion: 1, motion: motion() }
    })
    const graph = parsePenFile(input)
    graph.updateNode('scene', { transitionKey: 'legacyHero' })

    expect(serializedSceneMetadata(serializePenFile(graph)).openPencil).toEqual({
      schemaVersion: 2,
      motion: motion(),
      transitionKey: 'legacyHero'
    })
  })

  test('preserves future and malformed payloads inertly and rejects overlapping edits', () => {
    for (const payload of [
      { schemaVersion: 99, transitionKey: 'futureHero' },
      { schemaVersion: 2, transitionKey: '__proto__' },
      { schemaVersion: 2, prototype: prototype(), script: 'alert(1)' }
    ]) {
      const input = source({ type: 'open-pencil', openPencil: payload })
      const graph = parsePenFile(input)
      const node = graph.getNode('scene')
      expect(node?.motionScene).toBeUndefined()
      expect(node?.motionDrivers).toBeUndefined()
      expect(node?.prototype).toBeUndefined()
      expect(node?.transitionKey).toBeUndefined()
      expect(serializePenFile(graph)).toBe(input)
      graph.updateNode('scene', { transitionKey: 'replacement' })
      expect(() => serializePenFile(graph)).toThrow(/unsupported or malformed schema/)
    }
  })

  test('honors v2 null tombstones on reusable refs', () => {
    const input = `${JSON.stringify(
      {
        version: '2.14',
        children: [
          {
            id: 'component',
            type: 'frame',
            reusable: true,
            metadata: {
              type: 'open-pencil',
              openPencil: { schemaVersion: 2, transitionKey: 'componentHero' }
            }
          },
          {
            id: 'instance',
            type: 'ref',
            ref: 'component',
            metadata: {
              type: 'open-pencil',
              openPencil: { schemaVersion: 2, transitionKey: null }
            }
          }
        ]
      },
      null,
      2
    )}\n`
    const graph = parsePenFile(input)
    const instance = graph.getNode('instance')
    expect(graph.getNode('component')?.transitionKey).toBe('componentHero')
    expect(instance?.transitionKey).toBeUndefined()
    expect(instance?.overrides.transitionKey).toBeNull()
    graph.syncInstances('component')
    expect(graph.getNode('instance')?.transitionKey).toBeUndefined()
    expect(serializePenFile(graph)).toBe(input)
  })
})
