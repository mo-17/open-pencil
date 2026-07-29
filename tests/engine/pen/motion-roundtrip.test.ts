import { describe, expect, test } from 'bun:test'

import { parsePenFile, serializePenFile } from '@open-pencil/pen'
import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { advancedMotionSpec } from '#tests/helpers/motion-v3-advanced'
import { repoPath } from '#tests/helpers/paths'

function motion(id: string, distance = 24): MotionSpec {
  return {
    version: 2,
    reducedMotion: 'reduce',
    tracks: [
      {
        id,
        trigger: 'mount',
        keyframes: [
          {
            offset: 0,
            opacity: 0,
            x: distance,
            width: 120,
            fillColor: { r: 1, g: 0.2, b: 0, a: 1 },
            pathProgress: 0
          },
          {
            offset: 1,
            opacity: 1,
            x: 0,
            width: 180,
            fillColor: { r: 0, g: 0.4, b: 1, a: 1 },
            pathProgress: 1
          }
        ],
        timing: {
          durationMs: 320,
          delayMs: 40,
          easing: { type: 'spring', mass: 1, stiffness: 170, damping: 26, velocity: 0 },
          fill: 'both'
        },
        exit: 'reset',
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 80, y: 20 }
          ],
          autoRotate: true
        }
      }
    ],
    preset: {
      id: `${id}-preset`,
      version: 2,
      parameters: {}
    }
  }
}

function source(metadata?: unknown): string {
  const node = {
    id: 'card',
    type: 'rectangle',
    name: 'Card',
    x: 12,
    y: 20,
    width: 120,
    height: 80,
    ...(metadata === undefined ? {} : { metadata })
  }

  return `${JSON.stringify({ version: '2.14', children: [node] }, null, 2)}\n`
}

function serializedCard(serialized: string): Record<string, unknown> {
  const parsed = JSON.parse(serialized) as {
    children: Record<string, unknown>[]
  }
  const card = parsed.children[0]
  if (!card) throw new Error('Expected a serialized card node')
  return card
}

function motionCarrier(spec: MotionSpec): Record<string, unknown> {
  return {
    type: 'open-pencil',
    openPencil: {
      schemaVersion: 1,
      motion: spec
    }
  }
}

describe('.pen Motion metadata round trip', () => {
  test('sets Motion metadata on a legacy node', () => {
    const graph = parsePenFile(source())
    const next = motion('enter')

    graph.updateNode('card', { motion: next })

    const serialized = serializePenFile(graph)
    expect(serializedCard(serialized).metadata).toEqual(motionCarrier(next))
    expect(parsePenFile(serialized).getNode('card')?.motion).toEqual(next)
  })

  test('preserves every MotionSpec v3 structured channel', () => {
    const graph = parsePenFile(source())
    const next = advancedMotionSpec()

    graph.updateNode('card', { motion: next })

    const serialized = serializePenFile(graph)
    expect(serializedCard(serialized).metadata).toEqual(motionCarrier(next))
    expect(parsePenFile(serialized).getNode('card')?.motion).toEqual(next)
  })

  test('replaces valid OpenPencil Motion metadata', () => {
    const initial = motion('initial')
    const replacement = motion('replacement', 48)
    const graph = parsePenFile(source(motionCarrier(initial)))

    expect(graph.getNode('card')?.motion).toEqual(initial)
    graph.updateNode('card', { motion: replacement })

    const serialized = serializePenFile(graph)
    expect(serializedCard(serialized).metadata).toEqual(motionCarrier(replacement))
    expect(parsePenFile(serialized).getNode('card')?.motion).toEqual(replacement)
  })

  test('clears valid OpenPencil Motion metadata without leaving an empty carrier', () => {
    const graph = parsePenFile(source(motionCarrier(motion('clear-me'))))

    graph.clearNodeFields('card', ['motion'])

    const serialized = serializePenFile(graph)
    expect(serializedCard(serialized).metadata).toBeUndefined()
    expect(parsePenFile(serialized).getNode('card')?.motion).toBeUndefined()
  })

  test('preserves foreign metadata while adding Motion metadata', () => {
    const foreignMetadata = {
      type: 'navigation',
      href: '/docs',
      extra: { owner: 'team' }
    }
    const next = motion('foreign')
    const graph = parsePenFile(source(foreignMetadata))

    graph.updateNode('card', { motion: next })

    expect(serializedCard(serializePenFile(graph)).metadata).toEqual({
      ...foreignMetadata,
      openPencil: {
        schemaVersion: 1,
        motion: next
      }
    })
  })

  test.each([
    [
      'future-version',
      {
        schemaVersion: 2,
        motion: motion('future'),
        futureField: 'keep-me'
      }
    ],
    [
      'malformed',
      {
        schemaVersion: 1,
        motion: { version: 1, tracks: [] }
      }
    ]
  ])('rejects Motion edits over %s OpenPencil metadata', (_name, raw) => {
    const metadata = { type: 'open-pencil', openPencil: raw }
    const input = source(metadata)
    const graph = parsePenFile(input)

    expect(graph.getNode('card')?.motion).toBeUndefined()
    expect(serializePenFile(graph)).toBe(input)
    graph.updateNode('card', { motion: motion('attempted-replacement') })

    expect(() => serializePenFile(graph)).toThrow(/unsupported or malformed schema/)
  })

  test.each([null, { href: '/missing-type' }, { type: '' }])(
    'rejects Motion edits over non-standard metadata %#',
    (metadata) => {
      const input = source(metadata)
      const graph = parsePenFile(input)

      expect(serializePenFile(graph)).toBe(input)
      graph.updateNode('card', { motion: motion('attempted-replacement') })

      expect(() => serializePenFile(graph)).toThrow(/metadata must be an object/)
    }
  )

  test('treats an OpenPencil payload without a valid outer type as inert', () => {
    const metadata = {
      openPencil: { schemaVersion: 1, motion: motion('untrusted') }
    }
    const input = source(metadata)
    const graph = parsePenFile(input)

    expect(graph.getNode('card')?.motion).toBeUndefined()
    expect(serializePenFile(graph)).toBe(input)
    graph.updateNode('card', { motion: motion('attempted-replacement') })

    expect(() => serializePenFile(graph)).toThrow(/unsupported or malformed schema/)
  })

  test('rejects source-less graphs', () => {
    expect(() => serializePenFile(new SceneGraph())).toThrow(/requires a graph imported from \.pen/)
  })

  test('rejects structural edits', () => {
    const graph = parsePenFile(source())
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected a page')
    graph.createNode('RECTANGLE', page.id, {
      type: 'RECTANGLE',
      name: 'Added',
      x: 0,
      y: 0,
      width: 10,
      height: 10
    })

    expect(() => serializePenFile(graph)).toThrow(/structure changed/)
  })

  test('rejects non-Motion node edits', () => {
    const graph = parsePenFile(source())
    graph.updateNode('card', { x: 99 })

    expect(() => serializePenFile(graph)).toThrow(/unsupported edits \(x\)/)
  })

  test('does not add metadata noise to existing legacy fixtures', async () => {
    for (const fixture of ['pencil_simple.pen', 'pencil_button.pen']) {
      const input = await Bun.file(repoPath('tests', 'fixtures', fixture)).text()
      const graph = parsePenFile(input)

      expect(graph.getAllNodes().every((node) => node.motion === undefined)).toBe(true)
      expect(serializePenFile(graph)).toBe(input)
    }
  })
})
