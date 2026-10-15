import { describe, expect, test } from 'bun:test'

import {
  resolveLowcodeApplicationPages,
  validateLowcodeApplicationPage
} from '#lowcode/application-mode'

import { SceneGraph } from '@open-pencil/scene-graph'

function fixture() {
  const graph = new SceneGraph()
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('Missing root')
  const page = graph.getPages()[0]
  const entry = graph.createNode('FRAME', page.id, { width: 390, height: 844 })
  root.lowcodeApplication = { version: 1, enabled: true }
  page.lowcodeApplicationPage = { version: 1, role: 'application', entryNodeId: entry.id }
  return { graph, root, page, entry }
}

describe('application page session retention contract', () => {
  test('absent policy preserves exact old canonical metadata and projection shape', () => {
    const { graph, page, entry } = fixture()
    const original = structuredClone(page.lowcodeApplicationPage)
    if (!original) throw new Error('Expected application page policy')
    expect(validateLowcodeApplicationPage(original)).toEqual({ ok: true, value: original })
    expect(resolveLowcodeApplicationPages(graph).pages).toEqual([
      { pageId: page.id, entryNodeId: entry.id }
    ])
    expect(Object.hasOwn(page.lowcodeApplicationPage ?? {}, 'stateRetention')).toBe(false)
  })

  test.each(['reset', 'preserve'] as const)(
    '%s is authored, detached and scoped only in application mode',
    (stateRetention) => {
      const { graph, root, page, entry } = fixture()
      const policy = {
        version: 1 as const,
        role: 'application' as const,
        entryNodeId: entry.id,
        stateRetention
      }
      const result = validateLowcodeApplicationPage(policy)
      expect(result).toEqual({ ok: true, value: policy })
      if (!result.ok) throw new Error('Valid policy rejected')
      expect(result.value).not.toBe(policy)
      page.lowcodeApplicationPage = result.value
      const before = structuredClone([...graph.nodes])
      expect(resolveLowcodeApplicationPages(graph).pages).toEqual([
        { pageId: page.id, entryNodeId: entry.id, stateRetention }
      ])
      expect([...graph.nodes]).toEqual(before)
      root.lowcodeApplication = { version: 1, enabled: false }
      expect(resolveLowcodeApplicationPages(graph).pages).toEqual([{ pageId: page.id }])
      expect(page.lowcodeApplicationPage.stateRetention).toBe(stateRetention)
    }
  )

  test('reference/components roles retain dormant preferences without entering runtime scope', () => {
    const { graph, page } = fixture()
    for (const role of ['reference', 'components'] as const) {
      const policy = { version: 1 as const, role, stateRetention: 'preserve' as const }
      expect(validateLowcodeApplicationPage(policy)).toEqual({ ok: true, value: policy })
      page.lowcodeApplicationPage = policy
      expect(resolveLowcodeApplicationPages(graph).pages).toEqual([])
    }
  })

  test('unknown, null, own undefined and accessor values fail closed without getter execution', () => {
    for (const stateRetention of ['cache', '', null, undefined, true, {}, ['preserve']])
      expect(
        validateLowcodeApplicationPage({ version: 1, role: 'application', stateRetention }).ok
      ).toBe(false)
    let reads = 0
    const accessor = {
      version: 1,
      role: 'application',
      get stateRetention() {
        reads++
        return 'preserve'
      }
    }
    expect(validateLowcodeApplicationPage(accessor).ok).toBe(false)
    expect(reads).toBe(0)
    const { graph, page } = fixture()
    Reflect.set(page, 'lowcodeApplicationPage', {
      version: 1,
      role: 'application',
      stateRetention: 'cache'
    })
    expect(resolveLowcodeApplicationPages(graph).pages).toEqual([])
    expect(resolveLowcodeApplicationPages(graph).warnings[0]?.code).toBe('application-page-invalid')
  })

  test('page clones retain detached session preferences while remapping entry IDs', () => {
    const { graph, page, entry } = fixture()
    page.lowcodeApplicationPage = {
      version: 1,
      role: 'application',
      entryNodeId: entry.id,
      stateRetention: 'preserve'
    }
    const copied = graph.cloneTree(page.id, graph.rootId)
    if (!copied?.lowcodeApplicationPage) throw new Error('Missing copied policy')
    expect(copied.lowcodeApplicationPage).toEqual({
      version: 1,
      role: 'application',
      entryNodeId: copied.childIds[0],
      stateRetention: 'preserve'
    })
    copied.lowcodeApplicationPage.stateRetention = 'reset'
    expect(page.lowcodeApplicationPage.stateRetention).toBe('preserve')
  })
})
