import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'

import { createFigRecordSession } from '@open-pencil/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

const changes: NodeChange[] = [
  { guid: guid(1), type: 'CANVAS', name: 'Design' },
  { guid: guid(2), type: 'CANVAS', name: 'Private library', internalOnly: true },
  { guid: guid(3), type: 'SYMBOL', name: 'Control', parentIndex: { guid: guid(2), position: '!' } },
  {
    guid: guid(4),
    type: 'TEXT',
    parentIndex: { guid: guid(3), position: '!' },
    textData: { characters: 'Shared' }
  },
  {
    guid: guid(5),
    type: 'INSTANCE',
    parentIndex: { guid: guid(1), position: '!' },
    symbolData: { symbolID: guid(3) }
  },
  {
    guid: guid(6),
    type: 'TEXT',
    parentIndex: { guid: guid(2), position: '"' },
    textData: { characters: 'Private content' }
  }
]

test('fresh full session includes internal pages and marks every page loaded', () => {
  const session = createFigRecordSession(changes, [], { initiallyPopulateAll: true })
  expect(session.loadedPageIds).toEqual(new Set(['1:1', '1:2']))
  expect(session.graph.getPages(true)).toHaveLength(2)
  const instance = [...session.graph.getAllNodes()].find((node) => node.type === 'INSTANCE')
  if (!instance) throw new Error('Missing instance')
  expect(session.graph.getChildren(instance.id)[0].text).toBe('Shared')
  expect([...session.graph.getAllNodes()].some((node) => node.text === 'Private content')).toBe(
    true
  )
  const before = [...session.graph.nodes]
  for (const page of session.pages) session.loadPage(page.id)
  expect([...session.graph.nodes]).toEqual(before)
  expect(changes[3].textData?.characters).toBe('Shared')
})

test('lazy and full sessions retain equivalent page trees and cross-page component links', () => {
  const full = createFigRecordSession(changes, [], { initiallyPopulateAll: true })
  const lazy = createFigRecordSession(changes)
  for (const page of lazy.pages) lazy.loadPage(page.id)
  const describe = (session: typeof full) => {
    const visit = (id: string): unknown => {
      const node = session.graph.getNode(id)
      if (!node) throw new Error('Missing node')
      return [
        node.name,
        node.type,
        node.text,
        node.width,
        node.height,
        node.componentId ? session.graph.getNode(node.componentId)?.name : null,
        node.childIds.map(visit)
      ]
    }
    return session.graph.getPages(true).map((page) => visit(page.id))
  }
  expect(describe(full)).toEqual(describe(lazy))
  expect(lazy.checkpoint().loadedPageIds).toEqual(full.checkpoint().loadedPageIds)
})
