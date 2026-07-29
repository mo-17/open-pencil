import { describe, expect, test } from 'bun:test'

import { parsePenFile, serializePenFile } from '@open-pencil/pen'

import { expectDefined } from '#tests/helpers/assert'
import { generatedEffect } from '#tests/helpers/generated-effect'

function source(openPencil: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      version: '2.14',
      children: [
        {
          id: 'card',
          type: 'rectangle',
          width: 180,
          height: 100,
          metadata: { type: 'open-pencil', foreign: 'preserved', openPencil }
        }
      ]
    },
    null,
    2
  )}\n`
}

function serializedCarrier(serialized: string): Record<string, unknown> {
  const document = JSON.parse(serialized) as {
    children: Array<{ metadata?: { openPencil?: Record<string, unknown> } }>
  }
  return expectDefined(document.children[0]?.metadata?.openPencil, 'serialized OpenPencil metadata')
}

describe('.pen generated-effect schema v3', () => {
  test('reads and source-preserves a strict v3 layer', () => {
    const spec = generatedEffect('shimmer')
    const input = source({ schemaVersion: 3, generatedEffect: spec })
    const graph = parsePenFile(input)
    expect(graph.getNode('card')?.generatedEffect).toEqual(spec)
    expect(serializePenFile(graph)).toBe(input)
  })

  test('writes edits as v3 without discarding foreign metadata', () => {
    const graph = parsePenFile(source({ schemaVersion: 2, transitionKey: 'cardHero' }))
    const spec = generatedEffect('particles')
    graph.updateNode('card', { generatedEffect: spec })
    const serialized = serializePenFile(graph)
    expect(serializedCarrier(serialized)).toEqual({
      schemaVersion: 3,
      transitionKey: 'cardHero',
      generatedEffect: spec
    })
    const raw = JSON.parse(serialized) as {
      children: Array<{ metadata?: Record<string, unknown> }>
    }
    expect(raw.children[0]?.metadata?.foreign).toBe('preserved')
    expect(parsePenFile(serialized).getNode('card')?.generatedEffect).toEqual(spec)
  })

  test('writes and honors v3 null tombstones for reusable refs', () => {
    const componentSpec = generatedEffect('noise')
    const input = `${JSON.stringify(
      {
        version: '2.14',
        children: [
          {
            id: 'component',
            type: 'rectangle',
            reusable: true,
            width: 100,
            height: 100,
            metadata: {
              type: 'open-pencil',
              openPencil: { schemaVersion: 3, generatedEffect: componentSpec }
            }
          },
          {
            id: 'instance',
            type: 'ref',
            ref: 'component',
            metadata: {
              type: 'open-pencil',
              openPencil: { schemaVersion: 3, generatedEffect: null }
            }
          }
        ]
      },
      null,
      2
    )}\n`
    const graph = parsePenFile(input)
    expect(graph.getNode('component')?.generatedEffect).toEqual(componentSpec)
    expect(graph.getNode('instance')?.generatedEffect).toBeUndefined()
    expect(graph.getNode('instance')?.overrides.generatedEffect).toBeNull()
    graph.syncInstances('component')
    expect(graph.getNode('instance')?.generatedEffect).toBeUndefined()
    expect(serializePenFile(graph)).toBe(input)
  })

  test('keeps future and malformed layers inert and rejects overlapping edits', () => {
    for (const payload of [
      { schemaVersion: 99, generatedEffect: generatedEffect() },
      { schemaVersion: 3, generatedEffect: { ...generatedEffect(), version: 2 } },
      { schemaVersion: 3, generatedEffect: generatedEffect(), shader: 'main() {}' }
    ]) {
      const input = source(payload)
      const graph = parsePenFile(input)
      expect(graph.getNode('card')?.generatedEffect).toBeUndefined()
      expect(serializePenFile(graph)).toBe(input)
      graph.updateNode('card', { generatedEffect: generatedEffect('scanlines') })
      expect(() => serializePenFile(graph)).toThrow(/unsupported or malformed schema/)
    }
  })
})
