import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { parsePenFile, serializePenFile } from '@open-pencil/pen'
import type { MotionSpec } from '@open-pencil/scene-graph'

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

function autoLayoutComponentSource(): string {
  return `${JSON.stringify(
    {
      version: '2.14',
      children: [
        {
          id: 'component',
          type: 'frame',
          name: 'Component',
          reusable: true,
          layout: 'horizontal',
          padding: 8,
          gap: 4,
          children: [
            {
              id: 'child',
              type: 'rectangle',
              name: 'Child',
              width: 20,
              height: 10
            }
          ]
        },
        {
          id: 'instance',
          type: 'ref',
          name: 'Instance',
          ref: 'component',
          x: 80,
          y: 0
        }
      ]
    },
    null,
    2
  )}\n`
}

describe('.pen source-preserving write guard', () => {
  test('allows a real Editor to update Motion on an auto-layout component', async () => {
    const next = motion()
    const graph = parsePenFile(autoLayoutComponentSource())
    const editor = createEditor({ graph })

    editor.updateNode('component', { motion: next })
    await Promise.resolve()

    expect(graph.getNode('component')?.source.editedFields).toEqual(['motion'])
    expect(graph.getNode('child')?.source.editedFields).toEqual([])

    const reparsed = parsePenFile(serializePenFile(graph))
    expect(reparsed.getNode('component')?.motion).toEqual(next)
    expect(reparsed.getNode('instance')?.motion).toEqual(next)
  })

  test('allows the derived root-instance override authored with Motion', () => {
    const next = motion()
    const graph = parsePenFile(autoLayoutComponentSource())

    graph.updateNode('instance', {
      motion: next,
      overrides: { motion: structuredClone(next) }
    })

    expect(parsePenFile(serializePenFile(graph)).getNode('instance')?.motion).toEqual(next)
  })

  test('allows the derived root-instance tombstone when clearing Motion', () => {
    const next = motion()
    const initial = parsePenFile(autoLayoutComponentSource())
    initial.updateNode('instance', {
      motion: next,
      overrides: { motion: structuredClone(next) }
    })
    const graph = parsePenFile(serializePenFile(initial))
    const editor = createEditor({ graph })

    editor.updateNodeWithUndo(
      'instance',
      { motion: undefined, overrides: { motion: null } },
      'Clear motion'
    )

    expect(parsePenFile(serializePenFile(graph)).getNode('instance')?.motion).toBeUndefined()
  })

  test('rejects a root-instance override that does not match Motion', () => {
    const next = motion()
    const mismatched = structuredClone(next)
    const firstTrack = mismatched.tracks[0]
    if (!firstTrack) throw new Error('Expected a Motion track')
    firstTrack.timing.durationMs = 400
    const graph = parsePenFile(autoLayoutComponentSource())

    graph.updateNode('instance', {
      motion: next,
      overrides: { motion: mismatched }
    })

    expect(() => serializePenFile(graph)).toThrow(/unsupported edits \(overrides\)/)
  })

  test('rejects a root-instance Motion override without a matching Motion edit', () => {
    const graph = parsePenFile(autoLayoutComponentSource())

    graph.updateNode('instance', { overrides: { motion: null } })

    expect(() => serializePenFile(graph)).toThrow(/unsupported edits \(overrides\)/)
  })

  test('still rejects explicit Editor layout edits', async () => {
    const graph = parsePenFile(autoLayoutComponentSource())
    const editor = createEditor({ graph })

    editor.updateNode('component', { paddingLeft: 24 })
    await Promise.resolve()

    expect(() => serializePenFile(graph)).toThrow(/unsupported edits \(paddingLeft\)/)
  })

  test('rejects document color-space edits', () => {
    const graph = parsePenFile(autoLayoutComponentSource())
    const editor = createEditor({ graph })

    expect(graph.documentColorSpace).toBe('display-p3')
    editor.setDocumentColorSpace('srgb')

    expect(() => serializePenFile(graph)).toThrow(/document metadata or variables changed/)
  })
})
