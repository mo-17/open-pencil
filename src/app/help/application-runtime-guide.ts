import { ref } from 'vue'

import { readLocalStorageText, writeLocalStorageText } from '@/app/cache'

export const APPLICATION_RUNTIME_GUIDE_MENU_ID = 'application-runtime-guide'
export const APPLICATION_RUNTIME_GUIDE_LANGUAGE_STORAGE_KEY =
  'open-pencil:application-runtime-guide-language:v1'

export const APPLICATION_RUNTIME_GUIDE_LANGUAGE_PREFERENCES = ['follow-app', 'zh-CN', 'en'] as const

export type ApplicationRuntimeGuideLanguagePreference =
  (typeof APPLICATION_RUNTIME_GUIDE_LANGUAGE_PREFERENCES)[number]
export type ApplicationRuntimeGuideContentLanguage = 'en' | 'zh-CN'

export interface ApplicationRuntimeGuideLanguageStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ApplicationRuntimeGuideHeading {
  depth: 2 | 3
  title: string
}

export const applicationRuntimeGuideOpen = ref(false)

export function normalizeApplicationRuntimeGuideLanguagePreference(
  value: unknown
): ApplicationRuntimeGuideLanguagePreference {
  return typeof value === 'string' &&
    APPLICATION_RUNTIME_GUIDE_LANGUAGE_PREFERENCES.includes(
      value as ApplicationRuntimeGuideLanguagePreference
    )
    ? (value as ApplicationRuntimeGuideLanguagePreference)
    : 'follow-app'
}

export function readApplicationRuntimeGuideLanguagePreference(
  storage: ApplicationRuntimeGuideLanguageStorage | null
): ApplicationRuntimeGuideLanguagePreference {
  if (!storage) return 'follow-app'
  try {
    return normalizeApplicationRuntimeGuideLanguagePreference(
      storage.getItem(APPLICATION_RUNTIME_GUIDE_LANGUAGE_STORAGE_KEY)
    )
  } catch {
    return 'follow-app'
  }
}

export function persistApplicationRuntimeGuideLanguagePreference(
  storage: ApplicationRuntimeGuideLanguageStorage | null,
  preference: ApplicationRuntimeGuideLanguagePreference
): boolean {
  if (!storage) return false
  try {
    storage.setItem(APPLICATION_RUNTIME_GUIDE_LANGUAGE_STORAGE_KEY, preference)
    return true
  } catch {
    return false
  }
}

function browserLanguageStorage(): ApplicationRuntimeGuideLanguageStorage | null {
  return {
    getItem: readLocalStorageText,
    setItem: writeLocalStorageText
  }
}

const languageStorage = browserLanguageStorage()

export const applicationRuntimeGuideLanguagePreference = ref(
  readApplicationRuntimeGuideLanguagePreference(languageStorage)
)

export function setApplicationRuntimeGuideLanguagePreference(
  preference: ApplicationRuntimeGuideLanguagePreference
): void {
  applicationRuntimeGuideLanguagePreference.value = preference
  persistApplicationRuntimeGuideLanguagePreference(languageStorage, preference)
}

export function resolveApplicationRuntimeGuideLanguage(
  preference: ApplicationRuntimeGuideLanguagePreference,
  appLocale: string
): ApplicationRuntimeGuideContentLanguage {
  if (preference === 'zh-CN' || preference === 'en') return preference
  return appLocale === 'zh-CN' ? 'zh-CN' : 'en'
}

export function openApplicationRuntimeGuide(): void {
  applicationRuntimeGuideOpen.value = true
}

export function closeApplicationRuntimeGuide(): void {
  applicationRuntimeGuideOpen.value = false
}

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/
const CONTAINER_RE = /^::: (warning|danger|tip)(?:\s+([^\n]+))?\n([\s\S]*?)^:::\s*$/gm
const MERMAID_FLOW_RE = /```mermaid\nflowchart LR[\s\S]*?\n```/
const PORTABLE_DEPLOYMENT_FLOWS: Record<ApplicationRuntimeGuideContentLanguage, string> = {
  en: [
    '**Deployment flow**',
    '',
    '`OpenPencil document` → `OpenPencil Compiler`',
    '',
    '- The compiler emits a static React SPA for the browser.',
    '- The SPA talks to Supabase Auth, Data API, Storage, and the deployed Edge Function.',
    '- The compiler separately emits a server-workflow bundle that you deploy to that Edge Function.'
  ].join('\n'),
  'zh-CN': [
    '**部署流程**',
    '',
    '`OpenPencil 文档` → `OpenPencil 编译器`',
    '',
    '- 编译器为浏览器输出静态 React SPA。',
    '- SPA 与 Supabase Auth、Data API、Storage 以及已部署的 Edge Function 通信。',
    '- 编译器还会单独输出服务端工作流包，由你部署到该 Edge Function。'
  ].join('\n')
}

const CONTAINER_LABELS = {
  en: {
    warning: 'Warning',
    danger: 'Important',
    tip: 'Tip'
  },
  'zh-CN': {
    warning: '警告',
    danger: '重要',
    tip: '提示'
  }
} as const

const INTERNAL_DOC_LINK_RE = /(?<!!)\[([^\]]+)]\((?:\.{1,2}\/|\/)[^)]+\)/g

function quoteContainerBody(body: string): string {
  return body
    .trim()
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

/** Convert the canonical guide's VitePress-only syntax into portable Markdown. */
export function prepareApplicationRuntimeGuideMarkdown(
  source: string,
  language: ApplicationRuntimeGuideContentLanguage = 'en'
): string {
  const containerLabels = CONTAINER_LABELS[language]
  return source
    .replace(/\r\n?/g, '\n')
    .replace(FRONTMATTER_RE, '')
    .replace(CONTAINER_RE, (_match, kind: keyof (typeof CONTAINER_LABELS)['en'], title, body) => {
      const label = containerLabels[kind]
      const heading = title ? `${label}${language === 'zh-CN' ? '：' : ': '}${title}` : label
      return `> **${heading}**\n>\n${quoteContainerBody(body)}`
    })
    .replace(MERMAID_FLOW_RE, PORTABLE_DEPLOYMENT_FLOWS[language])
    .replace(INTERNAL_DOC_LINK_RE, '**$1**')
    .trim()
}

function plainHeadingTitle(source: string): string {
  return source
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_]/g, '')
    .trim()
}

export function applicationRuntimeGuideHeadings(
  markdown: string
): ApplicationRuntimeGuideHeading[] {
  return [...markdown.matchAll(/^(#{2,3})\s+(.+?)\s*$/gm)].map((match) => ({
    depth: match[1].length as 2 | 3,
    title: plainHeadingTitle(match[2])
  }))
}

export function applicationRuntimeGuideExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
