import { expect, test } from 'bun:test'

import {
  applicationPageSessionSignature,
  createApplicationPageSessionCache
} from '@/app/lowcode/preview-pane/application-session/cache'
import type { PreviewPageSessionSnapshot } from '@/app/lowcode/preview-pane/iframe/messages'

import { applicationModeFixture } from '#tests/helpers/compiler/application-mode/fixture'

function fixture() {
  const data = applicationModeFixture(true)
  data.graph.updateNode(data.home.id, {
    lowcodeApplicationPage: {
      version: 1,
      role: 'application',
      entryNodeId: data.homeEntry.id,
      stateRetention: 'preserve'
    },
    state: [
      { id: 'filter', name: 'filter', type: 'string', defaultValue: '' },
      { id: 'page', name: 'page', type: 'number', defaultValue: 1 },
      { id: 'computed', name: 'computed', type: 'string', defaultValue: '', computedExpr: 'filter' }
    ]
  })
  const snapshot: PreviewPageSessionSnapshot = {
    version: 1,
    entries: [
      {
        pageId: data.home.id,
        pathname: '/home',
        search: '?tab=all',
        values: { filter: '手机', page: 3, computed: 'ignore', unknown: true },
        scroll: { x: 0, y: 480 }
      }
    ]
  }
  return { ...data, snapshot, cache: createApplicationPageSessionCache() }
}

test('same-document recompiles retain only writable declared page state and scroll without changing defaults', () => {
  const { graph, home, homeEntry, snapshot, cache } = fixture()
  const authored = structuredClone(graph.getNode(home.id)?.state)
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  graph.updateNode(homeEntry.id, { width: 430 })
  expect(cache.snapshot(graph, 'react').entries[0]).toEqual({
    ...snapshot.entries[0],
    values: { filter: '手机', page: 3 }
  })
  snapshot.entries[0].values.filter = 'changed outside'
  const detached = cache.snapshot(graph, 'react')
  detached.entries[0].values.page = 99
  expect(cache.snapshot(graph, 'react').entries[0].values).toEqual({ filter: '手机', page: 3 })
  expect(graph.getNode(home.id)?.state).toEqual(authored)
})

test('only preserved pages with matching concrete paths can enter the cache', () => {
  const { graph, products, snapshot, cache } = fixture()
  snapshot.entries.push({
    ...structuredClone(snapshot.entries[0]),
    pageId: products.id,
    pathname: '/products'
  })
  snapshot.entries.push({ ...structuredClone(snapshot.entries[0]), pageId: 'unknown' })
  snapshot.entries.push({ ...structuredClone(snapshot.entries[0]), pathname: '/outside' })
  snapshot.entries.push({
    ...structuredClone(snapshot.entries[0]),
    search: '?tab=other',
    values: { filter: false, page: 'bad type' }
  })
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  expect(
    cache
      .snapshot(graph, 'react')
      .entries.map((entry) => [entry.pathname, entry.search, entry.values])
  ).toEqual([
    ['/home', '?tab=all', { filter: '手机', page: 3 }],
    ['/home', '?tab=other', {}]
  ])
})

test('graph, framework, declarations, route and retention changes withdraw old session authority', () => {
  const { graph, home, snapshot, cache } = fixture()
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  expect(cache.snapshot(graph, 'vue').entries).toEqual([])
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  graph.updateNode(home.id, {
    state: [{ id: 'filter', name: 'filter', type: 'string', defaultValue: 'new' }]
  })
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  graph.updateNode(home.id, { lowcodeRoutePattern: '/new-home' })
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  graph.updateNode(home.id, {
    lowcodeRoutePattern: '/home',
    lowcodeApplicationPage: {
      ...graph.getNode(home.id)?.lowcodeApplicationPage,
      version: 1,
      role: 'application',
      stateRetention: 'reset'
    }
  })
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(false)
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  expect(cache.snapshot(applicationModeFixture(true).graph, 'react').entries).toEqual([])
})

test('invalid or oversized replacements remove stale snapshots and manual clearing starts a fresh session', () => {
  const { graph, snapshot, cache } = fixture()
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  const invalid = structuredClone(snapshot)
  invalid.entries[0].values.filter = '中'.repeat(65537)
  expect(cache.accept(graph, 'react', invalid, cache.authority(graph, 'react'))).toBe(false)
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react'))).toBe(true)
  cache.clear()
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
})

