import { afterEach, describe, expect, test } from 'bun:test'

import {
  APPLICATION_RUNTIME_GUIDE_LANGUAGE_STORAGE_KEY,
  applicationRuntimeGuideLanguagePreference,
  applicationRuntimeGuideExternalURL,
  applicationRuntimeGuideHeadings,
  applicationRuntimeGuideOpen,
  closeApplicationRuntimeGuide,
  normalizeApplicationRuntimeGuideLanguagePreference,
  openApplicationRuntimeGuide,
  persistApplicationRuntimeGuideLanguagePreference,
  prepareApplicationRuntimeGuideMarkdown,
  readApplicationRuntimeGuideLanguagePreference,
  resolveApplicationRuntimeGuideLanguage,
  setApplicationRuntimeGuideLanguagePreference
} from '@/app/help/application-runtime-guide'
import APPLICATION_RUNTIME_GUIDE_SOURCE from '@/app/help/application-runtime-guide.md?raw'
import APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE from '@/app/help/application-runtime-guide.zh-cn.md?raw'

afterEach(() => {
  closeApplicationRuntimeGuide()
  setApplicationRuntimeGuideLanguagePreference('follow-app')
})

class MemoryLanguageStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('bundled Application Runtime guide', () => {
  test('keeps the complete canonical guide in the application bundle source', () => {
    expect(APPLICATION_RUNTIME_GUIDE_SOURCE.length).toBeGreaterThan(20_000)
    expect(APPLICATION_RUNTIME_GUIDE_SOURCE).toContain('# Application Runtime Guide')
    expect(APPLICATION_RUNTIME_GUIDE_SOURCE).toContain('## Production Checklist')

    expect(APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE.length).toBeGreaterThan(15_000)
    expect(APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE).toContain('# 应用运行时指南')
    expect(APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE).toContain('## 生产检查清单')
  })

  test('converts website-only Markdown syntax for the embedded reader', () => {
    const markdown = prepareApplicationRuntimeGuideMarkdown(APPLICATION_RUNTIME_GUIDE_SOURCE)

    expect(markdown).not.toContain(':::')
    expect(markdown).not.toContain('(./lowcode-apps)')
    expect(markdown).not.toContain('```mermaid')
    expect(markdown).toContain('> **Warning: Production boundary**')
    expect(markdown).toContain('**Deployment flow**')
  })

  test('converts the Chinese guide without leaking English fallback UI', () => {
    const markdown = prepareApplicationRuntimeGuideMarkdown(
      APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE,
      'zh-CN'
    )

    expect(markdown).not.toContain(':::')
    expect(markdown).not.toContain('/zh-cn/user-guide/lowcode-apps')
    expect(markdown).not.toContain('```mermaid')
    expect(markdown).not.toContain('**Deployment flow**')
    expect(markdown).toContain('> **警告：生产边界**')
    expect(markdown).toContain('**部署流程**')
    expect(markdown).toContain('**低代码应用**')
  })

  test('builds a useful table of contents from level two and three headings', () => {
    const headings = applicationRuntimeGuideHeadings(
      prepareApplicationRuntimeGuideMarkdown(APPLICATION_RUNTIME_GUIDE_SOURCE)
    )

    expect(headings.length).toBeGreaterThan(15)
    expect(headings[0]).toEqual({ depth: 2, title: 'What You Will Deploy' })
    expect(headings.at(-1)).toEqual({ depth: 2, title: 'Production Checklist' })
  })

  test('builds the Chinese table of contents from the selected source', () => {
    const headings = applicationRuntimeGuideHeadings(
      prepareApplicationRuntimeGuideMarkdown(APPLICATION_RUNTIME_GUIDE_ZH_CN_SOURCE, 'zh-CN')
    )

    expect(headings.length).toBeGreaterThan(15)
    expect(headings[0]).toEqual({ depth: 2, title: '你将部署什么' })
    expect(headings.at(-1)).toEqual({ depth: 2, title: '生产检查清单' })
  })

  test('resolves follow-app and explicit guide language preferences', () => {
    expect(resolveApplicationRuntimeGuideLanguage('follow-app', 'zh-CN')).toBe('zh-CN')
    expect(resolveApplicationRuntimeGuideLanguage('follow-app', 'ja')).toBe('en')
    expect(resolveApplicationRuntimeGuideLanguage('en', 'zh-CN')).toBe('en')
    expect(resolveApplicationRuntimeGuideLanguage('zh-CN', 'en')).toBe('zh-CN')
    expect(normalizeApplicationRuntimeGuideLanguagePreference('invalid')).toBe('follow-app')
  })

  test('persists a validated guide language preference', () => {
    const storage = new MemoryLanguageStorage()

    expect(readApplicationRuntimeGuideLanguagePreference(storage)).toBe('follow-app')
    expect(persistApplicationRuntimeGuideLanguagePreference(storage, 'zh-CN')).toBe(true)
    expect(storage.getItem(APPLICATION_RUNTIME_GUIDE_LANGUAGE_STORAGE_KEY)).toBe('zh-CN')
    expect(readApplicationRuntimeGuideLanguagePreference(storage)).toBe('zh-CN')

    storage.setItem(APPLICATION_RUNTIME_GUIDE_LANGUAGE_STORAGE_KEY, 'tampered')
    expect(readApplicationRuntimeGuideLanguagePreference(storage)).toBe('follow-app')

    const blockedStorage = {
      getItem(): string | null {
        throw new Error('blocked')
      },
      setItem(): void {
        throw new Error('blocked')
      }
    }
    expect(readApplicationRuntimeGuideLanguagePreference(blockedStorage)).toBe('follow-app')
    expect(persistApplicationRuntimeGuideLanguagePreference(blockedStorage, 'en')).toBe(false)
  })

  test('updates the current-session guide preference even without persistent storage', () => {
    setApplicationRuntimeGuideLanguagePreference('zh-CN')
    expect(applicationRuntimeGuideLanguagePreference.value).toBe('zh-CN')
  })

  test('opens and closes without navigating away from the application', () => {
    expect(applicationRuntimeGuideOpen.value).toBe(false)
    openApplicationRuntimeGuide()
    expect(applicationRuntimeGuideOpen.value).toBe(true)
    closeApplicationRuntimeGuide()
    expect(applicationRuntimeGuideOpen.value).toBe(false)
  })

  test('allows only credential-free HTTPS references', () => {
    expect(applicationRuntimeGuideExternalURL('https://supabase.com/docs')).toBe(
      'https://supabase.com/docs'
    )
    expect(applicationRuntimeGuideExternalURL('http://supabase.com/docs')).toBeNull()
    expect(applicationRuntimeGuideExternalURL('https://user:secret@example.com/docs')).toBeNull()
    expect(applicationRuntimeGuideExternalURL(['javascript', ':alert(1)'].join(''))).toBeNull()
    expect(applicationRuntimeGuideExternalURL('./lowcode-apps')).toBeNull()
  })
})
