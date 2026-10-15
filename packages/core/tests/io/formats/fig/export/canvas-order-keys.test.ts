import { expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { exportFigFile } from '#core/io'
import { initCodec } from '#core/kiwi'

function positionsByParent(nodeChanges: readonly { parentIndex?: unknown }[]) {
  const byParent = new Map<string, string[]>()
  for (const change of nodeChanges) {
    const parentIndex = change.parentIndex as { guid?: GUID; position?: string } | undefined
    const parent = parentIndex?.guid
    if (!parent || parentIndex?.position === undefined) continue
    const key = `${parent.sessionID}:${parent.localID}`
    byParent.set(key, [...(byParent.get(key) ?? []), parentIndex.position])
  }
  return byParent
}

/**
 * Figma orders siblings by `parentIndex.position`. A canvas's own layers, its shared styles
 * and the variable records are written in three separate passes, and an internal canvas
 * receives all three, so each has to continue the keys the others already wrote.
 */
test('every child of a canvas is exported with its own order key', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  for (const name of ['One', 'Two', 'Three']) graph.createNode('FRAME', page.id, { name })

  // An internal canvas carrying ordinary layers, so its own pass meets the appended ones.
  const internal = graph.addPage('Internal resources')
  graph.updateNode(internal.id, { internalOnly: true })
  for (const name of ['Cached A', 'Cached B']) graph.createNode('FRAME', internal.id, { name })
  graph.createNode('TEXT', internal.id, {
    name: 'Shared typography',
    sharedStyleType: 'TEXT',
    text: 'Ag'
  })

  // Two collections, so the variable pass spans more than one group of records.
  for (const [collectionName, variableName] of [
    ['Tokens', 'Accent'],
    ['Spacing', 'Gutter']
  ]) {
    const collection = graph.createCollection(collectionName)
    graph.createVariable(variableName, 'FLOAT', collection.id, 8)
    graph.createVariable(`${variableName} alt`, 'FLOAT', collection.id, 16)
  }

  const bytes = await exportFigFile(graph)
  const { nodeChanges } = parseFigBuffer(bytes.buffer as ArrayBuffer)
  const byParent = positionsByParent(nodeChanges)

  // The internal canvas is the parent all three passes write to.
  const internalCanvas = nodeChanges.find((change) => change.name === 'Internal resources')
  const internalKey = internalCanvas?.guid
    ? `${internalCanvas.guid.sessionID}:${internalCanvas.guid.localID}`
    : ''
  expect(byParent.get(internalKey)?.length ?? 0).toBeGreaterThan(5)

  for (const [parent, positions] of byParent)
    expect([parent, new Set(positions).size]).toEqual([parent, positions.length])
})

test('canvas resources follow retained native layer keys without collisions', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const internal = graph.addPage('Native resources')
  graph.updateNode(internal.id, { internalOnly: true })
  const layer = graph.createNode('FRAME', internal.id, { name: 'Native layer' })
  layer.source.format = 'fig'
  layer.source.orderKey = '~z'
  graph.createNode('TEXT', graph.getPages()[0].id, {
    name: 'External shared style',
    sharedStyleType: 'TEXT',
    text: 'Ag'
  })
  const collection = graph.createCollection('Tokens')
  graph.createVariable('Accent', 'FLOAT', collection.id, 8)

  const bytes = await exportFigFile(graph)
  const { nodeChanges } = parseFigBuffer(bytes.buffer as ArrayBuffer)
  const nativeLayer = nodeChanges.find((change) => change.name === 'Native layer')
  expect(nativeLayer?.parentIndex?.position).toBe('~z')
  const parent = nativeLayer?.parentIndex?.guid
  expect(parent).toBeDefined()
  const children = nodeChanges.filter(
    (change) =>
      change.parentIndex?.guid.sessionID === parent?.sessionID &&
      change.parentIndex?.guid.localID === parent?.localID
  )
  expect(children).toHaveLength(4)
  expect(new Set(children.map((change) => change.parentIndex?.position)).size).toBe(4)
  for (const child of children.filter((change) => change !== nativeLayer))
    expect((child.parentIndex?.position ?? '') > '~z').toBe(true)
})

test('native same-canvas styles retain their place alongside new and relocated styles', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const internal = graph.addPage('Mixed native resources')
  graph.updateNode(internal.id, { internalOnly: true })
  for (const [name, type, key] of [
    ['First native layer', 'FRAME', 'A'],
    ['Native style', 'TEXT', 'B'],
    ['Last native layer', 'FRAME', 'C']
  ] as const) {
    const node = graph.createNode(type, internal.id, {
      name,
      ...(type === 'TEXT' ? { sharedStyleType: 'TEXT' as const, text: 'Ag' } : {})
    })
    node.source.format = 'fig'
    node.source.orderKey = key
  }
  graph.createNode('TEXT', internal.id, { name: 'New style', sharedStyleType: 'TEXT', text: 'Ag' })
  const moved = graph.createNode('TEXT', graph.getPages()[0].id, {
    name: 'Relocated native style',
    sharedStyleType: 'TEXT',
    text: 'Ag'
  })
  moved.source.format = 'fig'
  moved.source.orderKey = 'A'
  const collection = graph.createCollection('Tokens')
  graph.createVariable('Accent', 'FLOAT', collection.id, 8)
  const bytes = await exportFigFile(graph)
  const { nodeChanges } = parseFigBuffer(bytes.buffer as ArrayBuffer)
  const native = nodeChanges
    .filter((change) =>
      ['First native layer', 'Native style', 'Last native layer'].includes(change.name ?? '')
    )
    .sort((a, b) => (a.parentIndex?.position ?? '').localeCompare(b.parentIndex?.position ?? ''))
  expect(native.map((change) => [change.name, change.parentIndex?.position])).toEqual([
    ['First native layer', 'A'],
    ['Native style', 'B'],
    ['Last native layer', 'C']
  ])
  const parent = native[0].parentIndex?.guid
  const children = nodeChanges.filter(
    (change) =>
      change.parentIndex?.guid.sessionID === parent?.sessionID &&
      change.parentIndex?.guid.localID === parent?.localID
  )
  expect(children).toHaveLength(7)
  expect(new Set(children.map((change) => change.parentIndex?.position)).size).toBe(7)
  for (const name of ['New style', 'Relocated native style'])
    expect(
      (children.find((change) => change.name === name)?.parentIndex?.position ?? '') > 'C'
    ).toBe(true)
})