test('an old frame cannot resurrect data after a declaration change or clear, while geometry retains authority', () => {
  const { graph, home, homeEntry, snapshot, cache } = fixture()
  const frameAuthority = cache.authority(graph, 'react')
  expect(cache.accept(graph, 'react', snapshot, frameAuthority)).toBe(true)
  graph.updateNode(homeEntry.id, { width: 430 })
  expect(cache.authority(graph, 'react')).toBe(frameAuthority)
  graph.updateNode(home.id, {
    state: [{ id: 'filter', name: 'filter', type: 'string', defaultValue: 'updated default' }]
  })
  const nextAuthority = cache.authority(graph, 'react')
  expect(nextAuthority).not.toBe(frameAuthority)
  expect(cache.accept(graph, 'react', snapshot, frameAuthority)).toBe(false)
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  expect(cache.accept(graph, 'react', snapshot, nextAuthority)).toBe(true)
  cache.clear()
  expect(cache.accept(graph, 'react', snapshot, nextAuthority)).toBe(false)
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
})

test('a build completed after a newer declaration cannot acquire that declaration authority', () => {
  const { graph, home, homeEntry, snapshot, cache } = fixture()
  const sourceSignature = applicationPageSessionSignature(graph)
  expect(sourceSignature).not.toBeNull()
  graph.updateNode(homeEntry.id, { width: 430 })
  expect(applicationPageSessionSignature(graph)).toBe(sourceSignature)
  expect(cache.authority(graph, 'react', sourceSignature)).not.toBeNull()
  graph.updateNode(home.id, {
    state: [{ id: 'filter', name: 'filter', type: 'string', defaultValue: 'newer default' }]
  })
  const staleFrameAuthority = cache.authority(graph, 'react', sourceSignature)
  expect(staleFrameAuthority).toBeNull()
  expect(cache.accept(graph, 'react', snapshot, staleFrameAuthority)).toBe(false)
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  const currentSignature = applicationPageSessionSignature(graph)
  expect(currentSignature).not.toBe(sourceSignature)
  expect(
    cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react', currentSignature))
  ).toBe(true)
  expect(cache.authority(graph, 'react', null)).toBeNull()
  expect(applicationPageSessionSignature(applicationModeFixture(true).graph)).toBeNull()
})

test('guard changes on another application page withdraw cached data from an older build', () => {
  const { graph, products, productsEntry, snapshot, cache } = fixture()
  const signature = applicationPageSessionSignature(graph)
  const authority = cache.authority(graph, 'react', signature)
  expect(cache.accept(graph, 'react', snapshot, authority)).toBe(true)
  graph.updateNode(products.id, {
    lowcodeApplicationPage: {
      version: 1,
      role: 'application',
      entryNodeId: productsEntry.id,
      enterGuard: { conditionExpr: 'true', fallback: '/home' }
    }
  })
  const guardedSignature = applicationPageSessionSignature(graph)
  expect(guardedSignature).not.toBeNull()
  expect(guardedSignature).not.toBe(signature)
  expect(cache.authority(graph, 'react', signature)).toBeNull()
  expect(cache.accept(graph, 'react', snapshot, authority)).toBe(false)
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
  const guardedAuthority = cache.authority(graph, 'react', guardedSignature)
  expect(cache.accept(graph, 'react', snapshot, guardedAuthority)).toBe(true)
  graph.updateNode(products.id, {
    lowcodeApplicationPage: {
      version: 1,
      role: 'application',
      entryNodeId: productsEntry.id,
      enterGuard: { conditionExpr: 'false', fallback: '/home' },
      leaveConfirm: { dirtyExpr: 'true', message: 'Discard this draft?' }
    }
  })
  expect(cache.authority(graph, 'react', guardedSignature)).toBeNull()
  expect(cache.accept(graph, 'react', snapshot, guardedAuthority)).toBe(false)
})

test('guard input declarations invalidate recovery while unguarded default signatures remain stable', () => {
  const { graph, home, homeEntry, snapshot, cache } = fixture()
  const legacySignature = applicationPageSessionSignature(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [{ id: 'access', name: 'hasAccess', type: 'boolean', defaultValue: true }]
  })
  expect(applicationPageSessionSignature(graph)).toBe(legacySignature)
  graph.updateNode(home.id, {
    lowcodeApplicationPage: {
      version: 1,
      role: 'application',
      entryNodeId: homeEntry.id,
      stateRetention: 'preserve',
      enterGuard: { conditionExpr: 'hasAccess', fallback: '/products' }
    }
  })
  const signature = applicationPageSessionSignature(graph)
  expect(signature).not.toBeNull()
  expect(cache.accept(graph, 'react', snapshot, cache.authority(graph, 'react', signature))).toBe(
    true
  )
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      { id: 'access', name: 'hasAccess', type: 'boolean', defaultValue: false }
    ]
  })
  expect(cache.authority(graph, 'react', signature)).toBeNull()
  expect(cache.snapshot(graph, 'react').entries).toEqual([])
})
