import { expect, test } from 'bun:test'

import { captureDocumentOracle } from '#visual/capture/document'

import { SceneGraph } from '@open-pencil/scene-graph'

/** Two captures only line up if every node is addressed by page as well as position. */
test('each page keeps its own node paths under a page prefix', () => {
  const graph = new SceneGraph()
  const first = graph.getPages()[0]
  graph.createNode('FRAME', first.id, { name: 'Only' })
  const second = graph.addPage('Second')
  const frame = graph.createNode('FRAME', second.id, { name: 'Outer' })
  graph.createNode('TEXT', frame.id, { name: 'Inner', text: 'Hello' })

  const nodes = captureDocumentOracle(graph, new Map())
  const paths = nodes.map((node) => node.path.join(','))
  expect(paths).toEqual(['0', '0,0', '1', '1,0', '1,0,0'])
  expect(nodes.find((node) => node.path.join(',') === '1,0,0')?.text).toBe('Hello')
})

test('an unchanged document captures identically', () => {
  const graph = new SceneGraph()
  graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Frame' })
  expect(captureDocumentOracle(graph, new Map())).toEqual(captureDocumentOracle(graph, new Map()))
})

/** Internal component/slot canvases remain part of a whole-document comparison. */
test('whole-document capture includes internal canvases and their descendants', () => {
  const graph = new SceneGraph()
  const internal = graph.addPage('Internal')
  graph.updateNode(internal.id, { internalOnly: true })
  graph.createNode('FRAME', internal.id, { name: 'Internal component' })
  const nodes = captureDocumentOracle(graph, new Map())
  expect(nodes.map((node) => node.path.join(','))).toEqual(['0', '1', '1,0'])
  expect(nodes.find((node) => node.path.join(',') === '1,0')?.name).toBe('Internal component')
})
