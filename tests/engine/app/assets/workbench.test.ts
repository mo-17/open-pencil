import { describe, expect, test } from 'bun:test'

import { componentAssetKey, matchesAssetQuery, moduleAssetCategory } from '@/app/assets/catalog'
import {
  ASSET_FAVORITES_STORAGE_KEY,
  createAssetFavorites,
  type AssetFavoritesStorage
} from '@/app/assets/favorites'
import { captureAssetTarget } from '@/app/assets/target'

function memoryStorage(initial: string | null = null): AssetFavoritesStorage {
  const values = new Map(initial === null ? [] : [[ASSET_FAVORITES_STORAGE_KEY, initial]])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe('asset workbench discovery', () => {
  test('searches every term across name, description and source', () => {
    expect(matchesAssetQuery(' profile CUSTOMER ', 'Profile card', 'Customer details', 'CRM')).toBe(
      true
    )
    expect(matchesAssetQuery('编辑说明', '资料卡', '客户资料编辑说明')).toBe(true)
    expect(matchesAssetQuery('missing', 'Profile card', null)).toBe(false)
    expect(matchesAssetQuery('  ', 'Profile card')).toBe(true)
  })
  test('uses reviewed module roles with a neutral fallback', () => {
    expect(moduleAssetCategory('slide-menu')).toBe('navigation')
    expect(moduleAssetCategory('vr-tour')).toBe('media')
    expect(moduleAssetCategory('upload-button')).toBe('input')
    expect(moduleAssetCategory('modal')).toBe('feedback')
    expect(moduleAssetCategory('unrecognized')).toBe('components')
  })
  test('namespaces local favorites by document and keeps library favorites across revisions', () => {
    expect(componentAssetKey('first', '1:2', null, null)).not.toBe(
      componentAssetKey('second', '1:2', null, null)
    )
    expect(componentAssetKey('first', 'lib:old', 'lib', 'asset')).toBe(
      componentAssetKey('second', 'lib:new', 'lib', 'asset')
    )
    expect(componentAssetKey('first:a', 'b', null, null)).not.toBe(
      componentAssetKey('first', 'a:b', null, null)
    )
  })
})

describe('user asset favorites', () => {
  test('persists favorite and removal across store recreation without document mutation', () => {
    const storage = memoryStorage()
    const first = createAssetFavorites(storage)
    first.load()
    expect(first.toggle('plugin:map')).toEqual({
      keys: new Set(['plugin:map']),
      persistenceFailed: false
    })
    const reopened = createAssetFavorites(storage)
    expect(reopened.load().keys.has('plugin:map')).toBe(true)
    reopened.toggle('plugin:map')
    expect(createAssetFavorites(storage).load().keys.size).toBe(0)
  })
  test('retains session changes with a visible failure outcome when writes are denied, then retries', () => {
    const backing = memoryStorage()
    let fail = true
    const favorites = createAssetFavorites({
      getItem: backing.getItem,
      setItem(key, value) {
        if (fail) throw new Error('quota')
        backing.setItem(key, value)
      }
    })
    favorites.load()
    expect(favorites.toggle('plugin:map')).toEqual({
      keys: new Set(['plugin:map']),
      persistenceFailed: true
    })
    fail = false
    expect(favorites.toggle('plugin:chart').persistenceFailed).toBe(false)
    expect(createAssetFavorites(backing).load().keys).toEqual(
      new Set(['plugin:map', 'plugin:chart'])
    )
  })
  test.each([
    'invalid',
    JSON.stringify({ version: 2, keys: ['future'] }),
    JSON.stringify({ version: 1, keys: [5] })
  ])('preserves unreadable preference data: %s', (raw) => {
    const storage = memoryStorage(raw)
    const favorites = createAssetFavorites(storage)
    expect(favorites.load().persistenceFailed).toBe(true)
    expect(favorites.toggle('session-only').keys.has('session-only')).toBe(true)
    expect(storage.getItem(ASSET_FAVORITES_STORAGE_KEY)).toBe(raw)
  })
  test('reports denied reads without discarding session choices', () => {
    const backing = memoryStorage()
    let fail = false
    const favorites = createAssetFavorites({
      getItem(key) {
        if (fail) throw new Error('denied')
        return backing.getItem(key)
      },
      setItem: backing.setItem
    })
    favorites.load()
    favorites.toggle('plugin:map')
    fail = true
    expect(favorites.load()).toEqual({ keys: new Set(['plugin:map']), persistenceFailed: true })
  })
  test('rejects oversized and invalid keys', () => {
    const favorites = createAssetFavorites(memoryStorage())
    expect(favorites.toggle('x'.repeat(4097)).persistenceFailed).toBe(true)
    expect(favorites.toggle('').keys.size).toBe(0)
  })
})

describe('async asset target guard', () => {
  test.each(['graph', 'pageId', 'parentId', 'sourceIdentity'] as const)(
    'rejects a changed %s before insertion',
    (field) => {
      let target = {
        graph: {},
        pageId: 'page',
        parentId: null as string | null,
        sourceIdentity: {}
      }
      const current = captureAssetTarget(() => target)
      expect(current()).toBe(true)
      target = {
        ...target,
        [field]: field === 'graph' || field === 'sourceIdentity' ? {} : 'different'
      }
      expect(current()).toBe(false)
    }
  )
  test('does not reject an unchanged target merely because a snapshot was reread', () => {
    const graph = {},
      sourceIdentity = {}
    const current = captureAssetTarget(() => ({
      graph,
      pageId: 'page',
      parentId: null,
      sourceIdentity
    }))
    expect(current()).toBe(true)
  })
})
