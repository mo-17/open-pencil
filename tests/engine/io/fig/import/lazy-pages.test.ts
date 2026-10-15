import { expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  exportFigFile,
  parseFigFile,
  populateAllFigPages,
  populateFigPage
} from '#core/io/formats/fig'
import { exportFigFileWithOptions } from '#core/io/formats/fig/export'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { readFigmaProjectionMarker } from '#core/kiwi/fig/node-change/figma-projection'
import { reapplyInstanceOverrides } from '#core/kiwi/fig/node-change/lowcode-plugin-data'
import {
  snapshotReaderState,
  copyReaderState,
  isReaderPagePending
} from '#core/kiwi/fig/session/document-state'

import { expectDefined } from '#tests/helpers/assert'

async function createArchiveShells() {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.createNode('RECTANGLE', source.addPage('Page 2').id, {
    name: 'Second'
  })
  const bytes = await exportFigFile(source)
  return parseFigFile(bytes.slice().buffer as ArrayBuffer, {
    populate: 'none'
  })
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
  graph.updateNode(first.id, {
    pendingInstanceOverrides: { '0:opacity': 0.7 }
  })
  graph.updateNode(second.id, {
    pendingInstanceOverrides: { '0:opacity': 0.35 }
  })
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

test('loading a page keeps saving the opened bytes; an edit encodes the document again', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.createNode('RECTANGLE', source.addPage('Page 2').id, {
    name: 'Second'
  })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFile(bytes.slice().buffer as ArrayBuffer, {
    populate: 'first-page'
  })

  expect(populateFigPage(graph, graph.getPages()[1].id)).toBe(true)
  expect(await exportFigFile(graph)).toEqual(bytes)

  const [second] = graph.getChildren(graph.getPages()[1].id)
  graph.updateNode(second.id, { name: 'Renamed' })
  expect(await exportFigFile(graph)).not.toEqual(bytes)
})

test('lazy population preserves folded lowcode projections and authored deletions without dangling child links', async () => {
  await initCodec()
  const source = new SceneGraph()
  const reference = source.getPages()[0]
  const home = source.addPage('Application page')
  const entry = source.createNode('FRAME', home.id, { name: 'Application entry' })
  const shell = source.createNode('FRAME', reference.id, { name: 'Shared layout' })
  const slot = source.createNode('FRAME', shell.id, { name: 'Content slot' })
  source.createNode('BUTTON', shell.id, {
    name: 'Shared navigation',
    interactiveProps: { text: 'Open page' },
    events: { onClick: [{ id: 'shared-navigation', kind: 'navigate', to: '/home' }] }
  })
  source.createNode('RECTANGLE', shell.id, { name: 'Authored deletion' })
  source.createNode('RECTANGLE', reference.id, {
    name: 'Later ordinary shape',
    width: 37,
    height: 23
  })
  source.updateNode(reference.id, { lowcodeApplicationPage: { version: 1, role: 'reference' } })
  source.updateNode(home.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id }
  })
  source.updateNode(source.rootId, {
    lowcodeApplication: {
      version: 1,
      enabled: true,
      startPageId: home.id,
      shell: { frameNodeId: shell.id, slotNodeId: slot.id }
    }
  })
  const bytes = await exportFigFileWithOptions(source, { profile: 'figma-compatible' })
  const saved = parseFigBuffer(new Uint8Array(bytes).buffer)
  expect(
    saved.nodeChanges
      .filter((node) => readFigmaProjectionMarker(node)?.role === 'label')
      .map((node) => node.textData?.characters)
  ).toContain('Open page')
  const graph = await parseFigFile(new Uint8Array(bytes).buffer, { populate: 'none' })
  const find = (name: string) =>
    expectDefined(
      [...graph.getAllNodes()].find((node) => node.name === name),
      name
    )
  const navigation = find('Shared navigation')
  const deleted = find('Authored deletion')
  const referencePage = expectDefined(
    graph.getPages().find((page) => page.name === reference.name),
    'reference page'
  )
  const applicationPage = expectDefined(
    graph.getPages().find((page) => page.name === home.name),
    'application page'
  )
  expect(navigation.type).toBe('BUTTON')
  expect(navigation.interactiveProps).toMatchObject({ text: 'Open page' })
  expect(navigation.childIds).toEqual([])
  expect([...graph.getAllNodes()].some((node) => node.name === 'Later ordinary shape')).toBe(false)
  graph.deleteNode(deleted.id)

  expect(populateFigPage(graph, referencePage.id)).toBe(true)
  expect(navigation.childIds).toEqual([])
  expect(find('Shared layout').childIds).not.toContain(deleted.id)
  expect(graph.getNode(deleted.id)).toBeUndefined()
  expect(find('Later ordinary shape')).toMatchObject({ width: 37, height: 23 })
  expect(navigation.events).toEqual({
    onClick: [{ id: 'shared-navigation', kind: 'navigate', to: '/home' }]
  })
  expect(populateFigPage(graph, applicationPage.id)).toBe(true)
  expect(navigation.childIds).toEqual([])
  expect(find('Shared layout').childIds).not.toContain(deleted.id)
  expect(
    [...graph.getAllNodes()].flatMap((node) => node.childIds).every((id) => graph.getNode(id))
  ).toBe(true)
  const ids = [...graph.nodes.keys()]
  expect(populateFigPage(graph, referencePage.id)).toBe(false)
  expect(populateFigPage(graph, applicationPage.id)).toBe(false)
  expect([...graph.nodes.keys()]).toEqual(ids)
})
