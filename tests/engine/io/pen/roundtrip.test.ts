import { describe, expect, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry, penFormat } from '@open-pencil/core/io'
import { parsePenFile } from '@open-pencil/pen'
import type { MotionSpec } from '@open-pencil/scene-graph'

function source(): string {
  return `${JSON.stringify(
    {
      version: '2.14',
      children: [
        {
          id: 'card',
          type: 'rectangle',
          name: 'Card',
          x: 12,
          y: 20,
          width: 120,
          height: 80
        }
      ]
    },
    null,
    2
  )}\n`
}

function motion(): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'enter',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 200, easing: 'linear' }
      }
    ]
  }
}

function outputText(data: string | Uint8Array): string {
  return typeof data === 'string' ? data : new TextDecoder().decode(data)
}

describe('.pen document IO', () => {
  test('penFormat reads and writes UTF-8 JSON with the expected MIME metadata', async () => {
    const next = motion()
    const graph = parsePenFile(source())
    graph.updateNode('card', { motion: next })

    expect(penFormat.support.readDocument).toBe(true)
    expect(penFormat.support.writeDocument).toBe(true)

    const writeDocument = penFormat.writeDocument
    const readDocument = penFormat.readDocument
    if (!writeDocument || !readDocument) throw new Error('Expected .pen read/write adapters')

    const written = await writeDocument(graph)
    expect(written.format).toBe('pen')
    expect(written.mimeType).toBe('application/json')
    expect(written.extension).toBe('pen')
    expect(written.encoding).toBe('utf8')
    expect(typeof written.data).toBe('string')

    const read = await readDocument({
      name: 'card.pen',
      mimeType: written.mimeType,
      data: new TextEncoder().encode(outputText(written.data))
    })
    expect(read.sourceFormat).toBe('pen')
    expect(read.graph.getNode('card')?.motion).toEqual(next)
  })

  test('registers .pen as a writable document format in the builtin IO registry', async () => {
    const registry = new IORegistry(BUILTIN_IO_FORMATS)
    const next = motion()
    const graph = parsePenFile(source())
    graph.updateNode('card', { motion: next })

    expect(registry.listWritableFormats().map((format) => format.id)).toContain('pen')

    const written = await registry.writeDocument('pen', graph)
    const read = await registry.readDocument({
      name: 'roundtrip.pen',
      data: new TextEncoder().encode(outputText(written.data))
    })

    expect(written.mimeType).toBe('application/json')
    expect(written.encoding).toBe('utf8')
    expect(read.sourceFormat).toBe('pen')
    expect(read.graph.getNode('card')?.motion).toEqual(next)
  })
})
