import { describe, expect, test } from 'bun:test'

import {
  LOWCODE_APPLICATION_PLUGIN_KEY,
  resolveLowcodeApplicationPages
} from '@open-pencil/lowcode'
import {
  SceneGraph,
  remapNodeApplicationReferences,
  type LowcodeApplicationV1
} from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

function rootPolicy(): LowcodeApplicationV1 {
  return {
    version: 1,
    enabled: true,
    startPageId: 'source-page',
    shell: { frameNodeId: 'source-shell', slotNodeId: 'source-slot' }
  }
}

function applicationNode() {
  const graph = new SceneGraph()
  const root = expectDefined(graph.getNode(graph.rootId), 'root')
  root.lowcodeApplication = rootPolicy()
  root.pluginData = [{ pluginId: 'foreign', key: 'keep', value: 'opaque' }]
  return { graph, root }
}

describe('application shell copy references', () => {
  test('atomically maps start/frame/deep slot and detaches the complete policy', () => {
    const { root } = applicationNode()
    const before = structuredClone(root.lowcodeApplication)
    const updates = expectDefined(
      remapNodeApplicationReferences(root, (id) => `target-${id}`),
      'updates'
    )
    expect(updates.lowcodeApplication).toEqual({
      version: 1,
      enabled: true,
      startPageId: 'target-source-page',
      shell: { frameNodeId: 'target-source-shell', slotNodeId: 'target-source-slot' }
    })
    expect(updates.pluginData).toBeUndefined()
    const shell = expectDefined(updates.lowcodeApplication?.shell, 'shell')
    shell.slotNodeId = 'edited'
    expect(root.lowcodeApplication).toEqual(before)
  })

  test('shell-only policy has no fabricated start declaration', () => {
    const { root } = applicationNode()
    delete root.lowcodeApplication?.startPageId
    const updates = expectDefined(
      remapNodeApplicationReferences(root, (id) => `new-${id}`),
      'updates'
    )
    expect(updates.lowcodeApplication).toEqual({
      version: 1,
      enabled: true,
      shell: { frameNodeId: 'new-source-shell', slotNodeId: 'new-source-slot' }
    })
    expect(Object.hasOwn(expectDefined(updates.lowcodeApplication, 'policy'), 'startPageId')).toBe(
      false
    )
  })

  test('any changed reference with missing declared mappings becomes stable inert data', () => {
    for (const mapped of ['source-page', 'source-shell', 'source-slot']) {
      const { graph, root } = applicationNode()
      const before = structuredClone(root.lowcodeApplication)
      const updates = expectDefined(
        remapNodeApplicationReferences(root, (id) => (id === mapped ? `new-${id}` : undefined)),
        'updates'
      )
      expect(Object.hasOwn(updates, 'lowcodeApplication')).toBe(true)
      expect(updates.lowcodeApplication).toBeUndefined()
      const raw = expectDefined(updates.pluginData, 'inert data')
      expect(raw[0]).toEqual(root.pluginData[0])
      const policies = raw.filter(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === LOWCODE_APPLICATION_PLUGIN_KEY
      )
      expect(policies).toHaveLength(1)
      expect(JSON.parse(policies[0].value)).toEqual({
        version: 1,
        unsupportedReason: 'incomplete-reference-remap',
        policy: before
      })
      graph.restoreNodeProperties(root.id, updates, ['lowcodeApplication'])
      expect(root.lowcodeApplication).toBeUndefined()
      expect(resolveLowcodeApplicationPages(graph).mode).toBe('invalid')
      expect(resolveLowcodeApplicationPages(graph).warnings[0]?.code).toBe('application-inert')
      expect(before).toEqual(rootPolicy())
    }
  })

  test('no changes or only identity mappings preserve existing original-reference semantics', () => {
    const { root } = applicationNode()
    expect(remapNodeApplicationReferences(root, () => undefined)).toBeNull()
    expect(remapNodeApplicationReferences(root, (id) => id)).toBeNull()
    expect(
      remapNodeApplicationReferences(root, (id) => (id === 'source-shell' ? id : undefined))
    ).toBeNull()
    const complete = remapNodeApplicationReferences(root, (id) =>
      id === 'source-page' ? 'new-page' : id
    )
    expect(complete?.lowcodeApplication?.startPageId).toBe('new-page')
    expect(complete?.lowcodeApplication?.shell).toEqual(root.lowcodeApplication?.shell)
  })

  test('legacy start and page entry mapping do not gain shell metadata', () => {
    const { root } = applicationNode()
    root.lowcodeApplication = { version: 1, enabled: false, startPageId: 'source-page' }
    root.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: 'source-entry' }
    expect(remapNodeApplicationReferences(root, (id) => `new-${id}`)).toEqual({
      lowcodeApplication: { version: 1, enabled: false, startPageId: 'new-source-page' },
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: 'new-source-entry' }
    })
  })

  test('nested accessors, foreign prototypes and malformed shell records never execute or get remapped', () => {
    let calls = 0
    const getter = () => {
      calls += 1
      return 'source-slot'
    }
    const valid = rootPolicy()
    const accessor = Object.defineProperty({ frameNodeId: 'source-shell' }, 'slotNodeId', {
      enumerable: true,
      get: getter
    })
    for (const shell of [
      accessor,
      undefined,
      null,
      [],
      Object.create({ frameNodeId: 'source-shell', slotNodeId: 'source-slot' }),
      { frameNodeId: 'source-shell', slotNodeId: 'source-slot', extra: true },
      { frameNodeId: 'source-shell', slotNodeId: '' },
      { frameNodeId: 'source-shell', slotNodeId: 'bad\nID' },
      { frameNodeId: 'source-shell', slotNodeId: 'x'.repeat(513) },
      { frameNodeId: 'source-shell', slotNodeId: 'source-slot', [Symbol('extra')]: true }
    ]) {
      const { root } = applicationNode()
      Object.assign(root, { lowcodeApplication: { ...valid, shell } })
      expect(remapNodeApplicationReferences(root, (id) => `new-${id}`)).toBeNull()
    }
    expect(calls).toBe(0)
  })

  test('existing inert policy remains opaque even when resolver knows every ID', () => {
    const { root } = applicationNode()
    root.pluginData.push({
      pluginId: 'open-pencil',
      key: LOWCODE_APPLICATION_PLUGIN_KEY,
      value: '{broken'
    })
    expect(remapNodeApplicationReferences(root, (id) => `new-${id}`)).toBeNull()
  })

  test('ordinary provider-page copying never changes the root shell choice', () => {
    const graph = new SceneGraph()
    const provider = graph.getPages()[0]
    provider.lowcodeApplicationPage = { version: 1, role: 'components' }
    const frame = graph.createNode('FRAME', provider.id, { name: 'Shell' })
    const column = graph.createNode('FRAME', frame.id, { name: 'Column' })
    const slot = graph.createNode('FRAME', column.id, { name: 'Slot' })
    const root = expectDefined(graph.getNode(graph.rootId), 'root')
    root.lowcodeApplication = {
      version: 1,
      enabled: false,
      shell: { frameNodeId: frame.id, slotNodeId: slot.id }
    }
    const before = structuredClone(root.lowcodeApplication)
    const cloned = expectDefined(graph.cloneTree(provider.id, root.id), 'cloned page')
    expect(cloned.id).not.toBe(provider.id)
    expect(root.lowcodeApplication).toEqual(before)
    expect(graph.getChildren(cloned.id)[0].id).not.toBe(frame.id)
  })

  test('graph clone remapper clears stale typed policy while retaining the complete inert envelope', () => {
    const { graph, root } = applicationNode()
    const before = structuredClone(root.lowcodeApplication)
    graph.remapClonedNodeReferences(new Map([['source-page', root.id]]))
    expect(root.lowcodeApplication).toBeUndefined()
    const raw = root.pluginData.filter((entry) => entry.key === LOWCODE_APPLICATION_PLUGIN_KEY)
    expect(raw).toHaveLength(1)
    expect(JSON.parse(raw[0].value)).toEqual({
      version: 1,
      unsupportedReason: 'incomplete-reference-remap',
      policy: before
    })
  })
})

