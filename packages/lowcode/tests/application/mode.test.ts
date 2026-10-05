import { describe, expect, test } from 'bun:test'

import {
  LOWCODE_APPLICATION_PLUGIN_KEY,
  LOWCODE_APPLICATION_PAGE_PLUGIN_KEY,
  resolveLowcodeApplicationPages,
  validateLowcodeApplication,
  validateLowcodeApplicationPage
} from '#lowcode/application-mode'

import { SceneGraph } from '@open-pencil/scene-graph'

function expectDefined<T>(value: T | null | undefined, label = 'fixture'): T {
  if (value === null || value === undefined) throw new Error(label)
  return value
}

function fixture() {
  const graph = new SceneGraph()
  const root = expectDefined(graph.getNode(graph.rootId), 'root')
  const first = graph.getPages()[0]
  const second = graph.addPage('Second')
  const firstEntry = graph.createNode('FRAME', first.id, { width: 360, height: 720 })
  const secondEntry = graph.createNode('FRAME', second.id, { width: 360, height: 720 })
  first.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: firstEntry.id }
  second.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: secondEntry.id }
  root.lowcodeApplication = { version: 1, enabled: true, startPageId: second.id }
  return { graph, root, first, second, firstEntry, secondEntry }
}

describe('application data contracts', () => {
  test('canonical detached root/page policies and all roles', () => {
    for (const enabled of [true, false]) {
      const value = { version: 1, enabled, startPageId: 'page-1' }
      const parsed = validateLowcodeApplication(value)
      expect(parsed).toEqual({ ok: true, value })
      if (parsed.ok) expect(parsed.value).not.toBe(value)
    }
    for (const role of ['application', 'reference', 'components'])
      expect(validateLowcodeApplicationPage({ version: 1, role })).toEqual({
        ok: true,
        value: { version: 1, role }
      })
    expect(
      validateLowcodeApplication(Object.assign(Object.create(null), { version: 1, enabled: false }))
        .ok
    ).toBe(true)
    expect(
      validateLowcodeApplicationPage({
        version: 1,
        role: 'application',
        entryNodeId: 'x'.repeat(512)
      }).ok
    ).toBe(true)
  })

  test('strict versions, keys, types, optional identifiers and hostile descriptors', () => {
    for (const value of [
      null,
      [],
      false,
      {},
      { version: 2, enabled: true },
      { version: 1, enabled: 1 },
      { version: 1, enabled: true, extra: true },
      { version: 1, enabled: true, [Symbol('bad')]: 0 },
      Object.create({ version: 1, enabled: true })
    ])
      expect(validateLowcodeApplication(value).ok).toBe(false)
    for (const role of ['unknown', 1, null])
      expect(validateLowcodeApplicationPage({ version: 1, role }).ok).toBe(false)
    for (const id of [
      undefined,
      null,
      '',
      ' ',
      ' page',
      'page ',
      'a\nb',
      'a\u007fb',
      'a\u0085b',
      'x'.repeat(513),
      1
    ]) {
      expect(validateLowcodeApplication({ version: 1, enabled: true, startPageId: id }).ok).toBe(
        false
      )
      expect(
        validateLowcodeApplicationPage({ version: 1, role: 'application', entryNodeId: id }).ok
      ).toBe(false)
    }
    let calls = 0
    const accessor = {
      version: 1,
      get enabled() {
        calls++
        return true
      }
    }
    expect(validateLowcodeApplication(accessor).ok).toBe(false)
    expect(calls).toBe(0)
    const throwing = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('hostile')
        }
      }
    )
    expect(validateLowcodeApplication(throwing).ok).toBe(false)
    expect(validateLowcodeApplicationPage(throwing).ok).toBe(false)
  })
})

