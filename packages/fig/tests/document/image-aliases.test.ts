import { expect, test } from 'bun:test'

import { imageAliasesPluginData, restoreImageAliases } from '#fig/document/image-aliases'

import { computeImageHash, OPEN_PENCIL_PLUGIN_ID, SceneGraph } from '@open-pencil/scene-graph'

const BYTES = new Uint8Array([1, 2, 3])
const HASH = computeImageHash(BYTES)
function fixture(aliases: Array<{ alias: string; hash: string }>) {
  const graph = new SceneGraph()
  const root = graph.getNode(graph.rootId)
  if (!root) throw new TypeError('Missing document root.')
  root.pluginData.push({
    pluginId: OPEN_PENCIL_PLUGIN_ID,
    key: 'imageAliasesV1',
    value: JSON.stringify({ version: 1, aliases })
  })
  graph.images.set(HASH, BYTES)
  return graph
}

test('document image aliases restore the same bytes without duplicating canonical entries', () => {
  const graph = fixture([
    { alias: 'vr-tour/sample-a', hash: HASH },
    { alias: 'legacy-still', hash: HASH }
  ])
  restoreImageAliases(graph)
  expect(graph.images.get('vr-tour/sample-a')).toBe(BYTES)
  expect(graph.images.get('legacy-still')).toBe(BYTES)
  const metadata = imageAliasesPluginData(graph.images)
  expect(metadata?.key).toBe('imageAliasesV1')
  expect(metadata?.value).toBe(
    JSON.stringify({
      version: 1,
      aliases: [
        { alias: 'legacy-still', hash: HASH },
        { alias: 'vr-tour/sample-a', hash: HASH }
      ]
    })
  )
})

test('invalid aliases fail atomically before modifying graph image references', () => {
  for (const aliases of [
    [
      { alias: 'safe', hash: HASH },
      { alias: 'missing', hash: '0'.repeat(40) }
    ],
    [
      { alias: 'duplicate', hash: HASH },
      { alias: 'duplicate', hash: HASH }
    ]
  ]) {
    const graph = fixture(aliases)
    expect(() => restoreImageAliases(graph)).toThrow(TypeError)
    expect([...graph.images.keys()]).toEqual([HASH])
  }
  const mismatched = fixture([{ alias: 'bad-hash', hash: HASH }])
  mismatched.images.set(HASH, new Uint8Array([9]))
  expect(() => restoreImageAliases(mismatched)).toThrow('hash does not match')
  expect(mismatched.images.has('bad-hash')).toBe(false)
  const collision = fixture([{ alias: 'different-image', hash: HASH }])
  collision.images.set('different-image', new Uint8Array([8]))
  expect(() => restoreImageAliases(collision)).toThrow('collides')
  expect(collision.images.get('different-image')).toEqual(new Uint8Array([8]))
})

test('image alias metadata uses the archive entry and data byte budgets', () => {
  const graph = fixture([
    { alias: 'one', hash: HASH },
    { alias: 'two', hash: HASH }
  ])
  expect(() => restoreImageAliases(graph, { maxEntries: 1 })).toThrow(RangeError)
  expect(() => restoreImageAliases(graph, { maxDataBytes: 8 })).toThrow(RangeError)
  expect(() => restoreImageAliases(graph, { maxEntryBytes: 8 })).toThrow(RangeError)
  expect([...graph.images.keys()]).toEqual([HASH])
})
