import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { exportFigFile } from '@open-pencil/core'
import { SceneGraph, type Stroke } from '@open-pencil/scene-graph'

/** A real FIG document for Code UI edits, with foreign tokens and three stroke paints. */
export async function codePaintFixture(withChild = false): Promise<Uint8Array> {
  const graph = new SceneGraph()
  const image = readFileSync(new URL('../../fixtures/vectorize/python_logo.png', import.meta.url))
  const imageHash = createHash('sha1').update(image).digest('hex')
  graph.images.set(imageHash, image)
  const base: Stroke = {
    type: 'SOLID',
    color: { r: 1, g: 0, b: 0, a: 1 },
    visible: true,
    opacity: 1,
    weight: 4,
    align: 'INSIDE'
  }
  const root = graph.createNode(withChild ? 'FRAME' : 'RECTANGLE', graph.getPages()[0].id, {
    name: 'Code paint',
    width: 100,
    height: 100,
    x: 100,
    y: 100,
    pluginData: [{ pluginId: 'foreign-plugin', key: 'tokens', value: '{"keep":"me"}' }],
    strokes: [
      {
        ...base,
        type: 'GRADIENT_LINEAR',
        gradientStops: [
          { position: 0, color: base.color },
          { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
        ],
        gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      },
      { ...base, type: 'IMAGE', imageHash, imageScaleMode: 'FIT' },
      { ...base, blendMode: 'MULTIPLY' }
    ]
  })
  if (withChild)
    graph.createNode('RECTANGLE', root.id, {
      name: 'Unchanged child',
      width: 40,
      height: 40,
      pluginData: [{ pluginId: 'foreign-plugin', key: 'tokens', value: 'child' }]
    })
  return exportFigFile(graph)
}