describe('shared application page scope', () => {
  test('enabled policy requires the actual document FRAME root; legacy modes keep old graph semantics', () => {
    for (const changes of [
      { type: 'CANVAS' },
      { parentId: 'another-node' },
      { id: 'different-root-id' }
    ]) {
      const { graph, root, first, second } = fixture()
      Object.assign(root, changes)
      const requested = [second.id, first.id]
      const blocked = resolveLowcodeApplicationPages(graph, requested)
      expect(blocked.mode).toBe('invalid')
      expect(blocked.pages).toEqual([])
      expect(blocked.warnings.map((warning) => warning.code)).toEqual(['application-invalid'])
      root.lowcodeApplication = { version: 1, enabled: false }
      expect(resolveLowcodeApplicationPages(graph, requested)).toEqual({
        mode: 'legacy',
        pages: requested.map((pageId) => ({ pageId })),
        warnings: []
      })
      root.lowcodeApplication = undefined
      expect(resolveLowcodeApplicationPages(graph, requested)).toEqual({
        mode: 'legacy',
        pages: requested.map((pageId) => ({ pageId })),
        warnings: []
      })
    }
  })

  test('absence/disabled preserve exact requested ordering without changing graph', () => {
    const { graph, root, first, second } = fixture()
    const requested = [second.id, first.id, second.id]
    root.lowcodeApplication = undefined
    expect(resolveLowcodeApplicationPages(graph, requested)).toEqual({
      mode: 'legacy',
      pages: requested.map((pageId) => ({ pageId })),
      warnings: []
    })
    root.lowcodeApplication = { version: 1, enabled: false, startPageId: 'unresolved' }
    Object.assign(first, { lowcodeApplicationPage: { version: 2 } })
    const before = structuredClone([...graph.nodes])
    expect(
      resolveLowcodeApplicationPages(graph, requested).pages.map((item) => item.pageId)
    ).toEqual(requested)
    expect([...graph.nodes]).toEqual(before)
  })

  test('application roles, start ordering and explicit subsets share one projection', () => {
    const { graph, first, second, firstEntry, secondEntry } = fixture()
    const reference = graph.addPage('Design')
    reference.lowcodeApplicationPage = { version: 1, role: 'reference' }
    const masters = graph.addPage('Components')
    masters.lowcodeApplicationPage = { version: 1, role: 'components' }
    graph.addPage('Legacy')
    const before = structuredClone([...graph.nodes])
    expect(resolveLowcodeApplicationPages(graph)).toEqual({
      mode: 'application',
      pages: [
        { pageId: second.id, entryNodeId: secondEntry.id },
        { pageId: first.id, entryNodeId: firstEntry.id }
      ],
      warnings: []
    })
    const subset = resolveLowcodeApplicationPages(graph, [first.id])
    expect(subset.pages).toEqual([{ pageId: first.id, entryNodeId: firstEntry.id }])
    expect(subset.warnings.map((item) => item.code)).toEqual(['application-start-invalid'])
    expect([...graph.nodes]).toEqual(before)
  })

  test('malformed native/root inert data fails closed, never becomes legacy', () => {
    const { graph, root } = fixture()
    Object.assign(root, { lowcodeApplication: { version: 2, enabled: true } })
    expect(resolveLowcodeApplicationPages(graph).mode).toBe('invalid')
    root.lowcodeApplication = undefined
    root.pluginData = [
      { pluginId: 'open-pencil', key: LOWCODE_APPLICATION_PLUGIN_KEY, value: '{broken' }
    ]
    expect(resolveLowcodeApplicationPages(graph)).toEqual({
      mode: 'invalid',
      pages: [],
      warnings: [
        {
          code: 'application-inert',
          nodeId: root.id,
          message: 'Application policy is preserved as inert plugin data.'
        }
      ]
    })
  })

  test('missing/hidden/nested/locked/library/internal/non-FRAME entries never activate', () => {
    for (const changes of [
      { visible: false },
      { locked: true },
      { internalOnly: true },
      { libraryId: 'lib' },
      { libraryReadonly: true },
      { type: 'COMPONENT' },
      { parentId: 'other' }
    ]) {
      const { graph, first, firstEntry, root } = fixture()
      Object.assign(firstEntry, changes)
      root.lowcodeApplication = { version: 1, enabled: true }
      const result = resolveLowcodeApplicationPages(graph, [first.id])
      expect(result.pages).toEqual([])
      expect(result.warnings.map((item) => item.code)).toEqual([
        'application-entry-invalid',
        'application-pages-empty'
      ])
    }
    const { graph, first, root } = fixture()
    root.lowcodeApplication = { version: 1, enabled: true }
    first.pluginData = [
      { pluginId: 'open-pencil', key: LOWCODE_APPLICATION_PAGE_PLUGIN_KEY, value: '{}' }
    ]
    expect(resolveLowcodeApplicationPages(graph, [first.id]).warnings[0]?.code).toBe(
      'application-page-inert'
    )
    first.pluginData = []
    first.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: 'missing' }
    expect(resolveLowcodeApplicationPages(graph, [first.id]).warnings[0]?.code).toBe(
      'application-entry-invalid'
    )
    first.lowcodeApplicationPage = undefined
    expect(resolveLowcodeApplicationPages(graph, [first.id]).warnings[0]?.code).toBe(
      'application-pages-empty'
    )
  })

  test('page cloning detaches metadata and remaps its included entry while preserving source', () => {
    const { graph, first, firstEntry, root } = fixture()
    const clone = expectDefined(graph.cloneTree(first.id, root.id), 'clone')
    expect(clone.lowcodeApplicationPage?.entryNodeId).toBe(clone.childIds[0])
    expect(clone.lowcodeApplicationPage).not.toBe(first.lowcodeApplicationPage)
    expect(first.lowcodeApplicationPage?.entryNodeId).toBe(firstEntry.id)
    expectDefined(clone.lowcodeApplicationPage, 'policy').role = 'reference'
    expect(first.lowcodeApplicationPage?.role).toBe('application')
  })
})
