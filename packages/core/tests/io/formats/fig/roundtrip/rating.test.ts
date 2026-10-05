import { expect, test } from 'bun:test'

import { uint8ArrayToArrayBuffer } from '#core-tests/helpers/fig/fixtures'

import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFile } from '#core/io/formats/fig'
import { initCodec, parseFigFile } from '#core/kiwi'
import { createRatingModuleFrameOverrides, resolveRatingModule } from '#core/plugins/rating'

test('Rating remains an ordinary FRAME and preserves authored configuration through fig readback', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const originals = [
    { label: '整星', initialValue: 0 },
    { label: '半星', allowHalf: true, initialValue: 3.5 },
    { label: '只读', max: 10, initialValue: 8, readOnly: true, activeColor: '#2563EB' }
  ].map((config, index) =>
    graph.createNode('FRAME', graph.getPages()[0].id, {
      ...createRatingModuleFrameOverrides(config),
      name: `Rating ${index}`,
      y: index * 160
    })
  )
  const bytes = await exportFigFile(graph)
  const restored = await parseFigFile(uint8ArrayToArrayBuffer(bytes))
  for (const original of originals) {
    const node = [...restored.getAllNodes()].find((candidate) => candidate.name === original.name)
    expect(node?.type).toBe('FRAME')
    expect(node?.interactiveProps?.module).toEqual(original.interactiveProps?.module)
    expect(resolveRatingModule(node?.interactiveProps?.module)?.ok).toBe(true)
  }
})
