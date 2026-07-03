import type {
  LowcodeHeadLink,
  LowcodeHeadLinkCrossOrigin,
  LowcodeHeadMeta,
  LowcodeHeadMetaKind,
  LowcodeHeadMetadata
} from '@open-pencil/core/scene-graph'
import {
  unsafeLowcodeCustomCssUrls,
  validateLowcodeCustomCss
} from '@open-pencil/core/lowcode-validation'

export const LOWCODE_HEAD_META_KINDS: LowcodeHeadMetaKind[] = ['name', 'property', 'httpEquiv']

export const LOWCODE_HEAD_LINK_CROSS_ORIGINS: LowcodeHeadLinkCrossOrigin[] = [
  'anonymous',
  'use-credentials'
]

export interface CustomCodeDraft {
  meta: LowcodeHeadMeta[]
  link: LowcodeHeadLink[]
  stylesText: string
  customCss: string
}

export interface CustomCodePatch {
  lowcodeHeadMetadata?: LowcodeHeadMetadata
  lowcodeCustomCss?: string
}

export interface CustomCodeCspRisk {
  id: string
  title: string
  detail: string
}

export function emptyHeadMeta(): LowcodeHeadMeta {
  return { kind: 'name', key: '', content: '' }
}

export function emptyHeadLink(): LowcodeHeadLink {
  return { rel: '', href: '' }
}

export function draftFromCustomCode(
  head: LowcodeHeadMetadata | undefined,
  customCss: string | undefined
): CustomCodeDraft {
  return {
    meta: head?.meta?.length ? head.meta.map((entry) => ({ ...entry })) : [],
    link: head?.link?.length ? head.link.map((entry) => ({ ...entry })) : [],
    stylesText: head?.styles?.join('\n\n') ?? '',
    customCss: customCss ?? ''
  }
}

export function buildCustomCodePatch(draft: CustomCodeDraft): CustomCodePatch {
  const meta = draft.meta
    .map((entry) => ({
      kind: entry.kind,
      key: entry.key.trim(),
      content: entry.content.trim()
    }))
    .filter((entry) => entry.key && entry.content)

  const link = draft.link
    .map((entry) => compactHeadLink(entry))
    .filter((entry) => entry.rel && isSafeHeadLinkHref(entry.href))

  const styles = draft.stylesText
    .split(/\n{2,}/)
    .map((style) => style.trim())
    .filter((style) => style && validateLowcodeCustomCss(style).ok)

  const head: LowcodeHeadMetadata = {}
  if (meta.length > 0) head.meta = meta
  if (link.length > 0) head.link = link
  if (styles.length > 0) head.styles = styles

  const customCss = draft.customCss.trim()
  return {
    lowcodeHeadMetadata: Object.keys(head).length > 0 ? head : undefined,
    lowcodeCustomCss: customCss && validateLowcodeCustomCss(customCss).ok ? customCss : undefined
  }
}

export function hasIncompleteCustomCodeRows(draft: CustomCodeDraft): boolean {
  return (
    draft.meta.some((entry) => {
      const key = entry.key.trim()
      const content = entry.content.trim()
      return (key || content) && (!key || !content)
    }) ||
    draft.link.some((entry) => {
      const rel = entry.rel.trim()
      const href = entry.href.trim()
      return (rel || href) && (!rel || !href)
    })
  )
}

export function hasUnsafeCustomCodeUrls(draft: CustomCodeDraft): boolean {
  return unsafeLowcodeCustomCssUrls(`${draft.stylesText}\n${draft.customCss}`).length > 0
}

export function analyzeCustomCodeCspRisks(draft: CustomCodeDraft): CustomCodeCspRisk[] {
  const risks: CustomCodeCspRisk[] = []
  const styles = draft.stylesText.trim()
  const customCss = draft.customCss.trim()
  if (styles) {
    risks.push({
      id: 'inline-head-style',
      title: 'Inline head styles may require CSP allowance',
      detail:
        'Hosts with strict CSP must allow inline styles by nonce/hash or style-src unsafe-inline.'
    })
  }
  for (const url of unsafeLowcodeCustomCssUrls(styles)) {
    risks.push({
      id: `head-style-unsafe-url:${url}`,
      title: 'Head style URL protocol will not be persisted',
      detail: `${url} uses a protocol outside the allowed http(s), protocol-relative, or relative URL set.`
    })
  }

  for (const link of draft.link) {
    const rel = link.rel.trim().toLowerCase()
    const href = link.href.trim()
    if (!href || !isExternalUrl(href)) continue
    if (rel === 'stylesheet') {
      risks.push({
        id: `external-stylesheet:${href}`,
        title: 'External stylesheet needs style-src allowlist',
        detail: `${href} must be allowed by the deployed host CSP.`
      })
      continue
    }
    if (rel === 'preload' || rel === 'preconnect') {
      const directive = cspDirectiveForLink(link)
      risks.push({
        id: `external-${rel}:${href}`,
        title: `External ${rel} may need ${directive} allowlist`,
        detail: `${href} must be allowed by ${directive} or the matching resource directive.`
      })
    }
  }

  for (const url of cssExternalUrls(customCss)) {
    risks.push({
      id: `custom-css-url:${url}`,
      title: 'Custom CSS references an external resource',
      detail: `${url} must be allowed by the deployed host CSP resource directives.`
    })
  }
  for (const url of unsafeLowcodeCustomCssUrls(customCss)) {
    risks.push({
      id: `custom-css-unsafe-url:${url}`,
      title: 'Custom CSS URL protocol will not be persisted',
      detail: `${url} uses a protocol outside the allowed http(s), protocol-relative, or relative URL set.`
    })
  }

  return dedupeRisks(risks)
}

function compactHeadLink(entry: LowcodeHeadLink): LowcodeHeadLink {
  const link: LowcodeHeadLink = {
    rel: entry.rel.trim(),
    href: entry.href.trim()
  }
  const asValue = entry.as?.trim()
  const type = entry.type?.trim()
  const media = entry.media?.trim()
  const crossorigin = entry.crossorigin
  if (asValue) link.as = asValue
  if (type) link.type = type
  if (media) link.media = media
  if (crossorigin) link.crossorigin = crossorigin
  return link
}

function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('//')
}

function isSafeHeadLinkHref(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^(?:https?|mailto|tel):/i.test(trimmed)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false
  return true
}

function cspDirectiveForLink(link: LowcodeHeadLink): string {
  const asValue = link.as?.trim().toLowerCase()
  if (asValue === 'style') return 'style-src'
  if (asValue === 'font') return 'font-src'
  if (asValue === 'image') return 'img-src'
  if (asValue === 'script') return 'script-src'
  return 'connect-src'
}

function cssExternalUrls(css: string): string[] {
  const urls = new Set<string>()
  for (const match of css.matchAll(/@import\s+(?:url\()?["']?([^"')\s]+)["']?\)?/gi)) {
    const value = match[1]?.trim()
    if (value && isExternalUrl(value)) urls.add(value)
  }
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const value = match[1]?.trim()
    if (value && isExternalUrl(value)) urls.add(value)
  }
  return [...urls]
}

function dedupeRisks(risks: CustomCodeCspRisk[]): CustomCodeCspRisk[] {
  const seen = new Set<string>()
  return risks.filter((risk) => {
    if (seen.has(risk.id)) return false
    seen.add(risk.id)
    return true
  })
}
