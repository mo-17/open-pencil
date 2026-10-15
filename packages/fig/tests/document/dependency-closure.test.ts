import { expect, test } from 'bun:test'

import { expectDefined } from '#fig-tests/helpers/assert'
import { guid } from '#fig-tests/helpers/guid'
import {
  collectSceneDependencies,
  type SourceDependencySelector
} from '#fig/document/dependency-closure'
import { createDocumentReader } from '#fig/document/read'
import { createSourceIndex } from '#fig/instance-overrides/source-index'

import {
  materializeDocument,
  createFigRecordSession,
  type DocumentAssemblyOptions
} from '@open-pencil/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

test('retains external preferred choices separately from required component dependencies', () => {
  const changes = [
    { guid: guid(1), type: 'CANVAS' },
    {
      guid: guid(2),
      type: 'SYMBOL',
      parentIndex: { guid: guid(1), position: '!' },
      componentPropDefs: [
        {
          id: guid(90),
          type: 'INSTANCE_SWAP',
          initialValue: { guidValue: guid(3) },
          preferredValues: { instanceSwapValues: [{ key: 'external' }, { key: 'local' }] }
        }
      ]
    },
    { guid: guid(3), type: 'SYMBOL', key: 'local', parentIndex: { guid: guid(4), position: '!' } },
    { guid: guid(4), type: 'CANVAS', internalOnly: true }
  ] as NodeChange[]
  const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  expect(result.contentIds.has('1:3')).toBe(true)
  expect([...result.externalPreferredKeys]).toEqual(['external'])
  expect(result.missingIds.size).toBe(0)
})

test('includes component ownership without pulling in unrelated internal definitions', () => {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'DOCUMENT' },
    { guid: guid(2), type: 'CANVAS', parentIndex: { guid: guid(1), position: '!' } },
    {
      guid: guid(3),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(1), position: '"' }
    },
    { guid: guid(4), type: 'FRAME', parentIndex: { guid: guid(3), position: '!' } },
    { guid: guid(5), type: 'SYMBOL', parentIndex: { guid: guid(4), position: '!' } },
    {
      guid: guid(6),
      type: 'INSTANCE',
      parentIndex: { guid: guid(4), position: '"' },
      symbolData: { symbolID: guid(99) }
    },
    {
      guid: guid(7),
      type: 'INSTANCE',
      parentIndex: { guid: guid(2), position: '!' },
      symbolData: { symbolID: guid(5) }
    }
  ]
  const result = collectSceneDependencies(changes, undefined, createSourceIndex(changes))
  expect([...result.contentIds].sort()).toEqual(['1:2', '1:5', '1:7'])
  expect(result.ancestorIds.has('1:4')).toBe(true)
  expect(result.missingIds.size).toBe(0)
  expect(result.contentIds.has('1:6')).toBe(false)
  const assembled = materializeDocument(changes)
  const componentId = assembled.sources.get('1:5')
  if (!componentId) throw new Error('Missing required component')
  expect(assembled.graph.getNode(componentId)?.parentId).toBe(assembled.sources.get('1:4'))
  expect(assembled.sources.has('1:6')).toBe(false)
  const closureChanges = [
    ...changes,
    {
      guid: guid(8),
      type: 'INSTANCE',
      parentIndex: { guid: guid(2), position: '"' },
      symbolData: { symbolID: guid(99) }
    }
  ] as NodeChange[]
  const reached = collectSceneDependencies(
    closureChanges,
    undefined,
    createSourceIndex(closureChanges)
  )
  expect([...reached.missingComponentIds]).toEqual(['1:99'])
  expect(reached.missingIds.size).toBe(0)
})

function hostReferenceRecords(): NodeChange[] {
  return [
    { guid: guid(0), type: 'DOCUMENT', name: 'Document' },
    {
      guid: guid(1),
      type: 'CANVAS',
      name: 'Reference',
      parentIndex: { guid: guid(0), position: '!' }
    },
    {
      guid: guid(2),
      type: 'CANVAS',
      name: 'Application',
      parentIndex: { guid: guid(0), position: '"' }
    },
    { guid: guid(3), type: 'FRAME', name: 'Entry', parentIndex: { guid: guid(2), position: '!' } },
    {
      guid: guid(4),
      type: 'CANVAS',
      name: 'Unrelated',
      parentIndex: { guid: guid(0), position: '#' }
    },
    {
      guid: guid(5),
      type: 'FRAME',
      name: 'Unrelated child',
      parentIndex: { guid: guid(4), position: '!' }
    },
    { guid: guid(6), type: 'FRAME', name: 'Shell', parentIndex: { guid: guid(1), position: '!' } },
    { guid: guid(7), type: 'FRAME', name: 'Slot', parentIndex: { guid: guid(6), position: '!' } },
    {
      guid: guid(8),
      type: 'FRAME',
      name: 'Unrelated sibling',
      parentIndex: { guid: guid(1), position: '"' }
    },
    {
      guid: guid(9),
      type: 'FRAME',
      name: 'Host dependency',
      parentIndex: { guid: guid(4), position: '"' }
    }
  ]
}

