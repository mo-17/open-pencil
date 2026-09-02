import { expect, mock, test } from 'bun:test'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { showFigPageManifest } from '@/app/document/io/fig'

test('shows FIG page manifest shells with source identity and ordering', () => {
  const graphs: SceneGraph[] = []
  const target = {
    replaceGraph: mock((replacement: SceneGraph) => {
      graphs.push(replacement)
    }),
    state: { loading: false }
  }

  showFigPageManifest(target, [
    {
      sourceId: 'page-1',
      name: 'Cover',
      position: 'a',
      internalOnly: false
    },
    {
      sourceId: 'page-2',
      name: 'Components',
      position: 'b',
      internalOnly: true
    }
  ])

  expect(target.replaceGraph).toHaveBeenCalledTimes(1)
  expect(target.state.loading).toBe(false)
  expect(
    graphs[0]?.getPages(true).map((page) => ({
      name: page.name,
      sourceId: page.source.id,
      position: page.source.orderKey,
      internalOnly: page.internalOnly
    }))
  ).toEqual([
    { name: 'Cover', sourceId: 'page-1', position: 'a', internalOnly: false },
    { name: 'Components', sourceId: 'page-2', position: 'b', internalOnly: true }
  ])
})

test('ignores an empty FIG page manifest', () => {
  const target = {
    replaceGraph: mock((_replacement: SceneGraph) => undefined),
    state: { loading: false }
  }

  showFigPageManifest(target, [])

  expect(target.replaceGraph).not.toHaveBeenCalled()
  expect(target.state.loading).toBe(false)
})
