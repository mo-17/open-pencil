import { describe, expect, test } from 'bun:test'

import { componentAssetKey } from '@/app/assets/catalog'
import {
  componentTemplateAssetKey,
  filterComponentTemplateAssets,
  type ComponentTemplateAssetFilter
} from '@/app/assets/component-templates'
import { createAssetFavorites } from '@/app/assets/favorites'
import { getComponentTemplates } from '@/app/lowcode/component-templates'

const templates = getComponentTemplates('en')
const filter: ComponentTemplateAssetFilter = {
  source: 'template',
  category: 'all',
  kind: 'all',
  query: '',
  favoritesOnly: false,
  favorites: new Set()
}

describe('component template asset discovery', () => {
  test('keeps basic and combination choices distinct from existing asset sources', () => {
    const basic = filterComponentTemplateAssets(templates, { ...filter, kind: 'basic' })
    const combinations = filterComponentTemplateAssets(templates, {
      ...filter,
      kind: 'combination'
    })
    expect(basic).toHaveLength(54)
    expect(combinations).toHaveLength(12)
    expect(basic.every((item) => item.kind === 'basic')).toBe(true)
    expect(combinations.every((item) => item.kind === 'combination')).toBe(true)
    for (const source of ['local', 'library', 'plugin'] as const)
      expect(filterComponentTemplateAssets(templates, { ...filter, source })).toEqual([])
    expect(
      filterComponentTemplateAssets(templates, { ...filter, source: 'all', kind: 'basic' })
    ).toHaveLength(66)
  })

  test('combines category, localized search terms and favorites without changing the catalog', () => {
    const id = 'validated-form'
    const favorites = new Set([componentTemplateAssetKey(id)])
    const result = filterComponentTemplateAssets(templates, {
      ...filter,
      kind: 'combination',
      query: 'validated-form vue',
      favoritesOnly: true,
      favorites
    })
    expect(result.map((item) => item.id)).toEqual([id])
    expect(result[0]).toBe(templates.find((item) => item.id === id))
    expect(
      filterComponentTemplateAssets(templates, { ...filter, category: 'input' }).every(
        (item) => item.category === 'input'
      )
    ).toBe(true)
    const chinese = getComponentTemplates('zh-CN')
    const item = chinese.find((entry) => entry.id === 'validated-form')
    expect(item).toBeDefined()
    expect(
      filterComponentTemplateAssets(chinese, { ...filter, query: item?.name ?? 'missing' }).map(
        (entry) => entry.id
      )
    ).toContain(id)
    expect(
      filterComponentTemplateAssets(templates, { ...filter, query: 'validated-form missing' })
    ).toEqual([])
  })

  test('stores only a stable favorite identity, independently of document and translated name', () => {
    let stored: string | null = null
    const storage = {
      getItem: () => stored,
      setItem(_key: string, value: string) {
        stored = value
      }
    }
    const favoriteKey = componentTemplateAssetKey('upload')
    expect(favoriteKey).not.toBe(componentAssetKey('template', 'upload', null, null))
    const favorites = createAssetFavorites(storage)
    favorites.load()
    favorites.toggle(favoriteKey)
    const reopened = createAssetFavorites(storage).load()
    expect(reopened.keys).toEqual(new Set([favoriteKey]))
    expect(
      filterComponentTemplateAssets(getComponentTemplates('zh-CN'), {
        ...filter,
        favoritesOnly: true,
        favorites: reopened.keys
      }).map((item) => item.id)
    ).toEqual(['upload'])
    expect(stored).not.toContain('pluginId')
    expect(stored).not.toContain('capabilities')
  })
})