const hostReferences: SourceDependencySelector = (record, hasSource) => {
  let ids: string[] = []
  if (record.type === 'DOCUMENT') ids = ['1:6']
  else if (record.name === 'Application') ids = ['1:3']
  else if (record.name === 'Shell') ids = ['1:9']
  for (const id of ids) expect(hasSource(id)).toBe(true)
  return ids
}

test('host references join the existing closure even before any page tree loads', () => {
  const records = hostReferenceRecords()
  const unselected = new Set<string>()
  const ordinary = createDocumentReader(records, unselected)
  expect(ordinary.dependencyClosure.contentIds.size).toBe(0)
  const reader = createDocumentReader(records, unselected, hostReferences)
  expect([...reader.dependencyClosure.contentIds].sort()).toEqual(['1:3', '1:6', '1:7', '1:9'])
  expect(reader.dependencyClosure.missingIds.size).toBe(0)
  expect(reader.dependencyClosure.ancestorIds.has('1:4')).toBe(true)
  expect(reader.dependencyClosure.contentIds.has('1:5')).toBe(false)
  expect(reader.dependencyClosure.contentIds.has('1:8')).toBe(false)
  const assembled = materializeDocument(records, [], {
    pageIds: unselected,
    sourceDependencies: hostReferences
  })
  const shell = assembled.sources.get('1:6')
  const slot = assembled.sources.get('1:7')
  expect(assembled.graph.getNode(slot ?? '')?.parentId).toBe(shell)
  expect(assembled.sources.has('1:3')).toBe(true)
  expect(assembled.sources.has('1:9')).toBe(true)
  expect(assembled.sources.has('1:5')).toBe(false)
  expect(assembled.sources.has('1:8')).toBe(false)
  const selected = reader.selectPages(new Set(['1:4']))
  expect(selected.dependencyClosure.contentIds.has('1:5')).toBe(true)
  expect(selected.dependencyClosure.contentIds.has('1:6')).toBe(true)
  expect(selected.dependencyClosure.contentIds.has('1:3')).toBe(true)
})

test('missing host dependencies remain strict instead of becoming fabricated nodes', () => {
  const records = hostReferenceRecords()
  const missing: SourceDependencySelector = (record, hasSource) => {
    if (record.type !== 'DOCUMENT') return []
    expect(hasSource('1:99')).toBe(false)
    return ['1:99']
  }
  const result = collectSceneDependencies(
    records,
    new Set(),
    createSourceIndex(records),
    undefined,
    missing
  )
  expect([...result.missingIds]).toEqual(['1:99'])
  expect(() =>
    materializeDocument(records, [], { pageIds: new Set(), sourceDependencies: missing })
  ).toThrow('Missing reachable sources: 1:99')
})

test('host dependencies retain the existing graph-node budget', () => {
  expect(() =>
    materializeDocument(hostReferenceRecords(), [], {
      pageIds: new Set(),
      sourceDependencies: hostReferences,
      archiveLimits: { maxGraphNodes: 2 }
    })
  ).toThrow('SceneGraph node limit exceeded (2)')
})

test('materialization reports only first-hydrated raw nodes across page loads and checkpoint recovery', () => {
  const records = hostReferenceRecords()
  const passes: Array<{ sources: Map<string, string>; newNodeIds: Set<string> }> = []
  const options: DocumentAssemblyOptions = {
    afterMaterialize(_graph, sources, _records, newNodeIds) {
      if (newNodeIds === undefined)
        throw new Error('Materializer did not provide new source identities')
      passes.push({ sources: new Map(sources), newNodeIds: new Set(newNodeIds) })
    }
  }
  const session = createFigRecordSession(records, [], options)
  const initial = passes[0]
  if (!initial) throw new Error('Missing initial callback')
  expect(initial.newNodeIds).toEqual(new Set(initial.sources.values()))
  expect(initial.newNodeIds.has(session.graph.rootId)).toBe(true)
  session.loadPage('1:1')
  const first = passes[1]
  if (!first) throw new Error('Missing first-page callback')
  expect(first.newNodeIds).toEqual(
    new Set(['1:6', '1:7', '1:8'].map((id) => expectDefined(first.sources.get(id), `source ${id}`)))
  )
  for (const id of initial.newNodeIds) expect(first.newNodeIds.has(id)).toBe(false)
  session.loadPage('1:1')
  expect(passes).toHaveLength(2)
  const resumed = createFigRecordSession(records, [], options, {
    graph: session.graph,
    checkpoint: session.checkpoint()
  })
  resumed.loadPage('1:2')
  const recovered = passes[2]
  if (!recovered) throw new Error('Missing recovered callback')
  expect(recovered.newNodeIds).toEqual(
    new Set([expectDefined(recovered.sources.get('1:3'), 'recovered source 1:3')])
  )
  expect(recovered.newNodeIds.has(session.graph.rootId)).toBe(false)
  for (const id of first.newNodeIds) expect(recovered.newNodeIds.has(id)).toBe(false)
})
