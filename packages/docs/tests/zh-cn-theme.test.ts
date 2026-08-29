import { describe, expect, test } from 'bun:test'

import { docsLocales, docsLocalesFor } from '../.vitepress/locales'
import { ZH_CN_TRANSLATED_ROUTES, zhCnThemeConfig } from '../.vitepress/zh-cn-theme'

function collectLinks(value: unknown, links: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLinks(item, links)
    return links
  }
  if (!value || typeof value !== 'object') return links

  if ('link' in value && typeof value.link === 'string') links.push(value.link)
  for (const [key, item] of Object.entries(value)) {
    if (key !== 'link') collectLinks(item, links)
  }
  return links
}

describe('Simplified Chinese documentation theme', () => {
  test('registers the locale with Chinese metadata', () => {
    expect(Object.keys(docsLocales)).toEqual(['root', 'zh-cn'])
    expect(docsLocales['zh-cn'].label).toBe('简体中文')
    expect(docsLocales['zh-cn'].lang).toBe('zh-CN')
  })

  test('can explicitly re-enable an archived locale without changing the default', () => {
    const locales = docsLocalesFor(['en', 'de', 'zh-cn'])

    expect(Object.keys(locales)).toEqual(['root', 'de', 'zh-cn'])
    expect(locales.de.label).toBe('Deutsch')
  })

  test('uses zh-cn links only for routes with planned translations', () => {
    const links = collectLinks(zhCnThemeConfig())
    const localizedLinks = [...new Set(links.filter((link) => link.startsWith('/zh-cn')))].sort()

    expect(localizedLinks).toEqual([...ZH_CN_TRANSLATED_ROUTES].sort())
    expect(links).toContain('/guide/architecture')
    expect(links).toContain('/user-guide/canvas-navigation')
    expect(links).toContain('/programmable/sdk/')
    expect(links).toContain('/reference/keyboard-shortcuts')
    expect(links).toContain('/development/contributing')
    expect(links).toContain('/zh-cn/development/plugin-tutorial')
  })
})