for (const mode of ['copy', 'instance'] as const) {
  test(`an explicit application receiver scope retains other references and default ${mode} behavior`, () => {
    const { graph, root } = applicationNode()
    const page = graph.getPages()[0]
    const shell = graph.createNode('FRAME', page.id)
    const slot = graph.createNode('FRAME', shell.id)
    const target = graph.createNode('RECTANGLE', page.id)
    root.events = {
      onClick: [
        { id: 'play', kind: 'playMotion', targetNodeId: 'source-target', trackId: 'fade-in' }
      ]
    }
    const mapping = new Map([
      ['source-root', root.id],
      ['source-page', page.id],
      ['source-shell', shell.id],
      ['source-slot', slot.id],
      ['source-target', target.id]
    ])
    const before = structuredClone(root.lowcodeApplication)
    graph.remapClonedNodeReferences(mapping, mode, { applicationReferenceNodeIds: new Set() })
    expect(root.lowcodeApplication).toEqual(before)
    const action = root.events?.onClick?.[0]
    if (action?.kind !== 'playMotion') throw new Error('Missing Motion action')
    expect(action.targetNodeId).toBe(target.id)
    graph.remapClonedNodeReferences(mapping, mode)
    expect(root.lowcodeApplication).toEqual({
      version: 1,
      enabled: true,
      startPageId: page.id,
      shell: { frameNodeId: shell.id, slotNodeId: slot.id }
    })
  })
}
