import { describe, expect, test } from 'bun:test'

import { createRedirect } from 'cloudflare-redirect-parser'
import { uniq } from 'es-toolkit'

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

  test('uses translated pages for Chinese navigation and keeps English fallbacks', () => {
    const links = collectLinks(zhCnThemeConfig())
    const localizedLinks = uniq(links.filter((link) => link.startsWith('/zh-cn'))).sort()

    for (const link of localizedLinks)
      expect<readonly string[]>(ZH_CN_TRANSLATED_ROUTES).toContain(link)
    expect(links).toContain('/zh-cn/getting-started')
    expect(links).not.toContain('/zh-cn/guide/getting-started')
    expect(links).toContain('/guide/architecture')
    expect(links).toContain('/user-guide/canvas-navigation')
    expect(links).toContain('/programmable/sdk/')
    expect(links).toContain('/reference/keyboard-shortcuts')
    expect(links).toContain('/development/contributing')
    expect(links).toContain('/zh-cn/development/plugin-tutorial')
  })

  test('keeps canonical landing destinations reachable and redirects the legacy guide', async () => {
    const redirect = createRedirect(
      await Bun.file(new URL('../public/_redirects', import.meta.url)).text()
    )

    expect(redirect('/zh-cn/guide/getting-started')).toEqual({
      to: '/zh-cn/getting-started',
      status: 301
    })
    expect(redirect('/zh-cn/getting-started')).toBeUndefined()
    expect(redirect('/zh-cn/download')).toBeUndefined()
    expect(ZH_CN_TRANSLATED_ROUTES).toContain('/zh-cn/getting-started')
    expect(ZH_CN_TRANSLATED_ROUTES).toContain('/zh-cn/download')
    expect(await Bun.file(new URL('../zh-cn/getting-started.md', import.meta.url)).exists()).toBe(
      true
    )
    expect(await Bun.file(new URL('../zh-cn/download.md', import.meta.url)).exists()).toBe(true)
    expect(
      await Bun.file(new URL('../zh-cn/guide/getting-started.md', import.meta.url)).exists()
    ).toBe(false)
  })
})
