import { describe, expect, test } from 'bun:test'

import {
  captureFlutterPreviewSnapshot,
  validateFlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'
import { LOWCODE_APPLICATION_PLUGIN_KEY } from '@open-pencil/lowcode'
import { remapNodeApplicationReferences } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

import { editSnapshotNode, previewFixture } from './helpers'

describe('Flutter application shell snapshot metadata', () => {
  test('detaches start/frame/deep slot references and preserves the complete design graph', () => {
    const { graph, page, frame } = previewFixture()
    page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: frame.id }
    const provider = graph.addPage('Shell provider')
    provider.lowcodeApplicationPage = { version: 1, role: 'reference' }
    const shell = graph.createNode('FRAME', provider.id, { width: 400, height: 800 })
    const column = graph.createNode('FRAME', shell.id, { width: 400, height: 800 })
    const slot = graph.createNode('FRAME', column.id, { width: 400, height: 700 })
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    root.lowcodeApplication = {
      version: 1,
      enabled: true,
      startPageId: page.id,
      shell: { frameNodeId: shell.id, slotNodeId: slot.id }
    }
    const before = structuredClone([...graph.nodes])
    const wire = JSON.stringify(captureFlutterPreviewSnapshot(graph, [page.id]))
    const parsed = validateFlutterPreviewSnapshot(JSON.parse(wire))
    expect(editSnapshotNode(parsed, root.id).lowcodeApplication).toEqual(root.lowcodeApplication)
    expect(editSnapshotNode(parsed, slot.id).parentId).toBe(column.id)
    expect(editSnapshotNode(parsed, slot.id).childIds).toEqual([])
    expect(parsed.graph.nodes.length).toBe(graph.nodes.size)
    expect([...graph.nodes]).toEqual(before)
    root.lowcodeApplication.shell.slotNodeId = 'edited'
    expect(editSnapshotNode(parsed, root.id).lowcodeApplication?.shell?.slotNodeId).toBe(slot.id)
  })

  test('absent/disabled legacy snapshots do not fabricate shell fields', () => {
    const { graph, page } = previewFixture()
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    const legacy = captureFlutterPreviewSnapshot(graph, [page.id])
    expect(Object.hasOwn(editSnapshotNode(legacy, root.id), 'lowcodeApplication')).toBe(false)
    root.lowcodeApplication = { version: 1, enabled: false }
    const wire = JSON.stringify(captureFlutterPreviewSnapshot(graph, [page.id]))
    const parsed = validateFlutterPreviewSnapshot(JSON.parse(wire))
    expect(editSnapshotNode(parsed, root.id).lowcodeApplication).toEqual({
      version: 1,
      enabled: false
    })
    expect(
      Object.hasOwn(
        expectDefined(editSnapshotNode(parsed, root.id).lowcodeApplication, 'policy'),
        'shell'
      )
    ).toBe(false)
  })

  test('malformed nested native shell records fail closed without evaluating accessors', () => {
    const { graph, page } = previewFixture()
    for (const shell of [
      undefined,
      null,
      [],
      { frameNodeId: 'frame' },
      { frameNodeId: 'frame', slotNodeId: 'slot', extra: true },
      { frameNodeId: 'frame', slotNodeId: 'bad\nID' },
      { frameNodeId: 'frame', slotNodeId: 'x'.repeat(513) }
    ]) {
      const snapshot = captureFlutterPreviewSnapshot(graph, [page.id])
      Object.assign(editSnapshotNode(snapshot, graph.rootId), {
        lowcodeApplication: { version: 1, enabled: true, shell }
      })
      expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
        'Invalid Flutter preview snapshot'
      )
    }
    let calls = 0
    const shell = Object.defineProperty({ frameNodeId: 'frame' }, 'slotNodeId', {
      enumerable: true,
      get: () => {
        calls += 1
        return 'slot'
      }
    })
    Object.assign(expectDefined(graph.getNode(graph.rootId), 'root'), {
      lowcodeApplication: { version: 1, enabled: true, shell }
    })
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow()
    expect(calls).toBe(0)
  })

  test('partial-remap envelope survives detached JSON snapshot as raw metadata', () => {
    const { graph, page } = previewFixture()
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    root.lowcodeApplication = {
      version: 1,
      enabled: true,
      startPageId: page.id,
      shell: { frameNodeId: 'shell', slotNodeId: 'slot' }
    }
    const policy = structuredClone(root.lowcodeApplication)
    graph.restoreNodeProperties(
      root.id,
      expectDefined(
        remapNodeApplicationReferences(root, (id) => (id === page.id ? 'new-page' : undefined)),
        'updates'
      ),
      ['lowcodeApplication']
    )
    const wire = JSON.stringify(captureFlutterPreviewSnapshot(graph, [page.id]))
    const parsed = validateFlutterPreviewSnapshot(JSON.parse(wire))
    const restored = editSnapshotNode(parsed, root.id)
    expect(restored.lowcodeApplication).toBeUndefined()
    expect(
      restored.pluginData.filter((entry) => entry.key === LOWCODE_APPLICATION_PLUGIN_KEY)
    ).toHaveLength(1)
    expect(JSON.parse(restored.pluginData[0].value)).toEqual({
      version: 1,
      unsupportedReason: 'incomplete-reference-remap',
      policy
    })
  })
})
