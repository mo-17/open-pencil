import { describe, expect, test } from 'bun:test'

import {
  captureFlutterPreviewSnapshot,
  validateFlutterPreviewSnapshot
} from '@open-pencil/compiler/flutter-preview'
import {
  LOWCODE_APPLICATION_PLUGIN_KEY,
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY
} from '@open-pencil/lowcode'

import { expectDefined } from '#tests/helpers/assert'

import { editSnapshotNode, previewFixture } from './helpers'

function snapshotWire(...args: Parameters<typeof captureFlutterPreviewSnapshot>): string {
  return JSON.stringify(captureFlutterPreviewSnapshot(...args))
}

describe('Flutter application mode snapshot contract', () => {
  test('enabled root ownership requires FRAME while legacy root types remain accepted', () => {
    const { graph, page } = previewFixture()
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    root.type = 'CANVAS'
    const absent = captureFlutterPreviewSnapshot(graph, [page.id])
    expect(editSnapshotNode(absent, root.id).type).toBe('CANVAS')
    root.lowcodeApplication = { version: 1, enabled: false }
    const disabled = captureFlutterPreviewSnapshot(graph, [page.id])
    expect(editSnapshotNode(disabled, root.id).lowcodeApplication).toEqual({
      version: 1,
      enabled: false
    })
    root.lowcodeApplication = { version: 1, enabled: true }
    expect(() => captureFlutterPreviewSnapshot(graph, [page.id])).toThrow(
      'Invalid Flutter preview snapshot'
    )
    root.type = 'FRAME'
    const enabled = captureFlutterPreviewSnapshot(graph, [page.id])
    editSnapshotNode(enabled, root.id).type = 'CANVAS'
    expect(() => validateFlutterPreviewSnapshot(enabled)).toThrow(
      'Invalid Flutter preview snapshot'
    )
  })

  test('captures and parses detached root/page metadata and keeps all design nodes', () => {
    const { graph, page, frame } = previewFixture()
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    root.lowcodeApplication = { version: 1, enabled: true, startPageId: page.id }
    page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: frame.id }
    const extra = graph.addPage('Reference')
    extra.lowcodeApplicationPage = { version: 1, role: 'reference' }
    const wire = JSON.stringify(captureFlutterPreviewSnapshot(graph, [page.id]))
    const parsed = validateFlutterPreviewSnapshot(JSON.parse(wire))
    expect(editSnapshotNode(parsed, root.id).lowcodeApplication).toEqual(root.lowcodeApplication)
    expect(editSnapshotNode(parsed, page.id).lowcodeApplicationPage).toEqual(
      page.lowcodeApplicationPage
    )
    expect(editSnapshotNode(parsed, extra.id).lowcodeApplicationPage).toEqual({
      version: 1,
      role: 'reference'
    })
    expect(parsed.graph.nodes.length).toBe(graph.nodes.size)
    expect(parsed.pageIds).toEqual([page.id])
    root.lowcodeApplication.enabled = false
    page.lowcodeApplicationPage.entryNodeId = 'changed'
    expect(editSnapshotNode(parsed, root.id).lowcodeApplication?.enabled).toBe(true)
    expect(editSnapshotNode(parsed, page.id).lowcodeApplicationPage?.entryNodeId).toBe(frame.id)
  })

  test('legacy snapshot does not fabricate application metadata; disabled roundtrip is explicit', () => {
    const { graph, page } = previewFixture()
    const snapshot = captureFlutterPreviewSnapshot(graph, [page.id])
    for (const [, node] of snapshot.graph.nodes) {
      expect(Object.hasOwn(node, 'lowcodeApplication')).toBe(false)
      expect(Object.hasOwn(node, 'lowcodeApplicationPage')).toBe(false)
    }
    expectDefined(graph.getNode(graph.rootId), 'root').lowcodeApplication = {
      version: 1,
      enabled: false
    }
    const parsed = validateFlutterPreviewSnapshot(JSON.parse(snapshotWire(graph, [page.id])))
    expect(editSnapshotNode(parsed, graph.rootId).lowcodeApplication).toEqual({
      version: 1,
      enabled: false
    })
  })

  test('rejects malformed/future/extra native fields and invalid field ownership', () => {
    const { graph, page, frame } = previewFixture()
    for (const [ownerId, field, value] of [
      [graph.rootId, 'lowcodeApplication', { version: 2, enabled: true }],
      [graph.rootId, 'lowcodeApplication', { version: 1, enabled: 'yes' }],
      [graph.rootId, 'lowcodeApplication', { version: 1, enabled: true, future: 1 }],
      [page.id, 'lowcodeApplication', { version: 1, enabled: true }],
      [graph.rootId, 'lowcodeApplicationPage', { version: 1, role: 'reference' }],
      [frame.id, 'lowcodeApplicationPage', { version: 1, role: 'reference' }],
      [page.id, 'lowcodeApplicationPage', { version: 1, role: 'future' }],
      [page.id, 'lowcodeApplicationPage', { version: 1, role: 'application', entryNodeId: null }]
    ] as const) {
      const snapshot = captureFlutterPreviewSnapshot(graph, [page.id])
      Object.assign(editSnapshotNode(snapshot, ownerId), { [field]: value })
      expect(() => validateFlutterPreviewSnapshot(snapshot)).toThrow(
        'Invalid Flutter preview snapshot'
      )
    }
  })

  test('future raw plugin metadata stays inert in snapshot instead of dropping it', () => {
    const { graph, page } = previewFixture()
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    root.pluginData = [
      {
        pluginId: 'open-pencil',
        key: LOWCODE_APPLICATION_PLUGIN_KEY,
        value: '{"version":2,"enabled":true}'
      }
    ]
    page.pluginData = [
      { pluginId: 'open-pencil', key: LOWCODE_APPLICATION_PAGE_PLUGIN_KEY, value: '{broken' }
    ]
    const parsed = validateFlutterPreviewSnapshot(JSON.parse(snapshotWire(graph, [page.id])))
    expect(editSnapshotNode(parsed, root.id).pluginData).toEqual(root.pluginData)
    expect(editSnapshotNode(parsed, page.id).pluginData).toEqual(page.pluginData)
    expect(editSnapshotNode(parsed, root.id).lowcodeApplication).toBeUndefined()
    expect(editSnapshotNode(parsed, page.id).lowcodeApplicationPage).toBeUndefined()
  })
})
