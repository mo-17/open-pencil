import { expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { computeImageHash, SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFile, parseFigFile } from '#core/io/formats/fig'
import { archiveImagesNamedForFigma } from '#core/io/formats/fig/patch/export'
import { initCodec } from '#core/kiwi'
import {
  serializeSceneGraph,
  serializedSceneGraphTransferList
} from '#core/kiwi/fig/parse/transfer'
import { figArchive, registerFigArchive } from '#core/kiwi/fig/session/archive'

const BYTES = new Uint8Array([1, 2, 3])
const HASH = computeImageHash(BYTES)

test('FIG save and patched resave keep module image aliases and deduplicate worker buffers', async () => {
  await initCodec()
  const graph = new SceneGraph()
  graph.images.set('vr-tour/original-name', BYTES)
  const rectangle = graph.createNode('RECTANGLE', graph.getPages()[0].id, { name: 'Original' })
  const first = await exportFigFile(graph)
  expect(parseFigBuffer(Uint8Array.from(first).buffer).images.map(([name]) => name)).toEqual([HASH])
  const reopened = await parseFigFile(Uint8Array.from(first).buffer)
  expect(reopened.images.get('vr-tour/original-name')).toBe(reopened.images.get(HASH))
  const archive = figArchive(reopened)
  if (!archive) throw new TypeError('Missing reader archive.')
  expect((await archive.info()).imageHashes).toEqual([HASH])
  expect(await archiveImagesNamedForFigma(reopened)).toBe(true)
  let patchCalls = 0
  registerFigArchive(reopened, {
    ...archive,
    async patch(records, input) {
      patchCalls++
      return archive.patch(records, input)
    }
  })
  const loaded = [...reopened.getAllNodes()].find((node) => node.name === rectangle.name)
  if (!loaded) throw new TypeError('Missing reopened rectangle.')
  reopened.updateNode(loaded.id, { name: 'Patched' })
  reopened.images.set('vr-tour/another-name', reopened.images.get(HASH) ?? BYTES)
  const saved = await exportFigFile(reopened)
  expect(patchCalls).toBe(1)
  expect(parseFigBuffer(Uint8Array.from(saved).buffer).images.map(([name]) => name)).toEqual([HASH])
  const again = await parseFigFile(Uint8Array.from(saved).buffer)
  expect(again.images.get('vr-tour/original-name')).toBe(again.images.get(HASH))
  expect(again.images.get('vr-tour/another-name')).toBe(again.images.get(HASH))
  const serialized = serializeSceneGraph(again)
  const image = again.images.get(HASH)
  if (!image) throw new TypeError('Missing canonical image.')
  expect(
    serializedSceneGraphTransferList(serialized).filter((buffer) => buffer === image.buffer)
  ).toHaveLength(1)
})

test('opaque plugin image references retain an alias even when a native paint is canonicalized', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const alias = '0123456789abcdef0123456789abcdef01234567'
  graph.images.set(alias, BYTES)
  graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    name: 'Shared opaque image',
    fills: [
      {
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: alias
      }
    ],
    pluginData: [{ pluginId: 'foreign-plugin', key: 'source-image', value: alias }]
  })
  const bytes = await exportFigFile(graph)
  expect(parseFigBuffer(Uint8Array.from(bytes).buffer).images.map(([name]) => name)).toEqual([HASH])
  const reopened = await parseFigFile(Uint8Array.from(bytes).buffer)
  const node = [...reopened.getAllNodes()].find(
    (candidate) => candidate.name === 'Shared opaque image'
  )
  expect(node?.fills[0]?.imageHash).toBe(HASH)
  expect(node?.pluginData).toContainEqual({
    pluginId: 'foreign-plugin',
    key: 'source-image',
    value: alias
  })
  expect(reopened.images.get(alias)).toBe(reopened.images.get(HASH))
})
