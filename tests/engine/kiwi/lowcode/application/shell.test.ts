import { beforeAll, describe, expect, spyOn, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'
import {
  LOWCODE_APPLICATION_PLUGIN_KEY as ROOT_KEY,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import { SceneGraph, remapNodeApplicationReferences } from '@open-pencil/scene-graph'

import {
  remapImportedLowcodeMotionActionReferences,
  remapSerializedLowcodeMotionActionReferences
} from '#core/kiwi/fig/node-change/lowcode-node-references'

import { expectDefined } from '#tests/helpers/assert'

function shellDocument() {
  const graph = new SceneGraph()
  const page = graph.createNode('CANVAS', graph.rootId, { id: 'source-page', name: 'Business' })
  const entry = graph.createNode('FRAME', page.id, { id: 'source-entry', width: 320, height: 640 })
  page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
  const provider = graph.getPages()[0]
  provider.lowcodeApplicationPage = { version: 1, role: 'components' }
  const frame = graph.createNode('FRAME', provider.id, {
    id: 'source-shell',
    name: 'Shell',
    width: 400,
    height: 800
  })
  const column = graph.createNode('FRAME', frame.id, {
    id: 'source-column',
    name: 'Column',
    width: 400,
    height: 800
  })
  const slot = graph.createNode('FRAME', column.id, {
    id: 'source-slot',
    name: 'Slot',
    width: 400,
    height: 700
  })
  const root = expectDefined(graph.getNode(graph.rootId), 'root')
  root.lowcodeApplication = {
    version: 1,
    enabled: true,
    startPageId: page.id,
    shell: { frameNodeId: frame.id, slotNodeId: slot.id }
  }
  return { graph, root, page, entry, frame, column, slot }
}

async function reopen(graph: SceneGraph) {
  return parseFigFile(Uint8Array.from(await exportFigFile(graph)).buffer)
}

describe('application shell FIG references', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('custom start/frame/deep slot IDs remap over two real save/reopen cycles without changing design', async () => {
    const { graph } = shellDocument()
    const before = structuredClone([...graph.nodes])
    let current = graph
    for (let cycle = 0; cycle < 2; cycle++) {
      current = await reopen(current)
      const root = expectDefined(current.getNode(current.rootId), 'root')
      const page = expectDefined(
        current.getPages().find((node) => node.name === 'Business'),
        'page'
      )
      const frame = expectDefined(
        current.getAllNodes().find((node) => node.name === 'Shell'),
        'frame'
      )
      const column = expectDefined(
        current.getAllNodes().find((node) => node.name === 'Column'),
        'column'
      )
      const slot = expectDefined(
        current.getAllNodes().find((node) => node.name === 'Slot'),
        'slot'
      )
      expect(root.lowcodeApplication).toEqual({
        version: 1,
        enabled: true,
        startPageId: page.id,
        shell: { frameNodeId: frame.id, slotNodeId: slot.id }
      })
      expect(frame.id).not.toBe('source-shell')
      expect(slot.id).not.toBe('source-slot')
      expect(column.parentId).toBe(frame.id)
      expect(slot.parentId).toBe(column.id)
      expect(slot.childIds).toEqual([])
      expect(resolveLowcodeApplicationPages(current).mode).toBe('application')
    }
    expect([...graph.nodes]).toEqual(before)
  })

  test('partial typed import retains one complete inert envelope over two save/reopen cycles', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const mapped of ['source-page', 'source-shell', 'source-slot']) {
        const { graph, root } = shellDocument()
        const policy = structuredClone(root.lowcodeApplication)
        const updates = expectDefined(
          remapNodeApplicationReferences(root, (id) => (id === mapped ? `new-${id}` : undefined)),
          'updates'
        )
        graph.restoreNodeProperties(root.id, updates, ['lowcodeApplication'])
        let current = graph
        for (let cycle = 0; cycle < 2; cycle++) {
          current = await reopen(current)
          const restored = expectDefined(current.getNode(current.rootId), 'root')
          const raw = restored.pluginData.filter(
            (entry) => entry.pluginId === 'open-pencil' && entry.key === ROOT_KEY
          )
          expect(restored.lowcodeApplication).toBeUndefined()
          expect(raw).toHaveLength(1)
          expect(JSON.parse(raw[0].value)).toEqual({
            version: 1,
            unsupportedReason: 'incomplete-reference-remap',
            policy
          })
          expect(resolveLowcodeApplicationPages(current).mode).toBe('invalid')
        }
      }
    } finally {
      warn.mockRestore()
    }
  })

  test('disabled shell configuration still remaps persistently while retaining legacy mode', async () => {
    const { graph, root } = shellDocument()
    expectDefined(root.lowcodeApplication, 'policy').enabled = false
    const current = await reopen(graph)
    const restored = expectDefined(current.getNode(current.rootId), 'root')
    const frame = expectDefined(
      current.getAllNodes().find((node) => node.name === 'Shell'),
      'frame'
    )
    const slot = expectDefined(
      current.getAllNodes().find((node) => node.name === 'Slot'),
      'slot'
    )
    expect(restored.lowcodeApplication?.enabled).toBe(false)
    expect(restored.lowcodeApplication?.shell).toEqual({
      frameNodeId: frame.id,
      slotNodeId: slot.id
    })
    expect(resolveLowcodeApplicationPages(current).mode).toBe('legacy')
  })

  test('serialized policy uses the same full-or-inert rule and leaves opaque data untouched', () => {
    const { root } = shellDocument()
    const original = JSON.stringify(root.lowcodeApplication)
    for (const mapped of [
      'all',
      'source-page',
      'source-shell',
      'source-slot',
      'none',
      'identity'
    ]) {
      const record = {
        type: 'DOCUMENT',
        pluginData: [{ pluginID: 'open-pencil', key: ROOT_KEY, value: original }]
      }
      remapSerializedLowcodeMotionActionReferences([record], (id) => {
        if (mapped === 'identity') return id
        return mapped === 'all' || mapped === id ? `new-${id}` : undefined
      })
      const value = record.pluginData[0].value
      if (mapped === 'none' || mapped === 'identity') expect(value).toBe(original)
      else if (mapped === 'all')
        expect(JSON.parse(value)).toEqual({
          version: 1,
          enabled: true,
          startPageId: 'new-source-page',
          shell: { frameNodeId: 'new-source-shell', slotNodeId: 'new-source-slot' }
        })
      else
        expect(JSON.parse(value)).toEqual({
          version: 1,
          unsupportedReason: 'incomplete-reference-remap',
          policy: root.lowcodeApplication
        })
      expect(record.pluginData).toHaveLength(1)
    }
    for (const record of [
      { type: 'CANVAS', pluginData: [{ pluginID: 'open-pencil', key: ROOT_KEY, value: original }] },
      { type: 'DOCUMENT', pluginData: [{ pluginID: 'foreign', key: ROOT_KEY, value: original }] },
      {
        type: 'DOCUMENT',
        pluginData: [{ pluginID: 'open-pencil', key: ROOT_KEY, value: '{broken' }]
      },
      {
        type: 'DOCUMENT',
        pluginData: [
          { pluginID: 'open-pencil', key: ROOT_KEY, value: '{"version":2,"enabled":true}' }
        ]
      },
      {
        type: 'DOCUMENT',
        pluginData: [0, 1].map(() => ({ pluginID: 'open-pencil', key: ROOT_KEY, value: original }))
      }
    ]) {
      const before = structuredClone(record)
      const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        remapSerializedLowcodeMotionActionReferences([record], (id) => `new-${id}`)
      } finally {
        warn.mockRestore()
      }
      expect(record).toEqual(before)
    }
  })

  test('typed importer maps native root and page references, with atomic root failure on partial maps', () => {
    const full = shellDocument()
    const source = structuredClone(full.root.lowcodeApplication)
    const ids = ['source-page', 'source-entry', 'source-shell', 'source-slot']
    remapImportedLowcodeMotionActionReferences(
      full.graph,
      new Map(ids.map((id) => [id, `new-${id}`]))
    )
    expect(full.root.lowcodeApplication).toEqual({
      version: 1,
      enabled: true,
      startPageId: 'new-source-page',
      shell: { frameNodeId: 'new-source-shell', slotNodeId: 'new-source-slot' }
    })
    expect(full.page.lowcodeApplicationPage?.entryNodeId).toBe('new-source-entry')
    expect(source?.shell?.slotNodeId).toBe('source-slot')
    const partial = shellDocument()
    remapImportedLowcodeMotionActionReferences(
      partial.graph,
      new Map([['source-page', 'new-page']]),
      [partial.root.id]
    )
    expect(partial.root.lowcodeApplication).toBeUndefined()
    expect(JSON.parse(partial.root.pluginData[0].value)).toEqual({
      version: 1,
      unsupportedReason: 'incomplete-reference-remap',
      policy: source
    })
    expect(partial.page.lowcodeApplicationPage?.entryNodeId).toBe('source-entry')
  })
})
