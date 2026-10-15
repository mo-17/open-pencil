import { expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'

import { renderJSX, renderTree, node } from '@open-pencil/core/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

test('typed trees build repeated and conditional content before rendering', async () => {
  const graph = new SceneGraph()
  const result = await renderTree(
    graph,
    node('frame', {
      flex: 'row',
      wrap: true,
      w: 300,
      children: Array.from({ length: 35 }, (_, i) =>
        node('frame', {
          w: 36,
          h: 36,
          name: i % 7 === 0 ? 'Sunday' : 'Day'
        })
      )
    })
  )
  const root = getNodeOrThrow(graph, result.id)
  expect(root.childIds).toHaveLength(35)
  expect(graph.getNode(root.childIds[7] ?? '')?.name).toBe('Sunday')
})

test('typed trees allow the host to compute labels before rendering', async () => {
  const graph = new SceneGraph()
  const days = ['Mo', 'Tu', 'We']
  const result = await renderTree(
    graph,
    node('frame', {
      children: days.map((day) => node('text', { name: day, children: [day] }))
    })
  )
  const root = getNodeOrThrow(graph, result.id)
  expect(root.childIds.map((id) => graph.getNode(id)?.name)).toEqual(days)
})

test('a JSX string rejects statement and executable-expression input without mutating the document', async () => {
  for (const jsx of [
    `const days = ['Mo']
<Frame>{days.map((day) => <Text>{day}</Text>)}</Frame>`,
    '<Frame>{(() => 100)()}</Frame>',
    '<Frame>{Array.from({ length: 35 }, (_, i) => <Text>{i}</Text>)}</Frame>'
  ]) {
    const graph = new SceneGraph()
    await expect(renderJSX(graph, jsx)).rejects.toThrow('Design JSX is unsafe')
    expect(graph.getPages()[0]?.childIds).toEqual([])
  }
})
