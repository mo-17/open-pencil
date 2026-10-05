import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { materializeFigArchive, parseFigBuffer } from '#fig/index'

import { resolvedPaintBindings } from '@open-pencil/scene-graph'

test('embedded legacy schema decodes fill and stroke bindings without alternate recovery data', () => {
  const bytes = readFileSync(new URL('../fixtures/legacy-color-binding.fig', import.meta.url))
  const digest = createHash('sha256').update(bytes).digest('hex')
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const decoded = parseFigBuffer(input)
  const record = decoded.nodeChanges.find((node) => node.name === 'Legacy fill and stroke')
  if (!record) throw new Error('Missing legacy fixture record')
  expect(record.pluginData ?? []).toHaveLength(0)
  for (const paint of [...(record.fillPaints ?? []), ...(record.strokePaints ?? [])]) {
    expect(paint.colorVar).toBeUndefined()
    expect(Reflect.get(paint, 'colorVariableBinding')).toEqual({
      variableID: { sessionID: 1, localID: 4 }
    })
  }
  const { graph, sources } = materializeFigArchive(input)
  const node = graph.getNode(sources.get('1:5') ?? '')
  if (!node) throw new Error('Missing legacy fixture scene node')
  expect(node.boundVariables).toEqual({ 'fills/0/color': '1:4', 'strokes/0/color': '1:4' })
  expect(graph.variables.has('1:4')).toBe(true)
  expect(graph.resolveColorVariableForNode(node.id, '1:4')).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  graph.setActiveMode('1:3', '1:11')
  const dark = resolvedPaintBindings(graph, node)
  expect(dark.fills?.[0].color).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  expect(dark.strokes?.[0].color).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  expect(
    createHash('sha256')
      .update(readFileSync(new URL('../fixtures/legacy-color-binding.fig', import.meta.url)))
      .digest('hex')
  ).toBe(digest)
})
