import { expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { populateAllFigPages, populateFigPage } from '@open-pencil/core/io/formats/fig'
import { importNodeChanges } from '@open-pencil/core/kiwi/fig/import'
import { populateLazyFigImportRoots } from '@open-pencil/core/kiwi/fig/lazy-import'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import { reapplyInstanceOverrides } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import {
  snapshotReaderState,
  copyReaderState,
  isReaderPagePending
} from '#core/kiwi/fig/session/document-state'

async function createArchiveShells() {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.createNode('RECTANGLE', source.addPage('Page 2').id, { name: 'Second' })
  const bytes = await exportFigFile(source)
  return parseFigFile(bytes.slice().buffer as ArrayBuffer, { populate: 'none' })
}

function createAuthoredGraph(internal = false) {
  const guid = (localID: number) => ({ sessionID: 1, localID })
  const changes: NodeChange[] = [
    { guid: guid(0), type: 'DOCUMENT' },
    {
      guid: guid(1),
      type: 'CANVAS',
      name: 'Page 1',
      parentIndex: { guid: guid(0), position: '!' }
    },
    {
      guid: guid(2),
      type: 'CANVAS',
      name: 'Page 2',
      parentIndex: { guid: guid(0), position: '"' }
    },
    {
      guid: guid(3),
      type: 'SYMBOL',
      name: 'Button',
      parentIndex: { guid: guid(1), position: '!' },
      size: { x: 100, y: 40 }
    },
    {
      guid: guid(4),
      type: 'RECTANGLE',
      name: 'Background',
      parentIndex: { guid: guid(3), position: '!' },
      size: { x: 100, y: 40 }
    },
    {
      guid: guid(5),
      type: 'INSTANCE',
      name: 'First instance',
      parentIndex: { guid: guid(1), position: '"' },
      symbolData: { symbolID: guid(3) }
    },
    {
      guid: guid(6),
      type: 'INSTANCE',
      name: 'Second instance',
      parentIndex: { guid: guid(2), position: '!' },
      symbolData: { symbolID: guid(3) }
    }
  ]
  if (internal)
    changes.push(
      {
        guid: guid(7),
        type: 'CANVAS',
        name: 'Internal assets',
        internalOnly: true,
        parentIndex: { guid: guid(0), position: '#' }
      },
      {
        guid: guid(8),
        type: 'INSTANCE',
        name: 'Internal instance',
        parentIndex: { guid: guid(7), position: '!' },
        symbolData: { symbolID: guid(3) }
      }
    )
  const graph = importNodeChanges(changes, [], undefined, { populate: 'none' })
  const find = (name: string) => {
    const node = [...graph.getAllNodes()].find((node) => node.name === name)
    if (!node) throw new Error(`Missing ${name}`)
    return node
  }
  return { graph, find, changes }
}

test('archive session populates an unvisited page exactly once', async () => {
  const graph = await createArchiveShells()
  const [first, second] = graph.getPages()
  expect(graph.getChildren(first.id)).toHaveLength(0)
  expect(populateFigPage(graph, second.id)).toBe(true)
  expect(graph.getChildren(first.id)).toHaveLength(0)
  expect(graph.getChildren(second.id).map((node) => node.name)).toEqual(['Second'])
  const count = graph.nodes.size
  expect(populateFigPage(graph, second.id)).toBe(false)
  expect(graph.nodes.size).toBe(count)
})

test('archive session populates all remaining pages once', async () => {
  const graph = await createArchiveShells()
  expect(populateAllFigPages(graph)).toBe(true)
  expect(graph.getPages().map((page) => graph.getChildren(page.id).length)).toEqual([1, 1])
  expect(populateAllFigPages(graph)).toBe(false)
})

test('decoded records retain authored identities before scoped occurrence expansion', () => {
  const { graph, find, changes } = createAuthoredGraph()
  const first = find('First instance'),
    second = find('Second instance')
  const secondPage = find('Page 2')
  expect(first.source.id).toBe('1:5')
  expect(graph.getChildren(first.id)).toHaveLength(0)
  expect(graph.getChildren(second.id)).toHaveLength(0)
  expect(populateLazyFigImportRoots(graph, [secondPage.id])).toBe(true)
  expect(find('Second instance')).toBe(second)
  expect(graph.getChildren(second.id)).toHaveLength(1)
  expect(graph.getChildren(first.id)).toHaveLength(0)
  expect(isReaderPagePending(graph, find('Page 1').id)).toBe(true)
  const ids = [...graph.nodes.keys()]
  expect(populateLazyFigImportRoots(graph, [secondPage.id, secondPage.id])).toBe(false)
  expect([...graph.nodes.keys()]).toEqual(ids)
  expect(populateAllFigPages(graph)).toBe(true)
  expect(graph.getChildren(first.id)).toHaveLength(1)
  expect(populateAllFigPages(graph)).toBe(false)
  expect(changes[5].symbolData?.symbolID).toEqual({ sessionID: 1, localID: 3 })
})

test('full-document population explicitly includes internal authored pages', () => {
  const { graph, find } = createAuthoredGraph(true)
  expect(graph.getPages()).toHaveLength(2)
  expect(graph.getPages(true)).toHaveLength(3)
  expect(populateAllFigPages(graph)).toBe(true)
  expect(graph.getChildren(find('Internal instance').id)).toHaveLength(1)
  expect(snapshotReaderState(graph)?.checkpoint.loadedPageIds).toHaveLength(3)
  expect(populateAllFigPages(graph)).toBe(false)
})

test('graphs without reader state do not claim pending pages', () => {
  const graph = new SceneGraph()
  expect(snapshotReaderState(graph)).toBeUndefined()
  expect(populateAllFigPages(graph)).toBe(false)
})

test('later-page population replays legacy lowcode overrides and retains structured claims', () => {
  const { graph, find } = createAuthoredGraph()
  const first = find('First instance'),
    second = find('Second instance')
  graph.updateNode(first.id, { pendingInstanceOverrides: { '0:opacity': 0.7 } })
  graph.updateNode(second.id, { pendingInstanceOverrides: { '0:opacity': 0.35 } })
  expect(populateFigPage(graph, find('Page 1').id)).toBe(true)
  reapplyInstanceOverrides(graph)
  const child = graph.getChildren(first.id)[0]
  expect(child.opacity).toBe(0.7)
  expect(first.pendingInstanceOverrides).toBeUndefined()
  expect(second.pendingInstanceOverrides).toEqual({ '0:opacity': 0.35 })
  expect(graph.getChildren(second.id)).toHaveLength(0)
  second.instanceOverrides.self.set('structured-sentinel', true)
  expect(populateFigPage(graph, find('Page 2').id)).toBe(true)
  const later = graph.getChildren(second.id)[0]
  expect(later.opacity).toBe(0.35)
  expect(second.overrides).toEqual({ [`${later.id}:opacity`]: 0.35 })
  expect(second.pendingInstanceOverrides).toBeUndefined()
  expect(second.instanceOverrides.self.get('structured-sentinel')).toBe(true)
  expect(child.opacity).toBe(0.7)
  expect(first.overrides).toEqual({ [`${child.id}:opacity`]: 0.7 })
})

test('a copied decoded-record session resumes its pending page independently', () => {
  const { graph, find } = createAuthoredGraph()
  populateFigPage(graph, find('Page 1').id)
  const copied = new SceneGraph()
  copied.nodes.clear()
  for (const [id, node] of graph.nodes) copied.nodes.set(id, structuredClone(node))
  copied.rootId = graph.rootId
  copied.instanceIndex.clear()
  for (const [id, entries] of graph.instanceIndex) copied.instanceIndex.set(id, new Set(entries))
  copyReaderState(graph, copied)
  expect(populateFigPage(copied, find('Page 2').id)).toBe(true)
  expect(graph.getChildren(find('Second instance').id)).toHaveLength(0)
  expect(copied.getChildren(find('Second instance').id)).toHaveLength(1)
  expect(isReaderPagePending(graph, find('Page 2').id)).toBe(true)
})
