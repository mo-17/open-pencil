import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { parseFigFile } from '@open-pencil/core/kiwi'
import { parseFigBuffer } from '@open-pencil/fig'
import { resolvedPaintBindings } from '@open-pencil/scene-graph'
import type { SceneGraph } from '@open-pencil/scene-graph'

const fixture = resolve('packages/fig/tests/fixtures/legacy-color-binding.fig')

function target(graph: SceneGraph) {
  const node = [...graph.getAllNodes()].find((candidate) =>
    candidate.name.startsWith('Legacy fill')
  )
  if (!node) throw new Error('Missing legacy color fixture node')
  return node
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

test('legacy codec aliases survive an edited unique copy, mode changes and explicit unbinding', async () => {
  const input = readFileSync(fixture)
  const digest = createHash('sha256').update(input).digest('hex')
  const output = mkdtempSync(join(tmpdir(), 'open-pencil-legacy-roundtrip-'))
  const graph = await parseFigFile(buffer(input))
  const node = target(graph)
  const foreign = { pluginId: 'foreign-fixture', key: 'unknown-key', value: 'keep UTF-8 原值' }
  graph.updateNode(node.id, {
    name: 'Legacy fill edited',
    pluginData: [...node.pluginData, foreign]
  })
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Missing document root')
  graph.updateNode(root.id, { pluginData: [...root.pluginData, foreign] })

  const boundPath = join(output, 'bound.fig')
  writeFileSync(boundPath, await exportFigFile(graph))
  const boundBytes = readFileSync(boundPath)
  const decoded = parseFigBuffer(buffer(boundBytes))
  const record = decoded.nodeChanges.find((candidate) => candidate.name === 'Legacy fill edited')
  if (!record) throw new Error('Missing edited output record')
  for (const paint of [...(record.fillPaints ?? []), ...(record.strokePaints ?? [])]) {
    expect(paint.colorVar).toBeUndefined()
    expect(Reflect.get(paint, 'colorVariableBinding')).toHaveProperty('variableID')
  }
  const reopened = await parseFigFile(buffer(boundBytes))
  const restored = target(reopened)
  const variableId = restored.boundVariables['fills/0/color']
  expect(restored.boundVariables['strokes/0/color']).toBe(variableId)
  const variable = reopened.variables.get(variableId)
  if (!variable) throw new Error('Binding must point to a real exported variable')
  const collection = reopened.variableCollections.get(variable.collectionId)
  if (!collection) throw new Error('Missing exported variable collection')
  const dark = collection.modes.find((mode) => mode.name === 'Dark')
  if (!dark) throw new Error('Missing exported Dark mode')
  reopened.setActiveMode(collection.id, dark.modeId)
  const resolved = resolvedPaintBindings(reopened, restored)
  expect(resolved.fills?.[0].color).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  expect(resolved.strokes?.[0].color).toEqual({ r: 0, g: 0, b: 1, a: 1 })
  expect(restored.pluginData).toContainEqual(foreign)
  expect(reopened.getNode(reopened.rootId)?.pluginData).toContainEqual(foreign)

  reopened.updateNode(restored.id, { boundVariables: {} })
  const unboundPath = join(output, 'unbound.fig')
  writeFileSync(unboundPath, await exportFigFile(reopened))
  const unboundBytes = readFileSync(unboundPath)
  const unboundRecord = parseFigBuffer(buffer(unboundBytes)).nodeChanges.find(
    (candidate) => candidate.name === restored.name
  )
  if (!unboundRecord) throw new Error('Missing unbound output record')
  for (const paint of [
    ...(unboundRecord.fillPaints ?? []),
    ...(unboundRecord.strokePaints ?? [])
  ]) {
    expect(paint.colorVar).toBeUndefined()
    expect(Reflect.get(paint, 'colorVariableBinding')).toBeUndefined()
  }
  const unbound = await parseFigFile(buffer(unboundBytes))
  expect(target(unbound).boundVariables).toEqual({})
  expect(target(unbound).pluginData).toContainEqual(foreign)
  expect(createHash('sha256').update(readFileSync(fixture)).digest('hex')).toBe(digest)
  console.info(JSON.stringify({ inputSha256: digest, boundPath, unboundPath }))
})
